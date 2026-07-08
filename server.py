#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
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
from urllib.parse import parse_qs, unquote, urlparse

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
WB_ENV_TOKEN = "WB_API_TOKEN"
WB_CONTENT_API_BASE = os.environ.get("WB_CONTENT_API_BASE", "https://content-api.wildberries.ru")
WB_CONNECT_TIMEOUT = float(os.environ.get("WB_CONNECT_TIMEOUT", "5"))
WB_READ_TIMEOUT = float(os.environ.get("WB_READ_TIMEOUT", "20"))
WB_MAX_CARDS_PER_SYNC = 1000


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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_checked_at TEXT,
        UNIQUE (portal_id, provider)
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


def token_digest(token):
  return hashlib.sha256(token.encode("utf-8")).hexdigest()


def secret_digest(secret):
  return hashlib.sha256(secret.encode("utf-8")).hexdigest()


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
  portal_name = stats.get("portalName") or name
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
        portal_id, provider, status, token_nonce, token_ciphertext, token_digest, last_checked_at
      )
      VALUES (?, ?, 'connected', ?, ?, ?, CURRENT_TIMESTAMP)
      """,
      (portal_id, WB_PROVIDER, nonce, ciphertext, secret_digest(token)),
    )
    return portal_id


def save_integration_token(portal_id, provider, token):
  init_db()
  aad = integration_aad(portal_id, provider)
  nonce, ciphertext = encrypt_secret(token, aad)
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      raise ValueError(f"Portal {portal_id} not found.")
    db.execute(
      """
      INSERT INTO portal_integrations (
        portal_id, provider, status, token_nonce, token_ciphertext, token_digest
      )
      VALUES (?, ?, 'stored', ?, ?, ?)
      ON CONFLICT(portal_id, provider) DO UPDATE SET
        status = 'stored',
        token_nonce = excluded.token_nonce,
        token_ciphertext = excluded.token_ciphertext,
        token_digest = excluded.token_digest,
        updated_at = CURRENT_TIMESTAMP
      """,
      (portal_id, provider, nonce, ciphertext, secret_digest(token)),
    )
    db.execute(
      """
      UPDATE portals
      SET status = ?, api_connected = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (f"{provider} token stored", portal_id),
    )


def list_portals():
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
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
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      GROUP BY portals.id
      ORDER BY portals.id
      """
    ).fetchall()
  return rows


def parse_portal_members(value):
  members = {}
  for item in (value or "").split(","):
    role, separator, login = item.partition(":")
    if separator and role and login:
      members[role] = login
  return members


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
    "isDemo": False,
  }


def get_portal_row(portal_id):
  init_db()
  with connect_db() as db:
    return db.execute(
      """
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
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      WHERE portals.id = ?
      GROUP BY portals.id
      """,
      (portal_id,),
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
  return photo.get("tm") or photo.get("c246x328") or photo.get("square") or photo.get("big") or ""


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
    "vendorCode": card.get("vendorCode") or "",
    "title": title,
    "brand": card.get("brand") or "",
    "subjectName": card.get("subjectName") or "категория не указана",
    "photoUrl": first_photo_url(card),
    "quality": quality,
    "qualityClass": quality_class,
    "issue": issues[0] if issues else "Нет критичных",
    "issueCount": len(issues),
    "status": status,
    "statusClass": status_class,
    "updatedAt": card.get("updatedAt") or "",
  }


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
    if path == "/api/session":
      user = self.current_user()
      self.send_json(HTTPStatus.OK, {"user": public_user(user) if user else None})
      return

    if path == "/api/users":
      if not self.require_user():
        return
      with connect_db() as db:
        rows = db.execute(
          """
          SELECT login, full_name, role, user_role, access_level
          FROM users
          WHERE is_active = 1
          ORDER BY id
          """
        ).fetchall()
      self.send_json(HTTPStatus.OK, {"users": [public_user(row) for row in rows]})
      return

    if path == "/api/portals":
      if not self.require_user():
        return
      self.send_json(
        HTTPStatus.OK,
        {"portals": [public_portal_from_row(row) for row in list_portals()]},
      )
      return

    if path == "/api/wb/cards":
      if not self.require_user():
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", ["demo-wb"])[0]
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
        try:
          snapshot = fetch_wb_cards(api_key, max_cards=100)
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
      if not user_can_manage_portals(user):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return

      action = "restore" if path.endswith("/restore") else "archive"
      suffix = f"/{action}"
      portal_id_text = path[len("/api/portals/"):-len(suffix)].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return

      row = set_portal_active(portal_id, action == "restore")
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/team"):
      if not self.require_user():
        return
      portal_id_text = path[len("/api/portals/"):-len("/team")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
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
