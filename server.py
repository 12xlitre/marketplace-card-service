#!/usr/bin/env python3
import argparse
import base64
import binascii
import datetime as dt
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import parse_qs, unquote, urlencode, urlparse

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


ROOT = Path(__file__).resolve().parent


def load_env_file(path):
  if not path.is_file():
    return
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip().strip("'\"")
    if key and key not in os.environ:
      os.environ[key] = value


load_env_file(ROOT / ".env.local")

DB_PATH = Path(os.environ.get("OPTICARDS_DB", ROOT / "var" / "opticards.sqlite3"))
SESSION_COOKIE = "opticards_session"
SESSION_TTL_SECONDS = 12 * 60 * 60
SESSION_TTL_REMEMBER_SECONDS = 7 * 24 * 60 * 60
PBKDF2_ITERATIONS = 240_000
MAX_JSON_BYTES = 64 * 1024
SECRET_KEY_ENV = "OPTICARDS_SECRET_KEY"
WB_PROVIDER = "wb"
MPSTATS_PROVIDER = "mpstats"
MPSTATS_API_BASE = os.environ.get("MPSTATS_API_BASE", "https://mpstats.io/api")
MPSTATS_CHECK_ITEM_ID = os.environ.get("MPSTATS_CHECK_ITEM_ID", "265906486")
WB_ENV_TOKEN = "WB_API_TOKEN"
WB_CONTENT_API_BASE = os.environ.get("WB_CONTENT_API_BASE", "https://content-api.wildberries.ru")
WB_CONNECT_TIMEOUT = float(os.environ.get("WB_CONNECT_TIMEOUT", "5"))
WB_READ_TIMEOUT = float(os.environ.get("WB_READ_TIMEOUT", "20"))
MPSTATS_CONNECT_TIMEOUT = float(os.environ.get("MPSTATS_CONNECT_TIMEOUT", "5"))
MPSTATS_READ_TIMEOUT = float(os.environ.get("MPSTATS_READ_TIMEOUT", "15"))
MPSTATS_CHARACTERISTICS_CACHE_TTL_SECONDS = int(os.environ.get("MPSTATS_CHARACTERISTICS_CACHE_TTL_SECONDS", "86400"))
WB_MAX_CARDS_PER_SYNC = 1000
WB_CHARCS_CACHE_TTL_SECONDS = int(os.environ.get("WB_CHARCS_CACHE_TTL_SECONDS", "21600"))
WB_TOKEN_LIFETIME_DAYS = 180
WB_CHARACTERISTICS_CACHE = {}
WB_DIRECTORY_CACHE = {}


def utc_now():
  return dt.datetime.now(dt.timezone.utc)


def iso_now_plus(seconds):
  return (utc_now() + dt.timedelta(seconds=seconds)).isoformat()


def connect_db():
  DB_PATH.parent.mkdir(parents=True, exist_ok=True)
  connection = sqlite3.connect(DB_PATH)
  connection.row_factory = sqlite3.Row
  connection.execute("PRAGMA foreign_keys = ON")
  return connection


def init_db():
  with connect_db() as db:
    db.executescript("""
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        user_role TEXT NOT NULL DEFAULT 'manager',
        access_level TEXT NOT NULL DEFAULT 'overview',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS portals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        marketplace TEXT NOT NULL DEFAULT 'Wildberries',
        scope TEXT NOT NULL DEFAULT 'full',
        status TEXT NOT NULL DEFAULT 'draft',
        is_active INTEGER NOT NULL DEFAULT 1,
        api_connected INTEGER NOT NULL DEFAULT 0,
        card_count INTEGER NOT NULL DEFAULT 0,
        work_count INTEGER NOT NULL DEFAULT 0,
        problem_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_sync_at TEXT
      );

      CREATE TABLE IF NOT EXISTS portal_members (
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        user_login TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
        project_role TEXT NOT NULL CHECK(project_role IN ('lead', 'tech', 'manager')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (portal_id, project_role)
      );

      CREATE TABLE IF NOT EXISTS portal_integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stored',
        token_nonce TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        token_digest TEXT NOT NULL,
        external_key TEXT NOT NULL DEFAULT '',
        token_issued_at TEXT,
        token_expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_checked_at TEXT,
        UNIQUE (portal_id, provider)
      );

      CREATE TABLE IF NOT EXISTS card_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        card_key TEXT NOT NULL,
        nm_id TEXT NOT NULL DEFAULT '',
        vendor_code TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        audit_status TEXT NOT NULL DEFAULT 'idle',
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (portal_id, card_key)
      );

      CREATE TABLE IF NOT EXISTS service_integrations (
        provider TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'stored',
        token_nonce TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        token_digest TEXT NOT NULL,
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_checked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS mpstats_characteristics_cache (
        cache_key TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        value TEXT NOT NULL,
        num_top INTEGER NOT NULL,
        min_cats INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );
    """)
    columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    if "user_role" not in columns:
      db.execute("ALTER TABLE users ADD COLUMN user_role TEXT NOT NULL DEFAULT 'manager'")
    portal_columns = {row["name"] for row in db.execute("PRAGMA table_info(portals)").fetchall()}
    for column_name in ("card_count", "work_count", "problem_count"):
      if column_name not in portal_columns:
        db.execute(f"ALTER TABLE portals ADD COLUMN {column_name} INTEGER NOT NULL DEFAULT 0")
    if "is_active" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    integration_columns = {row["name"] for row in db.execute("PRAGMA table_info(portal_integrations)").fetchall()}
    if "external_key" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN external_key TEXT NOT NULL DEFAULT ''")
    if "token_issued_at" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN token_issued_at TEXT")
    if "token_expires_at" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN token_expires_at TEXT")
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_portal_integrations_provider_token_digest
      ON portal_integrations(provider, token_digest)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_portal_integrations_provider_external_key
      ON portal_integrations(provider, external_key)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_card_drafts_portal_card
      ON card_drafts(portal_id, card_key)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_mpstats_characteristics_cache_expires
      ON mpstats_characteristics_cache(expires_at)
      """
    )


def hash_password(password, salt=None):
  if salt is None:
    salt = secrets.token_bytes(16)
  digest = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt,
    PBKDF2_ITERATIONS,
  )
  return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password, password_hash):
  try:
    algorithm, iterations, salt_hex, expected_hex = password_hash.split("$", 3)
    if algorithm != "pbkdf2_sha256":
      return False
    digest = hashlib.pbkdf2_hmac(
      "sha256",
      password.encode("utf-8"),
      bytes.fromhex(salt_hex),
      int(iterations),
    )
    return hmac.compare_digest(digest.hex(), expected_hex)
  except (ValueError, TypeError):
    return False


def public_user(row):
  return {
    "login": row["login"],
    "full_name": row["full_name"],
    "role": row["role"],
    "user_role": row["user_role"],
    "access_level": row["access_level"],
  }


def user_can_manage_portals(row):
  if not row:
    return False
  marker = f"{row['user_role']} {row['access_level']} {row['role']}".lower()
  return any(part in marker for part in ("admin", "manager", "all", "полный", "админ", "руковод", "менедж"))


def user_can_manage_users(row):
  if not row:
    return False
  marker = f"{row['user_role']} {row['access_level']} {row['role']}".lower()
  return any(part in marker for part in ("admin", "all", "полный", "админ", "руковод"))


def user_has_global_portal_access(row):
  if not row:
    return False
  marker = f"{row['user_role']} {row['access_level']} {row['role']}".lower()
  return any(part in marker for part in ("admin", "all", "полный", "админ", "руковод"))


def user_can_access_portal(user, portal_id):
  if str(portal_id) == "demo-wb":
    return True
  if not user:
    return False
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return False
  if user_has_global_portal_access(user):
    return True
  login = user["login"]
  with connect_db() as db:
    row = db.execute(
      """
      SELECT portals.id
      FROM portals
      WHERE portals.id = ?
        AND (
          portals.created_by = ?
          OR EXISTS (
            SELECT 1
            FROM portal_members
            WHERE portal_members.portal_id = portals.id
              AND portal_members.user_login = ?
          )
        )
      LIMIT 1
      """,
      (numeric_portal_id, login, login),
    ).fetchone()
  return bool(row)


def user_can_edit_portal(user, portal_id):
  return user_can_manage_portals(user) and user_can_access_portal(user, portal_id)


def portal_conflict_payload(existing_portal, user):
  payload = {
    "error": "portal_already_connected" if existing_portal["is_active"] else "portal_already_archived",
  }
  if user_can_access_portal(user, existing_portal["id"]):
    payload["portal"] = {
      "id": str(existing_portal["id"]),
      "name": existing_portal["name"],
      "isActive": bool(existing_portal["is_active"]),
      "status": existing_portal["status"],
    }
  return payload


def token_digest(token):
  return hashlib.sha256(token.encode("utf-8")).hexdigest()


def secret_digest(secret):
  return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def decode_jwt_payload(token):
  parts = str(token or "").split(".")
  if len(parts) < 2:
    return {}
  payload = parts[1]
  padding = "=" * (-len(payload) % 4)
  try:
    decoded = base64.urlsafe_b64decode((payload + padding).encode("ascii"))
    result = json.loads(decoded.decode("utf-8"))
  except (ValueError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
    return {}
  return result if isinstance(result, dict) else {}


def wb_effective_token_expiry(expires_at, issued_at=None):
  if issued_at:
    return min(expires_at, issued_at + dt.timedelta(days=WB_TOKEN_LIFETIME_DAYS))
  return expires_at


def wb_token_days_left(expires_at, now):
  seconds_left = (expires_at - now).total_seconds()
  raw_days_left = int((seconds_left + 86399) // 86400)
  return max(0, min(WB_TOKEN_LIFETIME_DAYS, raw_days_left)), seconds_left


def wb_token_meta(token):
  payload = decode_jwt_payload(token)
  exp = payload.get("exp")
  iat = payload.get("iat")
  now = utc_now()
  meta = {
    "expiresAt": "",
    "issuedAt": "",
    "daysLeft": None,
    "status": "unknown",
  }
  issued_at = None
  if isinstance(iat, (int, float)):
    issued_at = dt.datetime.fromtimestamp(iat, dt.timezone.utc)
    meta["issuedAt"] = issued_at.isoformat()
  if isinstance(exp, (int, float)):
    expires_at = dt.datetime.fromtimestamp(exp, dt.timezone.utc)
    effective_expires_at = wb_effective_token_expiry(expires_at, issued_at)
    days_left, seconds_left = wb_token_days_left(effective_expires_at, now)
    meta["expiresAt"] = expires_at.isoformat()
    meta["daysLeft"] = days_left
    if seconds_left <= 0:
      meta["status"] = "expired"
    elif seconds_left <= 30 * 86400:
      meta["status"] = "expiring"
    else:
      meta["status"] = "active"
  return meta


def wb_token_meta_from_dates(issued_at="", expires_at=""):
  meta = {
    "expiresAt": expires_at or "",
    "issuedAt": issued_at or "",
    "daysLeft": None,
    "status": "unknown",
  }
  if not expires_at:
    return meta
  issued_dt = None
  try:
    if issued_at:
      normalized_issued = issued_at.replace("Z", "+00:00")
      issued_dt = dt.datetime.fromisoformat(normalized_issued)
      if issued_dt.tzinfo is None:
        issued_dt = issued_dt.replace(tzinfo=dt.timezone.utc)
  except ValueError:
    issued_dt = None
  try:
    normalized = expires_at.replace("Z", "+00:00")
    expires_dt = dt.datetime.fromisoformat(normalized)
    if expires_dt.tzinfo is None:
      expires_dt = expires_dt.replace(tzinfo=dt.timezone.utc)
  except ValueError:
    return meta
  effective_expires_dt = wb_effective_token_expiry(expires_dt, issued_dt)
  days_left, seconds_left = wb_token_days_left(effective_expires_dt, utc_now())
  meta["daysLeft"] = days_left
  if seconds_left <= 0:
    meta["status"] = "expired"
  elif seconds_left <= 30 * 86400:
    meta["status"] = "expiring"
  else:
    meta["status"] = "active"
  return meta


def store_wb_token_meta(portal_id, token_meta):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return
  issued_at = token_meta.get("issuedAt", "")
  expires_at = token_meta.get("expiresAt", "")
  if not issued_at and not expires_at:
    return
  with connect_db() as db:
    db.execute(
      """
      UPDATE portal_integrations
      SET
        token_issued_at = COALESCE(NULLIF(?, ''), token_issued_at),
        token_expires_at = COALESCE(NULLIF(?, ''), token_expires_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE portal_id = ? AND provider = ?
      """,
      (issued_at, expires_at, numeric_portal_id, WB_PROVIDER),
    )


def generate_secret_key():
  return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")


def load_secret_key():
  raw_key = os.environ.get(SECRET_KEY_ENV, "").strip()
  if not raw_key:
    raise RuntimeError(f"{SECRET_KEY_ENV} is required for encrypted integration storage.")
  try:
    key = base64.urlsafe_b64decode(raw_key.encode("ascii"))
  except (ValueError, TypeError) as exc:
    raise RuntimeError(f"{SECRET_KEY_ENV} must be a base64-encoded 32-byte key.") from exc
  if len(key) != 32:
    raise RuntimeError(f"{SECRET_KEY_ENV} must decode to exactly 32 bytes.")
  return key


def encrypt_secret(secret, aad):
  nonce = secrets.token_bytes(12)
  ciphertext = AESGCM(load_secret_key()).encrypt(
    nonce,
    secret.encode("utf-8"),
    aad.encode("utf-8"),
  )
  return base64.urlsafe_b64encode(nonce).decode("ascii"), base64.urlsafe_b64encode(ciphertext).decode("ascii")


def decrypt_secret(nonce_b64, ciphertext_b64, aad):
  nonce = base64.urlsafe_b64decode(nonce_b64.encode("ascii"))
  ciphertext = base64.urlsafe_b64decode(ciphertext_b64.encode("ascii"))
  return AESGCM(load_secret_key()).decrypt(nonce, ciphertext, aad.encode("utf-8")).decode("utf-8")


def integration_aad(portal_id, provider):
  return f"portal:{portal_id}:integration:{provider}"


def service_integration_aad(provider):
  return f"service:integration:{provider}"


def wb_snapshot_external_key(snapshot):
  cards = snapshot.get("cards") or []
  nm_ids = sorted({
    str(card.get("nmID")).strip()
    for card in cards
    if card.get("nmID")
  })
  if not nm_ids:
    return ""
  digest = hashlib.sha256("\n".join(nm_ids).encode("utf-8")).hexdigest()
  return f"wb-nmids:{digest}"


def create_portal(name, marketplace, scope, created_by, team):
  init_db()
  with connect_db() as db:
    cursor = db.execute(
      """
      INSERT INTO portals (name, marketplace, scope, status, created_by)
      VALUES (?, ?, ?, 'draft', ?)
      """,
      (name, marketplace, scope, created_by),
    )
    portal_id = cursor.lastrowid
    for project_role, user_login in team.items():
      if user_login:
        db.execute(
          """
          INSERT INTO portal_members (portal_id, user_login, project_role)
          VALUES (?, ?, ?)
          ON CONFLICT(portal_id, project_role) DO UPDATE SET
            user_login = excluded.user_login
          """,
          (portal_id, user_login, project_role),
        )
    return portal_id


def create_connected_wb_portal(name, marketplace, scope, created_by, team, token, snapshot):
  init_db()
  stats = snapshot.get("stats") or {}
  token_meta = snapshot.get("tokenMeta") or wb_token_meta(token)
  portal_name = stats.get("portalName") or name
  external_key = wb_snapshot_external_key(snapshot)
  with connect_db() as db:
    cursor = db.execute(
      """
      INSERT INTO portals (
        name, marketplace, scope, status, api_connected,
        card_count, work_count, problem_count, created_by, last_sync_at
      )
      VALUES (?, ?, ?, 'WB read-only', 1, ?, ?, ?, ?, ?)
      """,
      (
        portal_name,
        marketplace,
        scope,
        stats.get("cardCount", 0),
        stats.get("workCount", 0),
        stats.get("problemCount", 0),
        created_by,
        stats.get("loadedAt"),
      ),
    )
    portal_id = cursor.lastrowid
    for project_role, user_login in team.items():
      if user_login:
        db.execute(
          """
          INSERT INTO portal_members (portal_id, user_login, project_role)
          VALUES (?, ?, ?)
          ON CONFLICT(portal_id, project_role) DO UPDATE SET
            user_login = excluded.user_login
          """,
          (portal_id, user_login, project_role),
        )

    aad = integration_aad(portal_id, WB_PROVIDER)
    nonce, ciphertext = encrypt_secret(token, aad)
    db.execute(
      """
      INSERT INTO portal_integrations (
        portal_id, provider, status, token_nonce, token_ciphertext, token_digest,
        external_key, token_issued_at, token_expires_at, last_checked_at
      )
      VALUES (?, ?, 'connected', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      """,
      (
        portal_id,
        WB_PROVIDER,
        nonce,
        ciphertext,
        secret_digest(token),
        external_key,
        token_meta.get("issuedAt", ""),
        token_meta.get("expiresAt", ""),
      ),
    )
    return portal_id


def find_portal_by_integration_token(provider, token):
  init_db()
  with connect_db() as db:
    return db.execute(
      """
      SELECT portals.id, portals.name, portals.is_active, portals.status
      FROM portal_integrations
      JOIN portals ON portals.id = portal_integrations.portal_id
      WHERE portal_integrations.provider = ?
        AND portal_integrations.token_digest = ?
      ORDER BY portals.is_active DESC, portals.id
      LIMIT 1
      """,
      (provider, secret_digest(token)),
    ).fetchone()


def find_portal_by_integration_external_key(provider, external_key):
  if not external_key:
    return None
  init_db()
  with connect_db() as db:
    return db.execute(
      """
      SELECT portals.id, portals.name, portals.is_active, portals.status
      FROM portal_integrations
      JOIN portals ON portals.id = portal_integrations.portal_id
      WHERE portal_integrations.provider = ?
        AND portal_integrations.external_key = ?
      ORDER BY portals.is_active DESC, portals.id
      LIMIT 1
      """,
      (provider, external_key),
    ).fetchone()


def save_integration_token(portal_id, provider, token):
  init_db()
  aad = integration_aad(portal_id, provider)
  nonce, ciphertext = encrypt_secret(token, aad)
  token_meta = wb_token_meta(token) if provider == WB_PROVIDER else {}
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      raise ValueError(f"Portal {portal_id} not found.")
    db.execute(
      """
      INSERT INTO portal_integrations (
        portal_id, provider, status, token_nonce, token_ciphertext, token_digest,
        external_key, token_issued_at, token_expires_at
      )
      VALUES (?, ?, 'stored', ?, ?, ?, '', ?, ?)
      ON CONFLICT(portal_id, provider) DO UPDATE SET
        status = 'stored',
        token_nonce = excluded.token_nonce,
        token_ciphertext = excluded.token_ciphertext,
        token_digest = excluded.token_digest,
        token_issued_at = excluded.token_issued_at,
        token_expires_at = excluded.token_expires_at,
        external_key = '',
        updated_at = CURRENT_TIMESTAMP
      """,
      (
        portal_id,
        provider,
        nonce,
        ciphertext,
        secret_digest(token),
        token_meta.get("issuedAt", ""),
        token_meta.get("expiresAt", ""),
      ),
    )
    db.execute(
      """
      UPDATE portals
      SET status = ?, api_connected = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (f"{provider} token stored", portal_id),
    )


def list_portals(user=None):
  init_db()
  params = []
  access_filter = ""
  if user is not None and not user_has_global_portal_access(user):
    access_filter = """
      WHERE portals.created_by = ?
        OR EXISTS (
          SELECT 1
          FROM portal_members AS access_members
          WHERE access_members.portal_id = portals.id
            AND access_members.user_login = ?
        )
    """
    params = [user["login"], user["login"]]
  with connect_db() as db:
    rows = db.execute(
      f"""
      SELECT
        portals.id,
        portals.name,
        portals.marketplace,
        portals.scope,
        portals.status,
        portals.is_active,
        portals.api_connected,
        portals.card_count,
        portals.work_count,
        portals.problem_count,
        portals.last_sync_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_issued_at END) AS wb_token_issued_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_expires_at END) AS wb_token_expires_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_nonce END) AS wb_token_nonce,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_ciphertext END) AS wb_token_ciphertext,
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      {access_filter}
      GROUP BY portals.id
      ORDER BY portals.id
      """,
      params,
    ).fetchall()
  return rows


def parse_portal_members(value):
  members = {}
  for item in (value or "").split(","):
    role, separator, login = item.partition(":")
    if separator and role and login:
      members[role] = login
  return members


def wb_token_meta_for_portal_row(row):
  issued_at = row["wb_token_issued_at"] or ""
  expires_at = row["wb_token_expires_at"] or ""
  if issued_at and expires_at:
    return wb_token_meta_from_dates(issued_at, expires_at)

  nonce = row["wb_token_nonce"] or ""
  ciphertext = row["wb_token_ciphertext"] or ""
  if nonce and ciphertext:
    try:
      token = decrypt_secret(nonce, ciphertext, integration_aad(row["id"], WB_PROVIDER))
      token_meta = wb_token_meta(token)
      store_wb_token_meta(row["id"], token_meta)
      if token_meta.get("issuedAt") or token_meta.get("expiresAt"):
        return token_meta
    except (RuntimeError, UnicodeDecodeError):
      pass
    except (ValueError, binascii.Error, InvalidTag):
      pass

  return wb_token_meta_from_dates(issued_at, expires_at)


def public_portal_from_row(row):
  team = parse_portal_members(row["members"])
  integrations = row["integrations"] or ""
  has_wb_integration = "wb:" in integrations
  api_connected = bool(row["api_connected"])
  mode = "api" if api_connected or has_wb_integration else "manual"
  return {
    "id": str(row["id"]),
    "name": row["name"],
    "marketplace": row["marketplace"],
    "mode": mode,
    "scope": row["scope"],
    "status": row["status"],
    "isActive": bool(row["is_active"]),
    "ownerLogin": team.get("lead", ""),
    "cardCount": row["card_count"],
    "workCount": row["work_count"],
    "problemCount": row["problem_count"],
    "apiConnected": api_connected,
    "teamRoles": team,
    "memberLogins": [login for login in dict.fromkeys(team.values()) if login],
    "realCards": [],
    "syncStatus": "loaded" if api_connected else ("stored-token" if has_wb_integration else "manual"),
    "lastSyncAt": row["last_sync_at"] or "",
    "tokenMeta": wb_token_meta_for_portal_row(row),
    "isDemo": False,
  }


def get_portal_row(portal_id, user=None):
  init_db()
  params = [portal_id]
  access_filter = ""
  if user is not None and not user_has_global_portal_access(user):
    access_filter = """
        AND (
          portals.created_by = ?
          OR EXISTS (
            SELECT 1
            FROM portal_members AS access_members
            WHERE access_members.portal_id = portals.id
              AND access_members.user_login = ?
          )
        )
    """
    params.extend([user["login"], user["login"]])
  with connect_db() as db:
    return db.execute(
      f"""
      SELECT
        portals.id,
        portals.name,
        portals.marketplace,
        portals.scope,
        portals.status,
        portals.is_active,
        portals.api_connected,
        portals.card_count,
        portals.work_count,
        portals.problem_count,
        portals.last_sync_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_issued_at END) AS wb_token_issued_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_expires_at END) AS wb_token_expires_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_nonce END) AS wb_token_nonce,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_ciphertext END) AS wb_token_ciphertext,
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      WHERE portals.id = ?
      {access_filter}
      GROUP BY portals.id
      """,
      params,
    ).fetchone()


def update_portal_team(portal_id, team):
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      return None
    db.execute("DELETE FROM portal_members WHERE portal_id = ?", (portal_id,))
    for project_role, user_login in team.items():
      if user_login:
        db.execute(
          """
          INSERT INTO portal_members (portal_id, user_login, project_role)
          VALUES (?, ?, ?)
          """,
          (portal_id, user_login, project_role),
        )
    db.execute(
      "UPDATE portals SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      (portal_id,),
    )
  return get_portal_row(portal_id)


def set_portal_active(portal_id, is_active):
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      return None
    db.execute(
      """
      UPDATE portals
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (1 if is_active else 0, portal_id),
    )
  return get_portal_row(portal_id)


def update_portal_sync_stats(portal_id, snapshot):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return
  stats = snapshot.get("stats") or {}
  token_meta = snapshot.get("tokenMeta") or {}
  external_key = wb_snapshot_external_key(snapshot)
  with connect_db() as db:
    db.execute(
      """
      UPDATE portals
      SET
        name = COALESCE(NULLIF(?, ''), name),
        status = 'WB read-only',
        api_connected = 1,
        card_count = ?,
        work_count = ?,
        problem_count = ?,
        last_sync_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (
        stats.get("portalName", ""),
        stats.get("cardCount", 0),
        stats.get("workCount", 0),
        stats.get("problemCount", 0),
        stats.get("loadedAt"),
        numeric_portal_id,
      ),
    )
    db.execute(
      """
      UPDATE portal_integrations
      SET
        external_key = COALESCE(NULLIF(?, ''), external_key),
        token_issued_at = COALESCE(NULLIF(?, ''), token_issued_at),
        token_expires_at = COALESCE(NULLIF(?, ''), token_expires_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE portal_id = ? AND provider = ?
      """,
      (
        external_key,
        token_meta.get("issuedAt", ""),
        token_meta.get("expiresAt", ""),
        numeric_portal_id,
        WB_PROVIDER,
      ),
    )


def draft_card_key(value):
  return str(value or "").strip()[:120]


def normalize_card_draft_payload(payload):
  if not isinstance(payload, dict):
    payload = {}
  content = payload.get("content") if isinstance(payload.get("content"), dict) else {}
  title = content.get("title") if isinstance(content.get("title"), dict) else {}
  description = content.get("description") if isinstance(content.get("description"), dict) else {}
  characteristics = content.get("characteristics") if isinstance(content.get("characteristics"), dict) else {}
  prices = payload.get("prices") if isinstance(payload.get("prices"), dict) else {}
  stocks = payload.get("stocks") if isinstance(payload.get("stocks"), dict) else {}
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  audit_status = str(payload.get("auditStatus") or payload.get("audit_status") or "idle").strip() or "idle"
  return {
    "version": 2,
    "auditStatus": audit_status[:40],
    "content": {
      "title": {
        "value": str(title.get("value") or payload.get("title") or ""),
        "source": str(title.get("source") or payload.get("titleSource") or ""),
        "reason": str(title.get("reason") or payload.get("titleReason") or ""),
      },
      "description": {
        "value": str(description.get("value") or payload.get("description") or ""),
        "source": str(description.get("source") or payload.get("descriptionSource") or ""),
        "reason": str(description.get("reason") or payload.get("descriptionReason") or ""),
      },
      "characteristics": characteristics,
    },
    "prices": prices,
    "stocks": stocks,
    "meta": meta,
  }


def public_card_draft(row):
  try:
    payload = json.loads(row["payload_json"])
  except (TypeError, json.JSONDecodeError):
    payload = normalize_card_draft_payload({})
  return {
    "id": row["id"],
    "portalId": str(row["portal_id"]),
    "cardKey": row["card_key"],
    "nmID": row["nm_id"],
    "vendorCode": row["vendor_code"],
    "auditStatus": row["audit_status"],
    "draft": payload,
    "createdBy": row["created_by"] or "",
    "updatedBy": row["updated_by"] or "",
    "createdAt": row["created_at"] or "",
    "updatedAt": row["updated_at"] or "",
  }


def get_card_draft(portal_id, card_key, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return None
  card_key = draft_card_key(card_key)
  if not card_key or not user_can_access_portal(user, numeric_portal_id):
    return None
  init_db()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT *
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
  return public_card_draft(row) if row else None


def save_card_draft(portal_id, card_key, nm_id, vendor_code, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  normalized_payload = normalize_card_draft_payload(payload)
  payload_json = json.dumps(normalized_payload, ensure_ascii=False, separators=(",", ":"))
  with connect_db() as db:
    db.execute(
      """
      INSERT INTO card_drafts (
        portal_id, card_key, nm_id, vendor_code, payload_json,
        audit_status, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(portal_id, card_key) DO UPDATE SET
        nm_id = excluded.nm_id,
        vendor_code = excluded.vendor_code,
        payload_json = excluded.payload_json,
        audit_status = excluded.audit_status,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
      """,
      (
        numeric_portal_id,
        card_key,
        str(nm_id or "")[:80],
        str(vendor_code or "")[:120],
        payload_json,
        normalized_payload["auditStatus"],
        user["login"],
        user["login"],
      ),
    )
  return get_card_draft(numeric_portal_id, card_key, user)


def public_service_integration(row):
  if not row:
    return {
      "provider": MPSTATS_PROVIDER,
      "connected": False,
      "status": "missing",
      "lastCheckedAt": "",
      "updatedAt": "",
      "updatedBy": "",
    }
  return {
    "provider": row["provider"],
    "connected": True,
    "status": row["status"],
    "lastCheckedAt": row["last_checked_at"] or "",
    "updatedAt": row["updated_at"] or "",
    "updatedBy": row["updated_by"] or "",
  }


def get_service_integration(provider):
  init_db()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT provider, status, updated_by, updated_at, last_checked_at
      FROM service_integrations
      WHERE provider = ?
      """,
      (provider,),
    ).fetchone()
  return public_service_integration(row)


def get_service_integration_secret(provider):
  init_db()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT provider, token_nonce, token_ciphertext
      FROM service_integrations
      WHERE provider = ?
      """,
      (provider,),
    ).fetchone()
  if not row:
    return ""
  return decrypt_secret(row["token_nonce"], row["token_ciphertext"], service_integration_aad(provider))


def update_service_integration_check(provider, status):
  init_db()
  with connect_db() as db:
    db.execute(
      """
      UPDATE service_integrations
      SET status = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE provider = ?
      """,
      (status, provider),
    )
  return get_service_integration(provider)


def save_service_integration(provider, token, user):
  if provider != MPSTATS_PROVIDER:
    raise ValueError("unsupported_provider")
  token = str(token or "").strip()
  if len(token) < 8:
    raise ValueError("invalid_token")
  nonce, ciphertext = encrypt_secret(token, service_integration_aad(provider))
  with connect_db() as db:
    db.execute(
      """
      INSERT INTO service_integrations (
        provider, status, token_nonce, token_ciphertext, token_digest,
        created_by, updated_by, last_checked_at
      )
      VALUES (?, 'stored', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(provider) DO UPDATE SET
        status = 'stored',
        token_nonce = excluded.token_nonce,
        token_ciphertext = excluded.token_ciphertext,
        token_digest = excluded.token_digest,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP,
        last_checked_at = CURRENT_TIMESTAMP
      """,
      (
        provider,
        nonce,
        ciphertext,
        secret_digest(token),
        user["login"],
        user["login"],
      ),
    )
  return get_service_integration(provider)


def create_session(db, user_id, remember=False):
  ttl = SESSION_TTL_REMEMBER_SECONDS if remember else SESSION_TTL_SECONDS
  token = secrets.token_urlsafe(32)
  db.execute(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    (user_id, token_digest(token), iso_now_plus(ttl)),
  )
  db.execute("DELETE FROM sessions WHERE expires_at <= ?", (utc_now().isoformat(),))
  return token


def find_session_user(db, token):
  if not token:
    return None
  row = db.execute(
    """
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
      AND users.is_active = 1
    """,
    (token_digest(token), utc_now().isoformat()),
  ).fetchone()
  return row


def list_visible_users(user):
  if not user:
    return []
  init_db()
  with connect_db() as db:
    if user_can_manage_portals(user):
      return db.execute(
        """
        SELECT login, full_name, role, user_role, access_level
        FROM users
        WHERE is_active = 1
        ORDER BY id
        """
      ).fetchall()
    return db.execute(
      """
      SELECT DISTINCT users.login, users.full_name, users.role, users.user_role, users.access_level
      FROM users
      LEFT JOIN portal_members AS own_members
        ON own_members.user_login = ?
      LEFT JOIN portals AS own_portals
        ON own_portals.id = own_members.portal_id
        OR own_portals.created_by = ?
      LEFT JOIN portal_members AS visible_members
        ON visible_members.portal_id = own_portals.id
      WHERE users.is_active = 1
        AND (
          users.login = ?
          OR users.login = visible_members.user_login
          OR users.login = own_portals.created_by
        )
      ORDER BY users.login
      """,
      (user["login"], user["login"], user["login"]),
    ).fetchall()


def upsert_user(login, password, full_name, role, access_level, user_role):
  init_db()
  password_hash = hash_password(password)
  with connect_db() as db:
    db.execute(
      """
      INSERT INTO users (login, password_hash, full_name, role, user_role, access_level)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(login) DO UPDATE SET
        password_hash = excluded.password_hash,
        full_name = excluded.full_name,
        role = excluded.role,
        user_role = excluded.user_role,
        access_level = excluded.access_level,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      """,
      (login, password_hash, full_name, role, user_role, access_level),
    )


def normalize_new_user_login(value):
  login = re.sub(r"[^a-zA-Z0-9._-]+", "", str(value or "").strip().lower())
  return login[:48]


def generate_initial_password():
  return f"Opti-{secrets.token_urlsafe(12)}1!"


def create_user_account(payload, current_user):
  if not user_can_manage_users(current_user):
    raise PermissionError("forbidden")
  login = normalize_new_user_login(payload.get("login"))
  full_name = str(payload.get("fullName") or payload.get("full_name") or "").strip()
  role = str(payload.get("role") or "").strip()
  user_role = str(payload.get("userRole") or payload.get("user_role") or "manager").strip()
  access_level = str(payload.get("accessLevel") or payload.get("access_level") or "overview").strip()
  if user_role not in {"admin", "manager", "tech"}:
    user_role = "manager"
  if access_level not in {"all", "overview", "readonly_wb"}:
    access_level = "overview"
  if not login or len(login) < 3 or not full_name or not role:
    raise ValueError("invalid_user")
  password = str(payload.get("password") or "").strip() or generate_initial_password()
  if len(password) < 12:
    raise ValueError("weak_password")
  upsert_user(login, password, full_name, role, access_level, user_role)
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT login, full_name, role, user_role, access_level FROM users WHERE login = ?",
      (login,),
    ).fetchone()
  return public_user(row), password


def reset_user_password(payload, current_user):
  if not user_can_manage_users(current_user):
    raise PermissionError("forbidden")
  login = normalize_new_user_login(payload.get("login"))
  if not login:
    raise ValueError("invalid_user")
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT login, full_name, role, user_role, access_level FROM users WHERE login = ? AND is_active = 1",
      (login,),
    ).fetchone()
    if not row:
      raise ValueError("user_not_found")
    if row["user_role"] == "admin" and current_user["user_role"] != "admin":
      raise PermissionError("forbidden")
    password = generate_initial_password()
    db.execute(
      """
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE login = ? AND is_active = 1
      """,
      (hash_password(password), login),
    )
  return public_user(row), password


class WbApiError(Exception):
  def __init__(self, status, message, retryable=False):
    super().__init__(message)
    self.status = status
    self.message = message
    self.retryable = retryable


def parse_retry_after(value):
  if not value:
    return None
  try:
    return max(0, int(value))
  except ValueError:
    pass
  try:
    retry_at = parsedate_to_datetime(value)
    return max(0, (retry_at - utc_now()).total_seconds())
  except (TypeError, ValueError):
    return None


def wb_request_json(token, path, payload, locale="ru", attempts=3):
  url = f"{WB_CONTENT_API_BASE.rstrip('/')}{path}?locale={locale}"
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  headers = {
    "Authorization": token,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "OptiCards/0.1 read-only",
  }

  for attempt in range(attempts):
    request = urlrequest.Request(url, data=body, headers=headers, method="POST")
    try:
      with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      message = response_body
      try:
        error_payload = json.loads(response_body)
        message = (
          error_payload.get("errorText")
          or error_payload.get("detail")
          or error_payload.get("title")
          or error_payload.get("message")
          or response_body
        )
      except json.JSONDecodeError:
        pass
      raise WbApiError(exc.code, message or HTTPStatus(exc.code).phrase, retryable=retryable) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      if attempt < attempts - 1:
        time.sleep(0.5 * (2 ** attempt))
        continue
      raise WbApiError(HTTPStatus.GATEWAY_TIMEOUT, "wb_request_timeout", retryable=True) from exc
    except json.JSONDecodeError as exc:
      raise WbApiError(HTTPStatus.BAD_GATEWAY, "wb_invalid_json", retryable=False) from exc

  raise WbApiError(HTTPStatus.BAD_GATEWAY, "wb_request_failed", retryable=True)


def wb_get_json(token, path, locale="ru", attempts=3):
  separator = "&" if "?" in path else "?"
  url = f"{WB_CONTENT_API_BASE.rstrip('/')}{path}{separator}locale={locale}"
  headers = {
    "Authorization": token,
    "Accept": "application/json",
    "User-Agent": "OptiCards/0.1 read-only",
  }

  for attempt in range(attempts):
    request = urlrequest.Request(url, headers=headers, method="GET")
    try:
      with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      message = response_body
      try:
        error_payload = json.loads(response_body)
        message = (
          error_payload.get("errorText")
          or error_payload.get("detail")
          or error_payload.get("title")
          or error_payload.get("message")
          or response_body
        )
      except json.JSONDecodeError:
        pass
      raise WbApiError(exc.code, message or HTTPStatus(exc.code).phrase, retryable=retryable) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      if attempt < attempts - 1:
        time.sleep(0.5 * (2 ** attempt))
        continue
      raise WbApiError(HTTPStatus.GATEWAY_TIMEOUT, "wb_request_timeout", retryable=True) from exc
    except json.JSONDecodeError as exc:
      raise WbApiError(HTTPStatus.BAD_GATEWAY, "wb_invalid_json", retryable=False) from exc

  raise WbApiError(HTTPStatus.BAD_GATEWAY, "wb_request_failed", retryable=True)


class MpstatsApiError(Exception):
  def __init__(self, status, message, retryable=False):
    super().__init__(message)
    self.status = status
    self.message = message
    self.retryable = retryable


def mpstats_error_message(response_body, fallback):
  if not response_body:
    return fallback
  try:
    payload = json.loads(response_body)
  except json.JSONDecodeError:
    return fallback
  if isinstance(payload, dict):
    return str(payload.get("message") or payload.get("error") or payload.get("detail") or fallback)
  return fallback


def mpstats_get_json(token, path, attempts=3):
  token = str(token or "").strip()
  if not token:
    raise MpstatsApiError(HTTPStatus.UNAUTHORIZED, "mpstats_token_missing", retryable=False)
  url = f"{MPSTATS_API_BASE.rstrip('/')}{path}"
  headers = {
    "X-Mpstats-TOKEN": token,
    "Accept": "application/json",
    "User-Agent": "OptiCards/0.1 mpstats-check",
  }

  for attempt in range(attempts):
    request = urlrequest.Request(url, headers=headers, method="GET")
    try:
      with urlrequest.urlopen(request, timeout=MPSTATS_CONNECT_TIMEOUT + MPSTATS_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(
        exc.code,
        mpstats_error_message(response_body, HTTPStatus(exc.code).phrase),
        retryable=retryable,
      ) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      if attempt < attempts - 1:
        time.sleep(0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(HTTPStatus.GATEWAY_TIMEOUT, "mpstats_request_timeout", retryable=True) from exc
    except json.JSONDecodeError as exc:
      raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_invalid_json", retryable=False) from exc

  raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_request_failed", retryable=True)


def mpstats_post_json(token, path, params=None, attempts=3):
  token = str(token or "").strip()
  if not token:
    raise MpstatsApiError(HTTPStatus.UNAUTHORIZED, "mpstats_token_missing", retryable=False)
  query = urlencode(params or {}, doseq=True)
  url = f"{MPSTATS_API_BASE.rstrip('/')}{path}{'?' + query if query else ''}"
  headers = {
    "X-Mpstats-TOKEN": token,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "OptiCards/0.1 mpstats-characteristics",
  }

  for attempt in range(attempts):
    request = urlrequest.Request(url, data=b"{}", headers=headers, method="POST")
    try:
      with urlrequest.urlopen(request, timeout=MPSTATS_CONNECT_TIMEOUT + MPSTATS_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(
        exc.code,
        mpstats_error_message(response_body, HTTPStatus(exc.code).phrase),
        retryable=retryable,
      ) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      if attempt < attempts - 1:
        time.sleep(0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(HTTPStatus.GATEWAY_TIMEOUT, "mpstats_request_timeout", retryable=True) from exc
    except json.JSONDecodeError as exc:
      raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_invalid_json", retryable=False) from exc

  raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_request_failed", retryable=True)


def check_mpstats_connection():
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    return {
      "ok": False,
      "status": "missing",
      "message": "mpstats_key_missing",
      "integration": get_service_integration(MPSTATS_PROVIDER),
    }
  try:
    payload = mpstats_get_json(token, f"/analytics/v1/wb/items/{MPSTATS_CHECK_ITEM_ID}")
  except MpstatsApiError as exc:
    status = "auth_error" if exc.status == HTTPStatus.UNAUTHORIZED else "rate_limited" if exc.status == 429 else "error"
    integration = update_service_integration_check(MPSTATS_PROVIDER, status)
    return {
      "ok": False,
      "status": status,
      "httpStatus": int(exc.status),
      "retryable": bool(exc.retryable),
      "message": exc.message,
      "integration": integration,
    }
  integration = update_service_integration_check(MPSTATS_PROVIDER, "verified")
  return {
    "ok": True,
    "status": "verified",
    "sampleItem": {
      "id": payload.get("id") if isinstance(payload, dict) else "",
      "name": payload.get("name") if isinstance(payload, dict) else "",
    },
    "integration": integration,
  }


def normalize_mpstats_characteristics(payload):
  output = payload.get("output") if isinstance(payload, dict) else {}
  if not isinstance(output, dict):
    return []
  rows = []
  for name, table in output.items():
    if name == "products" or not isinstance(table, dict):
      continue
    data = table.get("data")
    if not isinstance(data, list):
      continue
    promotion_relevant = any(bool(table.get(key)) for key in (
      "promotion",
      "promotionRelevant",
      "isPromotion",
      "isPromotionRelevant",
      "important",
      "isImportant",
      "seo",
      "isSeo",
      "rank",
      "ranking",
    ))
    values = []
    for item in data[:30]:
      if not isinstance(item, list) or not item:
        continue
      value = str(item[0] or "").strip()
      if not value:
        continue
      score = item[1] if len(item) > 1 and isinstance(item[1], (int, float)) else None
      values.append({"value": value, "score": score})
    if values:
      rows.append({
        "name": str(name).strip(),
        "values": values,
        "promotionRelevant": promotion_relevant,
      })
  return rows


def mpstats_characteristics_cache_key(report_type, value, num_top, min_cats):
  return f"{report_type}:{value}:{num_top}:{min_cats}"


def normalize_mpstats_request(report_type, value, num_top=100, min_cats=0):
  report_type = str(report_type or "subject").strip()
  value = str(value or "").strip()
  if report_type not in {"category", "subject", "skus", "keywords"} or not value:
    raise ValueError("invalid_mpstats_characteristics_request")
  num_top = max(10, min(int(num_top or 100), 300))
  min_cats = max(0, min(int(min_cats or 0), 20))
  return report_type, value, num_top, min_cats


def load_mpstats_characteristics_cache(cache_key):
  with connect_db() as db:
    row = db.execute(
      """
      SELECT payload_json, updated_at, expires_at
      FROM mpstats_characteristics_cache
      WHERE cache_key = ?
      """,
      (cache_key,),
    ).fetchone()
  if not row:
    return None
  try:
    expires_at = dt.datetime.fromisoformat(row["expires_at"])
  except ValueError:
    return None
  if expires_at <= utc_now():
    return None
  try:
    payload = json.loads(row["payload_json"])
  except json.JSONDecodeError:
    return None
  if not isinstance(payload, dict):
    return None
  return {
    **payload,
    "cached": True,
    "cachedAt": row["updated_at"],
    "expiresAt": row["expires_at"],
  }


def save_mpstats_characteristics_cache(cache_key, report_type, value, num_top, min_cats, payload, stored_at, expires_at):
  with connect_db() as db:
    db.execute(
      """
      INSERT INTO mpstats_characteristics_cache (
        cache_key, report_type, value, num_top, min_cats, payload_json, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
      """,
      (
        cache_key,
        report_type,
        value,
        num_top,
        min_cats,
        json.dumps(payload, ensure_ascii=False),
        stored_at,
        stored_at,
        expires_at,
      ),
    )


def fetch_mpstats_characteristics(report_type, value, num_top=100, min_cats=0, force_refresh=False, cache_only=False):
  report_type, value, num_top, min_cats = normalize_mpstats_request(report_type, value, num_top, min_cats)
  cache_key = mpstats_characteristics_cache_key(report_type, value, num_top, min_cats)
  if not force_refresh:
    cached = load_mpstats_characteristics_cache(cache_key)
    if cached:
      return cached
  if cache_only:
    return {
      "source": "mpstats",
      "status": "cache-miss",
      "characteristics": [],
      "cached": False,
    }

  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)

  create_payload = mpstats_post_json(
    token,
    "/analytics/v1/wb/characteristics-analysis",
    {
      "type": report_type,
      "value": value,
      "numTop": num_top,
      "minCats": min_cats,
    },
  )
  report_hash = create_payload.get("result") if isinstance(create_payload, dict) else ""
  if not report_hash:
    raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_report_hash_missing", retryable=True)

  report_payload = {}
  for attempt in range(3):
    report_payload = mpstats_get_json(token, f"/analytics/v1/wb/characteristics-analysis/{report_hash}")
    if isinstance(report_payload, dict) and isinstance(report_payload.get("output"), dict):
      break
    if attempt < 2:
      time.sleep(1)

  normalized = normalize_mpstats_characteristics(report_payload)
  now = utc_now()
  stored_at = now.isoformat()
  expires_at = (now + dt.timedelta(seconds=MPSTATS_CHARACTERISTICS_CACHE_TTL_SECONDS)).isoformat()
  payload = {
    "source": "mpstats",
    "status": "loaded" if normalized else "empty",
    "reportHash": report_hash,
    "input": report_payload.get("input", {}) if isinstance(report_payload, dict) else {},
    "characteristics": normalized,
    "cached": False,
    "cachedAt": stored_at,
    "expiresAt": expires_at,
  }
  save_mpstats_characteristics_cache(cache_key, report_type, value, num_top, min_cats, payload, stored_at, expires_at)
  return payload


def get_wb_token_for_portal(portal_id):
  if str(portal_id) == "demo-wb":
    token = os.environ.get(WB_ENV_TOKEN, "").strip()
    if token:
      return token, "env"

  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    numeric_portal_id = None

  if numeric_portal_id is not None:
    init_db()
    with connect_db() as db:
      row = db.execute(
        """
        SELECT token_nonce, token_ciphertext
        FROM portal_integrations
        WHERE portal_id = ? AND provider = ?
        """,
        (numeric_portal_id, WB_PROVIDER),
      ).fetchone()
    if row:
      token = decrypt_secret(
        row["token_nonce"],
        row["token_ciphertext"],
        integration_aad(numeric_portal_id, WB_PROVIDER),
      )
      return token, "encrypted"

  return "", "missing"


def first_photo_url(card):
  photos = card.get("photos") or []
  if not photos:
    return ""
  photo = photos[0] or {}
  preferred_keys = ("big", "c516x688", "c246x328", "square", "tm")
  for key in preferred_keys:
    value = photo.get(key)
    if value:
      return value
  for value in photo.values():
    if isinstance(value, str) and value.startswith("https://"):
      return value
  return ""


SENSITIVE_WB_FIELD_PARTS = (
  "token",
  "secret",
  "password",
  "authorization",
  "api_key",
  "apikey",
  "cookie",
  "session",
  "credential",
)


def public_wb_value(value):
  if isinstance(value, dict):
    result = {}
    for key, item in value.items():
      normalized_key = str(key).lower().replace("-", "_")
      if any(part in normalized_key for part in SENSITIVE_WB_FIELD_PARTS):
        continue
      result[str(key)] = public_wb_value(item)
    return result
  if isinstance(value, list):
    return [public_wb_value(item) for item in value]
  if value is None or isinstance(value, (str, int, float, bool)):
    return value
  return str(value)


def card_issue(card):
  issues = []
  title = str(card.get("title") or "").strip()
  if not title:
    issues.append("Нет названия")
  elif len(title) > 60:
    issues.append("Название длиннее 60")
  if not str(card.get("description") or "").strip():
    issues.append("Нет описания")
  if not card.get("brand"):
    issues.append("Нет бренда")
  if not card.get("characteristics"):
    issues.append("Пустые характеристики")
  if not card.get("photos"):
    issues.append("Нет фото")
  dimensions = card.get("dimensions") or {}
  if dimensions and dimensions.get("isValid") is False:
    issues.append("Габариты требуют проверки")
  return issues


def normalize_wb_card(card):
  issues = card_issue(card)
  quality = "Хорошая"
  quality_class = "green"
  if len(issues) == 1:
    quality = "Средняя"
    quality_class = "amber"
  elif len(issues) > 1:
    quality = "Низкая"
    quality_class = "red"

  status = "Можно оставить" if not issues else "Нужна проверка"
  status_class = "green" if not issues else "amber"
  title = str(card.get("title") or "").strip() or str(card.get("vendorCode") or "Карточка WB")
  return {
    "nmID": card.get("nmID"),
    "imtID": card.get("imtID"),
    "nmUUID": card.get("nmUUID") or "",
    "vendorCode": card.get("vendorCode") or "",
    "title": title,
    "description": card.get("description") or "",
    "brand": card.get("brand") or "",
    "subjectID": card.get("subjectID"),
    "subjectName": card.get("subjectName") or "категория не указана",
    "photoUrl": first_photo_url(card),
    "photos": public_wb_value(card.get("photos") or []),
    "video": public_wb_value(card.get("video") or ""),
    "characteristics": public_wb_value(card.get("characteristics") or []),
    "dimensions": public_wb_value(card.get("dimensions") or {}),
    "sizes": public_wb_value(card.get("sizes") or []),
    "tags": public_wb_value(card.get("tags") or []),
    "quality": quality,
    "qualityClass": quality_class,
    "issue": issues[0] if issues else "Нет критичных",
    "issueCount": len(issues),
    "status": status,
    "statusClass": status_class,
    "createdAt": card.get("createdAt") or "",
    "updatedAt": card.get("updatedAt") or "",
    "rawFields": public_wb_value(card),
  }


def normalize_wb_characteristic(item):
  return {
    "charcID": item.get("charcID"),
    "subjectID": item.get("subjectID"),
    "subjectName": item.get("subjectName") or "",
    "name": item.get("name") or "",
    "required": bool(item.get("required")),
    "unitName": item.get("unitName") or "",
    "maxCount": item.get("maxCount"),
    "popular": bool(item.get("popular")),
    "charcType": item.get("charcType"),
    "hasFilter": bool(item.get("hasFilter")),
    "isVariable": bool(item.get("isVariable")),
    "existNamedField": bool(item.get("existNamedField")),
    "strictValues": False,
    "valueMode": "free",
  }


WB_DIRECTORY_MATCHERS = (
  ("colors", "/content/v2/directory/colors", ("цвет",)),
  ("kinds", "/content/v2/directory/kinds", ("пол", "гендер")),
  ("countries", "/content/v2/directory/countries", ("страна производства", "страна изготов")),
  ("seasons", "/content/v2/directory/seasons", ("сезон",)),
)

WB_DIRECTORY_FALLBACK_VALUES = {
  "kinds": ["Женский", "Мужской", "Детский", "Унисекс"],
  "seasons": ["Весна", "Лето", "Осень", "Зима", "Демисезон"],
}


def normalized_ru_text(value):
  return str(value or "").strip().lower().replace("ё", "е")


def characteristic_name_matches(normalized_name, alias):
  if alias == "пол":
    words = normalized_name.replace("/", " ").replace("-", " ").split()
    return alias in words
  return alias in normalized_name


def public_directory_value(item):
  if isinstance(item, str):
    return item.strip()
  if isinstance(item, dict):
    return str(
      item.get("name")
      or item.get("value")
      or item.get("title")
      or item.get("parentName")
      or ""
    ).strip()
  return ""


def fetch_wb_directory_values(token, cache_key, path):
  cached = WB_DIRECTORY_CACHE.get(cache_key)
  now = time.time()
  if cached and now - cached["loaded_at"] < WB_CHARCS_CACHE_TTL_SECONDS:
    return cached["values"]
  response = wb_get_json(token, path)
  items = response.get("data") if isinstance(response, dict) else response
  if not isinstance(items, list):
    items = []
  values = sorted({
    value
    for value in (public_directory_value(item) for item in items)
    if value
  }, key=lambda value: value.lower())
  if not values:
    values = WB_DIRECTORY_FALLBACK_VALUES.get(cache_key, [])
  WB_DIRECTORY_CACHE[cache_key] = {
    "loaded_at": now,
    "values": values,
  }
  return values


def attach_wb_directory_values(token, characteristics):
  for characteristic in characteristics:
    normalized_name = normalized_ru_text(characteristic.get("name"))
    for cache_key, path, aliases in WB_DIRECTORY_MATCHERS:
      if any(characteristic_name_matches(normalized_name, alias) for alias in aliases):
        try:
          characteristic["valueOptions"] = fetch_wb_directory_values(token, cache_key, path)
        except WbApiError:
          characteristic["valueOptions"] = WB_DIRECTORY_FALLBACK_VALUES.get(cache_key, [])
        if characteristic["valueOptions"]:
          characteristic["strictValues"] = True
          characteristic["valueMode"] = "directory"
        break


def fetch_wb_subject_characteristics(token, subject_id):
  subject_id = int(subject_id)
  cached = WB_CHARACTERISTICS_CACHE.get(subject_id)
  now = time.time()
  if cached and now - cached["loaded_at"] < WB_CHARCS_CACHE_TTL_SECONDS:
    return cached["payload"]

  response = wb_get_json(token, f"/content/v2/object/charcs/{subject_id}")
  items = response.get("data") or []
  characteristics = [normalize_wb_characteristic(item) for item in items if isinstance(item, dict)]
  attach_wb_directory_values(token, characteristics)
  characteristics.sort(key=lambda item: (
    not item["required"],
    not item["popular"],
    not item["hasFilter"],
    item["name"].lower(),
  ))
  payload = {
    "subjectID": subject_id,
    "characteristics": characteristics,
    "loadedAt": utc_now().isoformat(),
  }
  WB_CHARACTERISTICS_CACHE[subject_id] = {"loaded_at": now, "payload": payload}
  return payload


def most_common_nonempty(values):
  counts = {}
  order = []
  for raw_value in values:
    value = str(raw_value or "").strip()
    if not value:
      continue
    if value not in counts:
      counts[value] = 0
      order.append(value)
    counts[value] += 1
  if not counts:
    return ""
  return max(order, key=lambda value: counts[value])


def derive_wb_portal_name(cards):
  brand = most_common_nonempty(card.get("brand") for card in cards)
  if brand:
    return f"{brand} WB"
  subject = most_common_nonempty(card.get("subjectName") for card in cards)
  if subject:
    return f"{subject} WB"
  vendor_prefix = most_common_nonempty(str(card.get("vendorCode") or "").split("-", 1)[0] for card in cards)
  if vendor_prefix:
    return f"{vendor_prefix} WB"
  return "Wildberries"


def fetch_wb_cards(token, max_cards=100):
  max_cards = max(1, min(int(max_cards), WB_MAX_CARDS_PER_SYNC))
  cards = []
  cursor = {"limit": min(100, max_cards)}

  while len(cards) < max_cards:
    cursor["limit"] = min(100, max_cards - len(cards))
    payload = {
      "settings": {
        "sort": {"ascending": True},
        "cursor": cursor,
        "filter": {"withPhoto": -1},
      }
    }
    response = wb_request_json(token, "/content/v2/get/cards/list", payload)
    batch = response.get("cards") or []
    cards.extend(batch)
    response_cursor = response.get("cursor") or {}
    total = int(response_cursor.get("total") or len(batch))
    updated_at = response_cursor.get("updatedAt")
    nm_id = response_cursor.get("nmID")
    if not batch or total < cursor["limit"] or not updated_at or not nm_id:
      cursor = response_cursor
      break
    cursor = {
      "limit": min(100, max_cards - len(cards)),
      "updatedAt": updated_at,
      "nmID": nm_id,
    }

  normalized_cards = [normalize_wb_card(card) for card in cards[:max_cards]]
  problem_count = sum(1 for card in normalized_cards if card["issueCount"] > 0)
  work_count = problem_count
  portal_name = derive_wb_portal_name(normalized_cards)
  return {
    "cards": normalized_cards,
    "raw_count": len(cards),
    "cursor": cursor,
    "tokenMeta": wb_token_meta(token),
    "stats": {
      "cardCount": len(normalized_cards),
      "workCount": work_count,
      "problemCount": problem_count,
      "sampleLimit": max_cards,
      "loadedAt": utc_now().isoformat(),
      "portalName": portal_name,
    },
  }


def clean_portal_team(raw_team):
  if not isinstance(raw_team, dict):
    return {}
  return {
    role: str(raw_team.get(role, "")).strip()
    for role in ("lead", "tech", "manager")
    if str(raw_team.get(role, "")).strip()
  }


def public_portal_payload(portal_id, name, marketplace, mode, scope, team, snapshot=None):
  stats = (snapshot or {}).get("stats") or {}
  cards = (snapshot or {}).get("cards") or []
  token_meta = (snapshot or {}).get("tokenMeta") or {}
  return {
    "id": str(portal_id),
    "name": stats.get("portalName") or name,
    "marketplace": marketplace,
    "mode": mode,
    "scope": scope,
    "status": "WB read-only" if mode == "api" else "Ручной режим",
    "isActive": True,
    "ownerLogin": team.get("lead", ""),
    "cardCount": stats.get("cardCount", 0),
    "workCount": stats.get("workCount", 0),
    "problemCount": stats.get("problemCount", 0),
    "apiConnected": mode == "api",
    "teamRoles": team,
    "memberLogins": [login for login in dict.fromkeys(team.values()) if login],
    "realCards": cards,
    "syncStatus": "loaded" if mode == "api" else "manual",
    "lastSyncAt": stats.get("loadedAt", ""),
    "tokenMeta": token_meta,
    "isDemo": False,
  }


class OpticardsHandler(BaseHTTPRequestHandler):
  server_version = "OpticardsServer/0.1"

  def log_message(self, format, *args):
    if os.environ.get("OPTICARDS_ACCESS_LOG") == "1":
      super().log_message(format, *args)

  def send_json(self, status, payload, extra_headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    if extra_headers:
      for key, value in extra_headers.items():
        self.send_header(key, value)
    self.end_headers()
    self.wfile.write(body)

  def read_json(self):
    try:
      length = int(self.headers.get("Content-Length", "0"))
    except ValueError:
      length = 0
    if length <= 0 or length > MAX_JSON_BYTES:
      return None
    try:
      return json.loads(self.rfile.read(length).decode("utf-8"))
    except json.JSONDecodeError:
      return None

  def cookie_token(self):
    cookie = SimpleCookie(self.headers.get("Cookie", ""))
    morsel = cookie.get(SESSION_COOKIE)
    return morsel.value if morsel else ""

  def session_cookie_header(self, token, max_age=SESSION_TTL_SECONDS):
    parts = [
      f"{SESSION_COOKIE}={token}",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      f"Max-Age={max_age}",
    ]
    if os.environ.get("OPTICARDS_SECURE_COOKIE") == "1":
      parts.append("Secure")
    return "; ".join(parts)

  def current_user(self):
    with connect_db() as db:
      return find_session_user(db, self.cookie_token())

  def require_user(self):
    user = self.current_user()
    if not user:
      self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
      return None
    return user

  def do_GET(self):
    parsed = urlparse(self.path)
    path = parsed.path
    if path == "/healthz":
      self.send_response(HTTPStatus.OK)
      self.send_header("Content-Type", "text/plain; charset=utf-8")
      self.send_header("Cache-Control", "no-store")
      self.end_headers()
      self.wfile.write(b"ok")
      return

    if path == "/api/session":
      user = self.current_user()
      self.send_json(HTTPStatus.OK, {"user": public_user(user) if user else None})
      return

    if path == "/api/users":
      user = self.require_user()
      if not user:
        return
      rows = list_visible_users(user)
      self.send_json(HTTPStatus.OK, {"users": [public_user(row) for row in rows]})
      return

    if path == "/api/portals":
      user = self.require_user()
      if not user:
        return
      self.send_json(
        HTTPStatus.OK,
        {"portals": [public_portal_from_row(row) for row in list_portals(user)]},
      )
      return

    if path == "/api/integrations/mpstats":
      if not self.require_user():
        return
      self.send_json(HTTPStatus.OK, {"integration": get_service_integration(MPSTATS_PROVIDER)})
      return

    if path == "/api/card-drafts":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      card_key = query.get("card_key", [""])[0]
      if not portal_id or not card_key:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_draft_request"})
        return
      draft = get_card_draft(portal_id, card_key, user)
      self.send_json(HTTPStatus.OK, {"draft": draft})
      return

    if path == "/api/wb/characteristics":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", ["demo-wb"])[0]
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      try:
        subject_id = int(query.get("subject_id", ["0"])[0])
      except ValueError:
        subject_id = 0
      if subject_id <= 0:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_subject_id"})
        return
      token, token_source = get_wb_token_for_portal(portal_id)
      if not token:
        self.send_json(
          HTTPStatus.CONFLICT,
          {
            "error": "wb_token_missing",
            "message": "WB token is required to load subject characteristics.",
          },
        )
        return
      try:
        payload = fetch_wb_subject_characteristics(token, subject_id)
      except WbApiError as exc:
        status = exc.status if isinstance(exc.status, int) else HTTPStatus.BAD_GATEWAY
        if status < 400 or status >= 600:
          status = HTTPStatus.BAD_GATEWAY
        self.send_json(
          status,
          {
            "error": "wb_api_error",
            "status": exc.status,
            "message": exc.message,
            "retryable": exc.retryable,
          },
        )
        return
      payload = {**payload, "portalId": portal_id, "tokenSource": token_source}
      self.send_json(HTTPStatus.OK, payload)
      return

    if path == "/api/mpstats/characteristics":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", ["demo-wb"])[0]
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      report_type = query.get("type", ["subject"])[0]
      value = query.get("value", [""])[0] or query.get("subject_id", [""])[0]
      try:
        num_top = int(query.get("num_top", ["100"])[0])
        min_cats = int(query.get("min_cats", ["0"])[0])
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mpstats_characteristics_request"})
        return
      force_refresh = query.get("refresh", ["0"])[0] in {"1", "true", "yes"}
      cache_only = query.get("cache_only", ["0"])[0] in {"1", "true", "yes"}
      try:
        payload = fetch_mpstats_characteristics(report_type, value, num_top=num_top, min_cats=min_cats, force_refresh=force_refresh, cache_only=cache_only)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mpstats_characteristics_request"})
        return
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      except MpstatsApiError as exc:
        status = exc.status if isinstance(exc.status, int) else HTTPStatus.BAD_GATEWAY
        if status < 400 or status >= 600:
          status = HTTPStatus.BAD_GATEWAY
        self.send_json(
          status,
          {
            "error": "mpstats_api_error",
            "status": exc.status,
            "message": exc.message,
            "retryable": exc.retryable,
          },
        )
        return
      self.send_json(HTTPStatus.OK, payload)
      return

    if path == "/api/wb/cards":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", ["demo-wb"])[0]
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      try:
        limit = int(query.get("limit", ["100"])[0])
      except ValueError:
        limit = 100
      token, token_source = get_wb_token_for_portal(portal_id)
      if not token:
        missing_message = (
          f"Set {WB_ENV_TOKEN} in .env.local for the demo portal."
          if str(portal_id) == "demo-wb"
          else "Store an encrypted WB token for this portal with set-wb-token."
        )
        self.send_json(
          HTTPStatus.CONFLICT,
          {
            "error": "wb_token_missing",
            "message": missing_message,
          },
        )
        return
      try:
        snapshot = fetch_wb_cards(token, max_cards=limit)
      except WbApiError as exc:
        status = exc.status if isinstance(exc.status, int) else HTTPStatus.BAD_GATEWAY
        if status < 400 or status >= 600:
          status = HTTPStatus.BAD_GATEWAY
        self.send_json(
          status,
          {
            "error": "wb_api_error",
            "status": exc.status,
            "message": exc.message,
            "retryable": exc.retryable,
          },
        )
        return
      update_portal_sync_stats(portal_id, snapshot)
      snapshot["portalId"] = portal_id
      snapshot["tokenSource"] = token_source
      self.send_json(HTTPStatus.OK, snapshot)
      return

    if path.startswith("/api/"):
      self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
      return

    self.serve_static(path)

  def do_POST(self):
    path = urlparse(self.path).path
    if path == "/api/login":
      payload = self.read_json() or {}
      login = str(payload.get("login", "")).strip()
      password = str(payload.get("password", ""))
      remember = bool(payload.get("remember"))

      with connect_db() as db:
        user = db.execute(
          "SELECT * FROM users WHERE login = ? AND is_active = 1",
          (login,),
        ).fetchone()
        if not user or not verify_password(password, user["password_hash"]):
          self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_credentials"})
          return
        token = create_session(db, user["id"], remember=remember)

      self.send_json(
        HTTPStatus.OK,
        {"user": public_user(user)},
        {"Set-Cookie": self.session_cookie_header(
          token,
          max_age=SESSION_TTL_REMEMBER_SECONDS if remember else SESSION_TTL_SECONDS,
        )},
      )
      return

    if path == "/api/portals":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      mode = str(payload.get("mode", "manual")).strip()
      marketplace = str(payload.get("marketplace", "Wildberries")).strip() or "Wildberries"
      scope = str(payload.get("scope", "full")).strip()
      if scope not in ("full", "selected"):
        scope = "full"
      if mode not in ("api", "manual"):
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mode"})
        return

      team = clean_portal_team(payload.get("teamRoles"))
      name = str(payload.get("name", "")).strip() or "Кабинет WB"
      if len(name) > 120:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "portal_name_too_long"})
        return

      if mode == "api":
        if marketplace != "Wildberries":
          self.send_json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_marketplace"})
          return
        api_key = str(payload.get("apiKey", "")).strip()
        if len(api_key) < 20:
          self.send_json(HTTPStatus.BAD_REQUEST, {"error": "wb_token_required"})
          return
        existing_portal = find_portal_by_integration_token(WB_PROVIDER, api_key)
        if existing_portal:
          self.send_json(HTTPStatus.CONFLICT, portal_conflict_payload(existing_portal, user))
          return
        try:
          snapshot = fetch_wb_cards(api_key, max_cards=100)
          existing_portal = find_portal_by_integration_external_key(
            WB_PROVIDER,
            wb_snapshot_external_key(snapshot),
          )
          if existing_portal:
            self.send_json(HTTPStatus.CONFLICT, portal_conflict_payload(existing_portal, user))
            return
          portal_id = create_connected_wb_portal(
            name,
            marketplace,
            scope,
            user["login"],
            team,
            api_key,
            snapshot,
          )
        except WbApiError as exc:
          status = exc.status if isinstance(exc.status, int) else HTTPStatus.BAD_GATEWAY
          if status < 400 or status >= 600:
            status = HTTPStatus.BAD_GATEWAY
          self.send_json(
            status,
            {
              "error": "wb_api_error",
              "status": exc.status,
              "message": exc.message,
              "retryable": exc.retryable,
            },
          )
          return
        except RuntimeError:
          self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
          return
        except sqlite3.IntegrityError:
          self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_team"})
          return

        self.send_json(
          HTTPStatus.CREATED,
          {"portal": public_portal_payload(portal_id, name, marketplace, mode, scope, team, snapshot)},
        )
        return

      try:
        portal_id = create_portal(name, marketplace, scope, user["login"], team)
      except sqlite3.IntegrityError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_team"})
        return
      self.send_json(
        HTTPStatus.CREATED,
        {"portal": public_portal_payload(portal_id, name, marketplace, mode, scope, team)},
      )
      return

    if path == "/api/users":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        if payload.get("action") == "reset_password":
          created_user, password = reset_user_password(payload, user)
        else:
          created_user, password = create_user_account(payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_user"})
        return
      self.send_json(HTTPStatus.CREATED, {"user": created_user, "password": password})
      return

    if path == "/api/integrations/mpstats":
      user = self.require_user()
      if not user:
        return
      if not user_can_manage_portals(user):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      if payload.get("action") == "check":
        try:
          result = check_mpstats_connection()
        except RuntimeError:
          self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
          return
        self.send_json(HTTPStatus.OK, result)
        return
      api_key = str(payload.get("apiKey", "")).strip()
      try:
        save_service_integration(MPSTATS_PROVIDER, api_key, user)
        result = check_mpstats_connection()
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mpstats_key"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-drafts":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        draft = save_card_draft(
          payload.get("portalId"),
          payload.get("cardKey"),
          payload.get("nmID"),
          payload.get("vendorCode"),
          payload.get("draft"),
          user,
        )
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_draft"})
        return
      self.send_json(HTTPStatus.OK, {"draft": draft})
      return

    if path == "/api/logout":
      token = self.cookie_token()
      if token:
        with connect_db() as db:
          db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
      self.send_json(
        HTTPStatus.OK,
        {"ok": True},
        {"Set-Cookie": self.session_cookie_header("", max_age=0)},
      )
      return

    if path.startswith("/api/portals/") and (path.endswith("/archive") or path.endswith("/restore")):
      user = self.require_user()
      if not user:
        return

      action = "restore" if path.endswith("/restore") else "archive"
      suffix = f"/{action}"
      portal_id_text = path[len("/api/portals/"):-len(suffix)].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return

      row = set_portal_active(portal_id, action == "restore")
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/team"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/team")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      team = clean_portal_team(payload.get("teamRoles"))
      try:
        row = update_portal_team(portal_id, team)
      except sqlite3.IntegrityError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_team"})
        return
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

  def serve_static(self, request_path):
    path = unquote(request_path)
    if path in ("", "/"):
      path = "/index.html"

    if path != "/index.html":
      self.send_error(HTTPStatus.NOT_FOUND)
      return

    file_path = (ROOT / path.lstrip("/")).resolve()
    if not file_path.is_file() or ROOT not in file_path.parents:
      self.send_error(HTTPStatus.NOT_FOUND)
      return

    body = file_path.read_bytes()
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    self.send_response(HTTPStatus.OK)
    self.send_header("Content-Type", f"{content_type}; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body)


def run_server(host, port):
  init_db()
  server = ThreadingHTTPServer((host, port), OpticardsHandler)
  print(f"Serving OptiCards on http://{host}:{port}/")
  server.serve_forever()


def main():
  parser = argparse.ArgumentParser(description="OptiCards prototype backend")
  subparsers = parser.add_subparsers(dest="command", required=True)

  serve = subparsers.add_parser("serve", help="run HTTP server")
  serve.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
  serve.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5173")))

  create = subparsers.add_parser("create-user", help="create or update a user")
  create.add_argument("login")
  create.add_argument("full_name")
  create.add_argument("role")
  create.add_argument("--user-role", choices=["admin", "manager", "tech"], default="manager")
  create.add_argument("--access-level", default="overview")
  create.add_argument("--password", default="")

  subparsers.add_parser("list-users", help="list active users")

  subparsers.add_parser("generate-secret-key", help=f"generate a value for {SECRET_KEY_ENV}")

  portal = subparsers.add_parser("create-portal", help="create a marketplace cabinet")
  portal.add_argument("name")
  portal.add_argument("--marketplace", default="Wildberries")
  portal.add_argument("--scope", choices=["full", "selected"], default="full")
  portal.add_argument("--created-by", default="")
  portal.add_argument("--lead", default="")
  portal.add_argument("--tech", default="")
  portal.add_argument("--manager", default="")

  set_wb_token = subparsers.add_parser("set-wb-token", help="store a WB API token encrypted for a portal")
  set_wb_token.add_argument("portal_id", type=int)
  set_wb_token.add_argument("--token", default="")
  set_wb_token.add_argument("--env", default="WB_API_TOKEN")

  wb_sync = subparsers.add_parser("wb-sync", help="fetch a read-only WB cards sample")
  wb_sync.add_argument("--portal-id", default="demo-wb")
  wb_sync.add_argument("--limit", type=int, default=20)

  subparsers.add_parser("list-portals", help="list portals and integration status")

  args = parser.parse_args()
  if args.command == "serve":
    run_server(args.host, args.port)
  elif args.command == "create-user":
    password = args.password or getpass.getpass("Password: ")
    if len(password) < 12:
      raise SystemExit("Password must be at least 12 characters.")
    upsert_user(args.login, password, args.full_name, args.role, args.access_level, args.user_role)
    print(f"User {args.login} saved in {DB_PATH}.")
  elif args.command == "list-users":
    init_db()
    with connect_db() as db:
      rows = db.execute(
        "SELECT login, full_name, role, user_role, access_level, is_active FROM users ORDER BY id"
      ).fetchall()
    for row in rows:
      status = "active" if row["is_active"] else "disabled"
      print(f"{row['login']}\t{row['full_name']}\t{row['role']}\t{row['user_role']}\t{row['access_level']}\t{status}")
  elif args.command == "generate-secret-key":
    print(generate_secret_key())
  elif args.command == "create-portal":
    team = {
      "lead": args.lead,
      "tech": args.tech,
      "manager": args.manager,
    }
    portal_id = create_portal(args.name, args.marketplace, args.scope, args.created_by or None, team)
    print(f"Portal {portal_id} created.")
  elif args.command == "set-wb-token":
    token = args.token or os.environ.get(args.env, "").strip()
    if not token:
      token = getpass.getpass("WB API token: ")
    if len(token) < 20:
      raise SystemExit("WB API token looks too short.")
    save_integration_token(args.portal_id, "wb", token)
    print(f"WB token stored for portal {args.portal_id}.")
  elif args.command == "wb-sync":
    token, token_source = get_wb_token_for_portal(args.portal_id)
    if not token:
      if str(args.portal_id) == "demo-wb":
        raise SystemExit(f"WB token is missing. Set {WB_ENV_TOKEN} in .env.local.")
      raise SystemExit("WB token is missing. Run set-wb-token for this portal.")
    try:
      snapshot = fetch_wb_cards(token, max_cards=args.limit)
    except WbApiError as exc:
      raise SystemExit(f"WB API error {exc.status}: {exc.message}") from exc
    stats = snapshot["stats"]
    print(
      f"Fetched {stats['cardCount']} cards from WB ({token_source}); "
      f"problems: {stats['problemCount']}; loaded_at: {stats['loadedAt']}"
    )
    for card in snapshot["cards"][:5]:
      print(f"{card['nmID']}\t{card['vendorCode']}\t{card['title']}\t{card['issue']}")
  elif args.command == "list-portals":
    for row in list_portals():
      api_state = "api" if row["api_connected"] else "no-api"
      members = row["members"] or "-"
      integrations = row["integrations"] or "-"
      print(
        f"{row['id']}\t{row['name']}\t{row['marketplace']}\t{row['scope']}\t"
        f"{row['status']}\t{api_state}\t{members}\t{integrations}"
      )


if __name__ == "__main__":
  main()
