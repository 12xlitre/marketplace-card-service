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
import ssl
import time
import threading
import contextvars
import uuid
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

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
MAX_JSON_BYTES = 512 * 1024
MAX_DRAFT_JSON_BYTES = int(os.environ.get("OPTICARDS_MAX_DRAFT_JSON_BYTES", str(4 * 1024 * 1024)))
WORK_PERIOD_ATTACHMENT_MAX_BYTES = int(os.environ.get("OPTICARDS_WORK_PERIOD_ATTACHMENT_MAX_BYTES", str(2 * 1024 * 1024)))
WORK_PERIOD_ATTACHMENT_MAX_DATA_URL_BYTES = int(WORK_PERIOD_ATTACHMENT_MAX_BYTES * 4 / 3) + 4096
SECRET_KEY_ENV = "OPTICARDS_SECRET_KEY"
WB_PROVIDER = "wb"
MPSTATS_PROVIDER = "mpstats"
MPSTATS_API_BASE = os.environ.get("MPSTATS_API_BASE", "https://mpstats.io/api")
MPSTATS_CHECK_ITEM_ID = os.environ.get("MPSTATS_CHECK_ITEM_ID", "265906486")
WB_ENV_TOKEN = "WB_API_TOKEN"
WB_CONTENT_API_BASE = os.environ.get("WB_CONTENT_API_BASE", "https://content-api.wildberries.ru")
WB_COMMON_API_BASE = os.environ.get("WB_COMMON_API_BASE", "https://common-api.wildberries.ru")
WB_PRICES_API_BASE = os.environ.get("WB_PRICES_API_BASE", "https://discounts-prices-api.wildberries.ru")
WB_MARKETPLACE_API_BASE = os.environ.get("WB_MARKETPLACE_API_BASE", "https://marketplace-api.wildberries.ru")
WB_ANALYTICS_API_BASE = os.environ.get("WB_ANALYTICS_API_BASE", "https://seller-analytics-api.wildberries.ru")
WB_STATISTICS_API_BASE = os.environ.get("WB_STATISTICS_API_BASE", "https://statistics-api.wildberries.ru")
WB_ADVERT_API_BASE = os.environ.get("WB_ADVERT_API_BASE", "https://advert-api.wildberries.ru")
WB_PROMO_CALENDAR_API_BASE = os.environ.get("WB_PROMO_CALENDAR_API_BASE", "https://dp-calendar-api.wildberries.ru")
WB_CONNECT_TIMEOUT = float(os.environ.get("WB_CONNECT_TIMEOUT", "5"))
WB_READ_TIMEOUT = float(os.environ.get("WB_READ_TIMEOUT", "20"))
WB_PUBLIC_BASKET_CACHE = {}
MPSTATS_CONNECT_TIMEOUT = float(os.environ.get("MPSTATS_CONNECT_TIMEOUT", "5"))
MPSTATS_READ_TIMEOUT = float(os.environ.get("MPSTATS_READ_TIMEOUT", "15"))
MPSTATS_CHARACTERISTICS_CACHE_TTL_SECONDS = int(os.environ.get("MPSTATS_CHARACTERISTICS_CACHE_TTL_SECONDS", "86400"))
AUDIT_MARKET_CACHE_TTL_SECONDS = int(os.environ.get("AUDIT_MARKET_CACHE_TTL_SECONDS", "21600"))
CARD_COMPETITOR_LIMIT = 3
CARD_COMPETITOR_AUTO_CHECK_DAYS = int(os.environ.get("CARD_COMPETITOR_AUTO_CHECK_DAYS", "7"))
CARD_COMPETITOR_AUTO_CHECK_INTERVAL_SECONDS = int(os.environ.get("CARD_COMPETITOR_AUTO_CHECK_INTERVAL_SECONDS", "3600"))
CARD_COMPETITOR_AUTO_CHECK_MAX_BATCH = int(os.environ.get("CARD_COMPETITOR_AUTO_CHECK_MAX_BATCH", "12"))
CARD_COMPETITOR_AUTO_CHECK_ENABLED = os.environ.get("CARD_COMPETITOR_AUTO_CHECK_ENABLED", "1") != "0"
MPSTATS_STORE_BOOTSTRAP_MAX_CARDS = int(os.environ.get("MPSTATS_STORE_BOOTSTRAP_MAX_CARDS", "100"))
MPSTATS_STORE_FULL_IMPORT_MAX_CARDS = int(os.environ.get("MPSTATS_STORE_FULL_IMPORT_MAX_CARDS", "1000"))
MPSTATS_STORE_IMPORT_BATCH_SIZE = int(os.environ.get("MPSTATS_STORE_IMPORT_BATCH_SIZE", "100"))
MPSTATS_API_EVENT_RETENTION_DAYS = int(os.environ.get("MPSTATS_API_EVENT_RETENTION_DAYS", "90"))
MPSTATS_SEMANTIC_PERIOD_DAYS = int(os.environ.get("MPSTATS_SEMANTIC_PERIOD_DAYS", "30"))
MPSTATS_SEMANTIC_PERIOD_LAG_DAYS = int(os.environ.get("MPSTATS_SEMANTIC_PERIOD_LAG_DAYS", "1"))
MPSTATS_SEMANTIC_HIGH_FREQUENCY = int(os.environ.get("MPSTATS_SEMANTIC_HIGH_FREQUENCY", "5000"))
MPSTATS_SEMANTIC_MEDIUM_FREQUENCY = int(os.environ.get("MPSTATS_SEMANTIC_MEDIUM_FREQUENCY", "2000"))
WB_CLIENT_REPORT_WEEKS = int(os.environ.get("WB_CLIENT_REPORT_WEEKS", "8"))
WB_CLIENT_REPORT_ANALYTICS_MAX_CALLS = int(os.environ.get("WB_CLIENT_REPORT_ANALYTICS_MAX_CALLS", "3"))
WB_CLIENT_REPORT_PROMO_MAX = int(os.environ.get("WB_CLIENT_REPORT_PROMO_MAX", "10"))
OPTICARDS_LLM_API_KEY = os.environ.get("OPTICARDS_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
OPTICARDS_LLM_API_BASE = os.environ.get("OPTICARDS_LLM_API_BASE") or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPTICARDS_LLM_MODEL = os.environ.get("OPTICARDS_LLM_MODEL", "gpt-4o-mini")
GIGACHAT_AUTH_KEY = os.environ.get("GIGACHAT_AUTH_KEY", "").strip()
GIGACHAT_SCOPE = os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS").strip() or "GIGACHAT_API_PERS"
GIGACHAT_OAUTH_URL = os.environ.get("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth")
GIGACHAT_API_BASE = os.environ.get("GIGACHAT_API_BASE", "https://gigachat.devices.sberbank.ru/api/v1")
GIGACHAT_MODEL = os.environ.get("GIGACHAT_MODEL", "GigaChat")
GIGACHAT_VERIFY_SSL = os.environ.get("GIGACHAT_VERIFY_SSL", "0").strip().lower() in {"1", "true", "yes", "on"}
OPTICARDS_LLM_PROVIDER = os.environ.get("OPTICARDS_LLM_PROVIDER", "gigachat" if GIGACHAT_AUTH_KEY else "openai").strip().lower()
WB_MAX_CARDS_PER_SYNC = 1000
WB_CHARCS_CACHE_TTL_SECONDS = int(os.environ.get("WB_CHARCS_CACHE_TTL_SECONDS", "21600"))
WB_TOKEN_LIFETIME_DAYS = 180
WB_CHARACTERISTICS_CACHE = {}
WB_DIRECTORY_CACHE = {}
AUDIT_MARKET_CACHE = {}
GIGACHAT_TOKEN_CACHE = {"accessToken": "", "expiresAt": 0}
MPSTATS_USAGE_CONTEXT = contextvars.ContextVar("mpstats_usage", default=None)
MPSTATS_CALL_CONTEXT = contextvars.ContextVar("mpstats_call_context", default={})
CARD_COMPETITOR_AUTO_CHECK_LOCK = threading.Lock()
CARD_COMPETITOR_AUTO_CHECK_WORKER_STARTED = False
MPSTATS_STORE_IMPORT_LOCK = threading.Lock()
MPSTATS_STORE_IMPORT_JOBS = {}


def utc_now():
  return dt.datetime.now(dt.timezone.utc)


def iso_now_plus(seconds):
  return (utc_now() + dt.timedelta(seconds=seconds)).isoformat()


def mpstats_usage_start():
  usage = {
    "apiRequests": 0,
    "cacheHits": 0,
    "creditsEstimate": 0,
    "requests": [],
    "cache": [],
  }
  return MPSTATS_USAGE_CONTEXT.set(usage), usage


def mpstats_usage_stop(token):
  MPSTATS_USAGE_CONTEXT.reset(token)


def mpstats_call_context_start(user=None, source_area="", portal_id="", card_key="", nm_id="", details=None):
  user = user if user is not None else {}
  context = {
    "actorLogin": audit_str(user["login"] if isinstance(user, sqlite3.Row) and "login" in user.keys() else (user.get("login") if isinstance(user, dict) else "")),
    "actorName": audit_str(user["full_name"] if isinstance(user, sqlite3.Row) and "full_name" in user.keys() else (user.get("full_name") if isinstance(user, dict) else "")),
    "sourceArea": audit_str(source_area or "MPStats"),
    "portalId": audit_str(portal_id),
    "cardKey": audit_str(card_key),
    "nmID": audit_str(nm_id),
    "details": details if isinstance(details, dict) else {},
  }
  return MPSTATS_CALL_CONTEXT.set(context)


def mpstats_call_context_stop(token):
  MPSTATS_CALL_CONTEXT.reset(token)


def mpstats_balance_from_headers(headers):
  if not headers:
    return ""
  for name in (
    "X-RateLimit-Remaining",
    "X-Rate-Limit-Remaining",
    "X-Request-Remaining",
    "X-Requests-Remaining",
    "X-Credits-Remaining",
    "X-Balance-Remaining",
    "X-Mpstats-Remaining",
  ):
    value = headers.get(name)
    if value not in (None, ""):
      return audit_str(value, 80)
  return ""


def record_mpstats_api_event(method, path, source, status, credits_estimate, balance_remaining="", http_status=""):
  try:
    context = MPSTATS_CALL_CONTEXT.get() or {}
    with connect_db() as db:
      db.execute(
        """
        INSERT INTO mpstats_api_events (
          actor_login, actor_name, source_area, portal_id, card_key, nm_id,
          method, path, source, status, http_status, credits_estimate,
          balance_remaining, details_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
          audit_str(context.get("actorLogin"), 120),
          audit_str(context.get("actorName"), 180),
          audit_str(context.get("sourceArea") or "MPStats", 180),
          audit_str(context.get("portalId"), 80),
          audit_str(context.get("cardKey"), 120),
          audit_str(context.get("nmID"), 80),
          audit_str(method, 12),
          audit_str(path, 420),
          audit_str(source, 24),
          audit_str(status, 80),
          audit_str(http_status, 24),
          int(credits_estimate or 0),
          audit_str(balance_remaining, 80),
          json.dumps(context.get("details") if isinstance(context.get("details"), dict) else {}, ensure_ascii=False),
        ),
      )
      db.execute(
        """
        DELETE FROM mpstats_api_events
        WHERE created_at < datetime('now', ?)
        """,
        (f"-{max(1, MPSTATS_API_EVENT_RETENTION_DAYS)} days",),
      )
  except Exception:
    # Журналирование не должно ломать рабочий сценарий MPStats.
    return


def mpstats_usage_record(method, path, source="api", status="sent", http_status="", balance_remaining=""):
  usage = MPSTATS_USAGE_CONTEXT.get()
  credits_estimate = 0 if source == "cache" else 1
  entry = {
    "method": method,
    "path": str(path or "")[:220],
    "source": source,
    "status": status,
    "httpStatus": str(http_status or ""),
    "balanceRemaining": str(balance_remaining or ""),
  }
  if usage is not None:
    if source == "cache":
      usage["cacheHits"] += 1
      usage["cache"].append(entry)
    else:
      usage["apiRequests"] += 1
      usage["creditsEstimate"] += credits_estimate
      usage["requests"].append(entry)
  record_mpstats_api_event(method, path, source, status, credits_estimate, balance_remaining=balance_remaining, http_status=http_status)


def mpstats_usage_public(usage):
  usage = usage if isinstance(usage, dict) else {}
  return {
    "creditsEstimate": int(usage.get("creditsEstimate") or 0),
    "apiRequests": int(usage.get("apiRequests") or 0),
    "cacheHits": int(usage.get("cacheHits") or 0),
    "rule": "MPStats: 1 API request = 1 external analytics limit",
    "requests": (usage.get("requests") or [])[:20],
    "cache": (usage.get("cache") or [])[:20],
  }


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
        cards_snapshot_json TEXT NOT NULL DEFAULT '',
        store_url TEXT NOT NULL DEFAULT '',
        manual_source TEXT NOT NULL DEFAULT '',
        client_contact_json TEXT NOT NULL DEFAULT '{}',
        client_name TEXT NOT NULL DEFAULT '',
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

      CREATE TABLE IF NOT EXISTS semantic_core_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        keywords_json TEXT NOT NULL DEFAULT '[]',
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (portal_id, name)
      );

      CREATE TABLE IF NOT EXISTS card_approval_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        card_key TEXT NOT NULL,
        nm_id TEXT NOT NULL DEFAULT '',
        vendor_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_login TEXT NOT NULL DEFAULT '',
        assignee_login TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS card_competitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        card_key TEXT NOT NULL,
        nm_id TEXT NOT NULL DEFAULT '',
        vendor_code TEXT NOT NULL DEFAULT '',
        competitor_nm_id TEXT NOT NULL,
        competitor_url TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        previous_snapshot_json TEXT NOT NULL DEFAULT '{}',
        changed_fields_json TEXT NOT NULL DEFAULT '[]',
        review_json TEXT NOT NULL DEFAULT '{}',
        last_checked_at TEXT,
        next_auto_check_at TEXT,
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (portal_id, card_key, competitor_nm_id)
      );

      CREATE TABLE IF NOT EXISTS portal_workset_cards (
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        card_key TEXT NOT NULL,
        nm_id TEXT NOT NULL DEFAULT '',
        vendor_code TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        subject_name TEXT NOT NULL DEFAULT '',
        selected_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (portal_id, card_key)
      );

      CREATE TABLE IF NOT EXISTS ozon_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        card_key TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        offer_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        work_type TEXT NOT NULL DEFAULT 'content',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (portal_id, task_id),
        UNIQUE (portal_id, card_key)
      );

      CREATE TABLE IF NOT EXISTS ozon_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL DEFAULT '',
        card_key TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        actor_login TEXT NOT NULL DEFAULT '',
        event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

      CREATE TABLE IF NOT EXISTS admin_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_login TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        portal_id INTEGER,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mpstats_api_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_login TEXT NOT NULL DEFAULT '',
        actor_name TEXT NOT NULL DEFAULT '',
        source_area TEXT NOT NULL DEFAULT '',
        portal_id TEXT NOT NULL DEFAULT '',
        card_key TEXT NOT NULL DEFAULT '',
        nm_id TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'api',
        status TEXT NOT NULL DEFAULT '',
        http_status TEXT NOT NULL DEFAULT '',
        credits_estimate INTEGER NOT NULL DEFAULT 0,
        balance_remaining TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS report_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL DEFAULT '',
        report_title TEXT NOT NULL DEFAULT '',
        report_format TEXT NOT NULL DEFAULT 'XLSX',
        period_start TEXT NOT NULL DEFAULT '',
        period_end TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'done',
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS portal_work_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        tasks_json TEXT NOT NULL DEFAULT '[]',
        report_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(login) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    if "cards_snapshot_json" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN cards_snapshot_json TEXT NOT NULL DEFAULT ''")
    if "store_url" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN store_url TEXT NOT NULL DEFAULT ''")
    if "manual_source" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN manual_source TEXT NOT NULL DEFAULT ''")
    if "client_contact_json" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN client_contact_json TEXT NOT NULL DEFAULT '{}'")
    if "client_name" not in portal_columns:
      db.execute("ALTER TABLE portals ADD COLUMN client_name TEXT NOT NULL DEFAULT ''")
    integration_columns = {row["name"] for row in db.execute("PRAGMA table_info(portal_integrations)").fetchall()}
    if "external_key" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN external_key TEXT NOT NULL DEFAULT ''")
    if "token_issued_at" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN token_issued_at TEXT")
    if "token_expires_at" not in integration_columns:
      db.execute("ALTER TABLE portal_integrations ADD COLUMN token_expires_at TEXT")
    competitor_columns = {row["name"] for row in db.execute("PRAGMA table_info(card_competitors)").fetchall()}
    if "review_json" not in competitor_columns:
      db.execute("ALTER TABLE card_competitors ADD COLUMN review_json TEXT NOT NULL DEFAULT '{}'")
    if "next_auto_check_at" not in competitor_columns:
      db.execute("ALTER TABLE card_competitors ADD COLUMN next_auto_check_at TEXT")
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
      CREATE INDEX IF NOT EXISTS idx_semantic_core_collections_portal_updated
      ON semantic_core_collections(portal_id, updated_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_admin_events_created_at
      ON admin_events(created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_mpstats_api_events_created_at
      ON mpstats_api_events(created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_mpstats_api_events_actor
      ON mpstats_api_events(actor_login, created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_mpstats_api_events_area
      ON mpstats_api_events(source_area, created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_admin_events_portal
      ON admin_events(portal_id, created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_report_history_portal
      ON report_history(portal_id, created_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_portal_work_periods_portal
      ON portal_work_periods(portal_id, period_start, period_end)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_card_approval_events_portal_event
      ON card_approval_events(portal_id, event_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_card_approval_events_portal_card
      ON card_approval_events(portal_id, card_key)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_card_competitors_portal_card
      ON card_competitors(portal_id, card_key, position)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_card_competitors_next_auto_check
      ON card_competitors(next_auto_check_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_portal_workset_cards_portal
      ON portal_workset_cards(portal_id, updated_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_ozon_tasks_portal
      ON ozon_tasks(portal_id, updated_at)
      """
    )
    db.execute(
      """
      CREATE INDEX IF NOT EXISTS idx_ozon_task_events_portal
      ON ozon_task_events(portal_id, event_at)
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
    "is_active": bool(row["is_active"]) if "is_active" in row.keys() else True,
  }


def admin_event_details(details):
  if not isinstance(details, dict):
    return {}
  blocked_keys = {"password", "apiKey", "api_key", "token", "secret", "token_ciphertext", "token_nonce"}
  output = {}
  for key, value in details.items():
    if key in blocked_keys:
      continue
    if isinstance(value, (str, int, float, bool)) or value is None:
      output[key] = str(value)[:240] if isinstance(value, str) else value
    elif isinstance(value, (list, tuple)):
      output[key] = [str(item)[:160] if not isinstance(item, (int, float, bool)) else item for item in value[:12]]
    elif isinstance(value, dict):
      output[key] = {
        str(inner_key)[:80]: (str(inner_value)[:160] if not isinstance(inner_value, (int, float, bool)) else inner_value)
        for inner_key, inner_value in list(value.items())[:20]
        if inner_key not in blocked_keys
      }
  return output


def record_admin_event(actor, action, target_type="", target_id="", portal_id=None, details=None):
  actor_login = actor["login"] if isinstance(actor, sqlite3.Row) else (actor or {}).get("login", "")
  clean_action = str(action or "").strip()[:80]
  if not clean_action:
    return
  try:
    numeric_portal_id = int(portal_id) if portal_id not in (None, "") else None
  except (TypeError, ValueError):
    numeric_portal_id = None
  try:
    init_db()
    with connect_db() as db:
      db.execute(
        """
        INSERT INTO admin_events (actor_login, action, target_type, target_id, portal_id, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
          str(actor_login or "")[:120],
          clean_action,
          str(target_type or "")[:80],
          str(target_id or "")[:160],
          numeric_portal_id,
          json.dumps(admin_event_details(details), ensure_ascii=False, separators=(",", ":")),
        ),
      )
  except Exception as exc:
    print(f"Admin event record failed: {type(exc).__name__}: {exc}")


def public_admin_event(row):
  try:
    details = json.loads(row["details_json"] or "{}")
  except (TypeError, json.JSONDecodeError):
    details = {}
  return {
    "id": row["id"],
    "actorLogin": row["actor_login"] or "",
    "action": row["action"] or "",
    "targetType": row["target_type"] or "",
    "targetId": row["target_id"] or "",
    "portalId": str(row["portal_id"]) if row["portal_id"] is not None else "",
    "details": details if isinstance(details, dict) else {},
    "createdAt": row["created_at"] or "",
  }


def list_admin_events(user, limit=80):
  if not user_can_manage_portals(user):
    raise PermissionError("forbidden")
  limit = max(1, min(int(limit or 80), 200))
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT id, actor_login, action, target_type, target_id, portal_id, details_json, created_at
      FROM admin_events
      ORDER BY id DESC
      LIMIT ?
      """,
      (limit,),
    ).fetchall()
  return [public_admin_event(row) for row in rows]


def public_mpstats_api_event(row):
  try:
    details = json.loads(row["details_json"] or "{}")
  except (TypeError, json.JSONDecodeError):
    details = {}
  return {
    "id": row["id"],
    "createdAt": row["created_at"] or "",
    "actorLogin": row["actor_login"] or "",
    "actorName": row["actor_name"] or "",
    "sourceArea": row["source_area"] or "",
    "portalId": row["portal_id"] or "",
    "cardKey": row["card_key"] or "",
    "nmID": row["nm_id"] or "",
    "method": row["method"] or "",
    "path": row["path"] or "",
    "source": row["source"] or "",
    "status": row["status"] or "",
    "httpStatus": row["http_status"] or "",
    "creditsEstimate": int(row["credits_estimate"] or 0),
    "balanceRemaining": row["balance_remaining"] or "",
    "details": details if isinstance(details, dict) else {},
  }


def mpstats_api_usage_report(user, limit=1000):
  if not user_can_manage_portals(user):
    raise PermissionError("forbidden")
  limit = max(1, min(int(limit or 1000), 5000))
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT id, actor_login, actor_name, source_area, portal_id, card_key, nm_id,
             method, path, source, status, http_status, credits_estimate,
             balance_remaining, details_json, created_at
      FROM mpstats_api_events
      ORDER BY id DESC
      LIMIT ?
      """,
      (limit,),
    ).fetchall()
    summary = db.execute(
      """
      SELECT
        COUNT(*) AS event_count,
        SUM(CASE WHEN source = 'api' THEN 1 ELSE 0 END) AS api_requests,
        SUM(CASE WHEN source = 'cache' THEN 1 ELSE 0 END) AS cache_hits,
        SUM(credits_estimate) AS credits_estimate,
        MIN(created_at) AS first_at,
        MAX(created_at) AS last_at
      FROM (
        SELECT source, credits_estimate, created_at
        FROM mpstats_api_events
        ORDER BY id DESC
        LIMIT ?
      )
      """,
      (limit,),
    ).fetchone()
  events = [public_mpstats_api_event(row) for row in rows]
  balance_remaining = next((item["balanceRemaining"] for item in events if item.get("balanceRemaining")), "")
  return {
    "events": events,
    "summary": {
      "eventCount": int(summary["event_count"] or 0) if summary else 0,
      "apiRequests": int(summary["api_requests"] or 0) if summary else 0,
      "cacheHits": int(summary["cache_hits"] or 0) if summary else 0,
      "creditsEstimate": int(summary["credits_estimate"] or 0) if summary else 0,
      "balanceRemaining": balance_remaining,
      "balanceNote": "MPStats публично списывает 1 лимит за 1 API-запрос; остаток лимита не пришел в headers API." if not balance_remaining else "",
      "firstAt": (summary["first_at"] or "") if summary else "",
      "lastAt": (summary["last_at"] or "") if summary else "",
      "limit": limit,
      "retentionDays": MPSTATS_API_EVENT_RETENTION_DAYS,
    },
  }


def clean_report_text(value, limit=180):
  return str(value or "").strip()[:limit]


def clean_report_date(value):
  text = str(value or "").strip()
  if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
    try:
      dt.date.fromisoformat(text)
      return text
    except ValueError:
      return ""
  return ""


def public_report_history(row):
  return {
    "id": str(row["id"]),
    "portalId": str(row["portal_id"]),
    "reportId": row["report_id"] or "",
    "title": row["report_title"] or "",
    "format": row["report_format"] or "XLSX",
    "period": {
      "start": row["period_start"] or "",
      "end": row["period_end"] or "",
    },
    "fileName": row["file_name"] or "",
    "source": row["source"] or "",
    "status": row["status"] or "done",
    "generatedBy": row["created_by"] or "",
    "generatedAt": row["created_at"] or "",
  }


def list_report_history(portal_id, user, limit=20):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  limit = max(1, min(int(limit or 20), 100))
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    rows = db.execute(
      """
      SELECT id, portal_id, report_id, report_title, report_format, period_start, period_end,
             file_name, source, status, created_by, created_at
      FROM report_history
      WHERE portal_id = ?
      ORDER BY id DESC
      LIMIT ?
      """,
      (numeric_portal_id, limit),
    ).fetchall()
  return [public_report_history(row) for row in rows]


def create_report_history(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  period = payload.get("period") if isinstance(payload.get("period"), dict) else {}
  start = clean_report_date(period.get("start") or payload.get("start"))
  end = clean_report_date(period.get("end") or payload.get("end"))
  if not start or not end or start > end:
    raise ValueError("invalid_report_period")
  report_id = clean_report_text(payload.get("reportId") or payload.get("report_id") or "wb-client-xlsx", 80)
  title = clean_report_text(payload.get("title") or "WB клиентский XLSX", 180)
  report_format = clean_report_text(payload.get("format") or "XLSX", 20)
  file_name = clean_report_text(payload.get("fileName") or payload.get("file_name") or "", 220)
  source = clean_report_text(payload.get("source") or "", 80)
  status = clean_report_text(payload.get("status") or "done", 20)
  if status not in {"done", "partial", "error"}:
    status = "done"
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id, name FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    cursor = db.execute(
      """
      INSERT INTO report_history (
        portal_id, report_id, report_title, report_format, period_start, period_end,
        file_name, source, status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      (
        numeric_portal_id,
        report_id,
        title,
        report_format,
        start,
        end,
        file_name,
        source,
        status,
        user["login"],
      ),
    )
    row = db.execute(
      """
      SELECT id, portal_id, report_id, report_title, report_format, period_start, period_end,
             file_name, source, status, created_by, created_at
      FROM report_history
      WHERE id = ?
      """,
      (cursor.lastrowid,),
    ).fetchone()
  record_admin_event(user, "report_generated", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "portalName": portal["name"] if portal else "",
    "reportTitle": title,
    "period": f"{start} - {end}",
    "status": status,
  })
  return public_report_history(row)


def admin_system_status(user):
  if not user_can_manage_portals(user):
    raise PermissionError("forbidden")
  provider = OPTICARDS_LLM_PROVIDER or "openai"
  if provider == "gigachat":
    configured = bool(GIGACHAT_AUTH_KEY)
    model = GIGACHAT_MODEL
    source = "GigaChat"
  else:
    configured = bool(OPTICARDS_LLM_API_KEY)
    model = OPTICARDS_LLM_MODEL
    source = provider or "OpenAI-compatible"
  return {
    "llm": {
      "provider": provider,
      "source": source,
      "model": model,
      "configured": configured,
      "status": "configured" if configured else "missing",
    },
    "storage": {
      "secretKeyConfigured": bool(os.environ.get(SECRET_KEY_ENV, "").strip()),
      "database": DB_PATH.name,
    },
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


def user_is_admin(row):
  if not row:
    return False
  marker = f"{row['user_role']} {row['access_level']} {row['role']}".lower()
  return any(part in marker for part in ("admin", "all", "полный", "админ"))


def user_login_value(user):
  if isinstance(user, sqlite3.Row):
    return user["login"] if "login" in user.keys() else ""
  if isinstance(user, dict):
    return user.get("login", "")
  return ""


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
  login = user_login_value(user)
  with connect_db() as db:
    row = db.execute(
      """
      SELECT portals.id
      FROM portals
      WHERE portals.id = ?
        AND portals.is_active = 1
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
  raw_days_left = int(seconds_left // 86400)
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


def wb_snapshot_cards_json(snapshot):
  cards = snapshot.get("cards") if isinstance(snapshot, dict) else []
  if not isinstance(cards, list):
    cards = []
  return json.dumps(cards[:WB_MAX_CARDS_PER_SYNC], ensure_ascii=False, separators=(",", ":"))


def wb_snapshot_cards_from_row(row):
  try:
    cards = json.loads(row["cards_snapshot_json"] or "[]")
  except (KeyError, TypeError, json.JSONDecodeError):
    cards = []
  return cards if isinstance(cards, list) else []


def create_portal(name, marketplace, scope, created_by, team, store_url="", manual_source="", client_name=""):
  init_db()
  with connect_db() as db:
    cursor = db.execute(
      """
      INSERT INTO portals (name, marketplace, scope, status, store_url, manual_source, client_name, created_by)
      VALUES (?, ?, ?, 'Ручной режим', ?, ?, ?, ?)
      """,
      (name, marketplace, scope, store_url, manual_source, client_name, created_by),
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
  record_admin_event({"login": created_by or ""}, "portal_created", "portal", portal_id, portal_id=portal_id, details={
    "portalName": name,
    "marketplace": marketplace,
    "scope": scope,
    "mode": "manual",
    "clientName": client_name,
  })
  return portal_id


def create_connected_wb_portal(name, marketplace, scope, created_by, team, token, snapshot, client_name=""):
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
        card_count, work_count, problem_count, cards_snapshot_json, client_name, created_by, last_sync_at
      )
      VALUES (?, ?, ?, 'WB read-only', 1, ?, ?, ?, ?, ?, ?, ?)
      """,
      (
        portal_name,
        marketplace,
        scope,
        stats.get("cardCount", 0),
        stats.get("workCount", 0),
        stats.get("problemCount", 0),
        wb_snapshot_cards_json(snapshot),
        client_name,
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
  record_admin_event({"login": created_by or ""}, "portal_created", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal_name,
    "marketplace": marketplace,
    "scope": scope,
    "mode": "api",
  })
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
  filters = []
  if user is not None and not user_has_global_portal_access(user):
    filters.append("portals.is_active = 1")
    access_filter = """
      (
        portals.created_by = ?
        OR EXISTS (
          SELECT 1
          FROM portal_members AS access_members
          WHERE access_members.portal_id = portals.id
            AND access_members.user_login = ?
        )
      )
    """
    filters.append(access_filter)
    params = [user["login"], user["login"]]
  where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
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
        portals.cards_snapshot_json,
        portals.store_url,
        portals.manual_source,
        portals.client_contact_json,
        portals.client_name,
        portals.created_by,
        portals.created_at,
        portals.last_sync_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_issued_at END) AS wb_token_issued_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_expires_at END) AS wb_token_expires_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_nonce END) AS wb_token_nonce,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_ciphertext END) AS wb_token_ciphertext,
        COALESCE(MAX(draft_stats.draft_count), 0) AS draft_count,
        COALESCE(MAX(draft_stats.audit_count), 0) AS audit_count,
        COALESCE(MAX(draft_stats.approval_pending_count), 0) AS approval_pending_count,
        COALESCE(MAX(draft_stats.approval_returned_count), 0) AS approval_returned_count,
        COALESCE(MAX(draft_stats.approval_approved_count), 0) AS approval_approved_count,
        MAX(draft_stats.last_draft_at) AS last_draft_at,
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      LEFT JOIN (
        SELECT
          portal_id,
          COUNT(*) AS draft_count,
          SUM(CASE WHEN audit_status = 'done' THEN 1 ELSE 0 END) AS audit_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'submitted' THEN 1 ELSE 0 END) AS approval_pending_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'changes_requested' THEN 1 ELSE 0 END) AS approval_returned_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'approved' THEN 1 ELSE 0 END) AS approval_approved_count,
          MAX(updated_at) AS last_draft_at
        FROM card_drafts
        GROUP BY portal_id
      ) AS draft_stats ON draft_stats.portal_id = portals.id
      {where_clause}
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


def empty_portal_work_task_summary():
  return {
    "taskTotalCount": 0,
    "taskActiveCount": 0,
    "taskDraftCount": 0,
    "taskPendingCount": 0,
    "taskReturnedCount": 0,
    "taskApprovedCount": 0,
    "lastTaskAt": "",
  }


def portal_work_task_summaries(portal_ids):
  normalized_ids = []
  seen = set()
  for portal_id in portal_ids:
    try:
      numeric_id = int(portal_id)
    except (TypeError, ValueError):
      continue
    if numeric_id in seen:
      continue
    seen.add(numeric_id)
    normalized_ids.append(numeric_id)
  summaries = {portal_id: empty_portal_work_task_summary() for portal_id in normalized_ids}
  if not normalized_ids:
    return summaries
  placeholders = ",".join("?" for _ in normalized_ids)
  init_db()
  with connect_db() as db:
    rows = db.execute(
      f"""
      SELECT portal_id, payload_json, updated_at
      FROM card_drafts
      WHERE portal_id IN ({placeholders})
      """,
      normalized_ids,
    ).fetchall()
  for row in rows:
    portal_id = int(row["portal_id"])
    summary = summaries.setdefault(portal_id, empty_portal_work_task_summary())
    try:
      payload = json.loads(row["payload_json"])
    except (TypeError, json.JSONDecodeError):
      continue
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    work_types = active_task_work_types(meta)
    if not work_types:
      continue
    status = task_status_for_work_types(meta, work_types)
    if status not in {"draft", "submitted", "changes_requested", "approved"}:
      continue
    summary["taskTotalCount"] += 1
    if status == "draft":
      summary["taskDraftCount"] += 1
    elif status == "submitted":
      summary["taskPendingCount"] += 1
    elif status == "changes_requested":
      summary["taskReturnedCount"] += 1
    elif status == "approved":
      summary["taskApprovedCount"] += 1
    if status in {"draft", "submitted", "changes_requested"}:
      summary["taskActiveCount"] += 1
    updated_at = row["updated_at"] or ""
    if updated_at and updated_at > summary["lastTaskAt"]:
      summary["lastTaskAt"] = updated_at
  return summaries


def portal_work_task_summary(portal_id):
  try:
    numeric_id = int(portal_id)
  except (TypeError, ValueError):
    return empty_portal_work_task_summary()
  return portal_work_task_summaries([numeric_id]).get(numeric_id, empty_portal_work_task_summary())


def public_portal_from_row(row, task_summary=None):
  team = parse_portal_members(row["members"])
  integrations = row["integrations"] or ""
  has_wb_integration = "wb:" in integrations
  api_connected = bool(row["api_connected"])
  mode = "api" if api_connected or has_wb_integration else "manual"
  status = row["status"] or ""
  if mode == "manual" and status in ("", "draft"):
    status = "Ручной режим"
  manual_sync_status = "mpstats-loaded" if mode == "manual" and int(row["card_count"] or 0) > 0 else "manual"
  task_summary = task_summary if isinstance(task_summary, dict) else portal_work_task_summary(row["id"])
  return {
    "id": str(row["id"]),
    "name": row["name"],
    "marketplace": row["marketplace"],
    "mode": mode,
    "scope": row["scope"],
    "status": status,
    "isActive": bool(row["is_active"]),
    "ownerLogin": team.get("lead", ""),
    "cardCount": row["card_count"],
    "workCount": row["work_count"],
    "problemCount": row["problem_count"],
    "apiConnected": api_connected,
    "storeUrl": row["store_url"] or "",
    "manualSource": row["manual_source"] or "",
    "clientContact": client_contact_from_json(row["client_contact_json"] or "{}"),
    "clientName": row["client_name"] or "",
    "createdBy": row["created_by"] or "",
    "createdAt": row["created_at"] or "",
    "teamRoles": team,
    "memberLogins": [login for login in dict.fromkeys(team.values()) if login],
    "realCards": wb_snapshot_cards_from_row(row),
    "syncStatus": "loaded" if api_connected else ("stored-token" if has_wb_integration else manual_sync_status),
    "lastSyncAt": row["last_sync_at"] or "",
    "tokenMeta": wb_token_meta_for_portal_row(row),
    "draftSummary": {
      "draftCount": int(row["draft_count"] or 0),
      "auditCount": int(row["audit_count"] or 0),
      "approvalPendingCount": int(row["approval_pending_count"] or 0),
      "approvalReturnedCount": int(row["approval_returned_count"] or 0),
      "approvalApprovedCount": int(row["approval_approved_count"] or 0),
      "taskTotalCount": int(task_summary.get("taskTotalCount") or 0),
      "taskActiveCount": int(task_summary.get("taskActiveCount") or 0),
      "taskDraftCount": int(task_summary.get("taskDraftCount") or 0),
      "taskPendingCount": int(task_summary.get("taskPendingCount") or 0),
      "taskReturnedCount": int(task_summary.get("taskReturnedCount") or 0),
      "taskApprovedCount": int(task_summary.get("taskApprovedCount") or 0),
      "lastDraftAt": row["last_draft_at"] or "",
      "lastTaskAt": task_summary.get("lastTaskAt") or "",
    },
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
        portals.cards_snapshot_json,
        portals.store_url,
        portals.manual_source,
        portals.client_contact_json,
        portals.client_name,
        portals.created_by,
        portals.created_at,
        portals.last_sync_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_issued_at END) AS wb_token_issued_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_expires_at END) AS wb_token_expires_at,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_nonce END) AS wb_token_nonce,
        MAX(CASE WHEN portal_integrations.provider = 'wb' THEN portal_integrations.token_ciphertext END) AS wb_token_ciphertext,
        COALESCE(MAX(draft_stats.draft_count), 0) AS draft_count,
        COALESCE(MAX(draft_stats.audit_count), 0) AS audit_count,
        COALESCE(MAX(draft_stats.approval_pending_count), 0) AS approval_pending_count,
        COALESCE(MAX(draft_stats.approval_returned_count), 0) AS approval_returned_count,
        COALESCE(MAX(draft_stats.approval_approved_count), 0) AS approval_approved_count,
        MAX(draft_stats.last_draft_at) AS last_draft_at,
        GROUP_CONCAT(DISTINCT portal_members.project_role || ':' || portal_members.user_login) AS members,
        GROUP_CONCAT(DISTINCT portal_integrations.provider || ':' || portal_integrations.status) AS integrations
      FROM portals
      LEFT JOIN portal_members ON portal_members.portal_id = portals.id
      LEFT JOIN portal_integrations ON portal_integrations.portal_id = portals.id
      LEFT JOIN (
        SELECT
          portal_id,
          COUNT(*) AS draft_count,
          SUM(CASE WHEN audit_status = 'done' THEN 1 ELSE 0 END) AS audit_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'submitted' THEN 1 ELSE 0 END) AS approval_pending_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'changes_requested' THEN 1 ELSE 0 END) AS approval_returned_count,
          SUM(CASE WHEN json_extract(payload_json, '$.meta.approval.status') = 'approved' THEN 1 ELSE 0 END) AS approval_approved_count,
          MAX(updated_at) AS last_draft_at
        FROM card_drafts
        GROUP BY portal_id
      ) AS draft_stats ON draft_stats.portal_id = portals.id
      WHERE portals.id = ?
      {access_filter}
      GROUP BY portals.id
      """,
      params,
    ).fetchone()


def update_portal_team(portal_id, team, actor=None):
  init_db()
  previous_team = {}
  with connect_db() as db:
    portal = db.execute("SELECT id, name FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      return None
    previous_team = {
      row["project_role"]: row["user_login"]
      for row in db.execute(
        "SELECT project_role, user_login FROM portal_members WHERE portal_id = ?",
        (portal_id,),
      ).fetchall()
    }
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
  record_admin_event(actor, "portal_team_updated", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal["name"] if portal else "",
    "previousTeam": previous_team,
    "nextTeam": team,
  })
  return get_portal_row(portal_id)


def update_portal_client_contact(portal_id, contact, actor=None):
  clean_contact = clean_client_contact(contact)
  init_db()
  portal_name = ""
  previous_contact = {}
  with connect_db() as db:
    portal = db.execute(
      "SELECT id, name, client_contact_json FROM portals WHERE id = ?",
      (portal_id,),
    ).fetchone()
    if not portal:
      return None
    portal_name = portal["name"] or ""
    previous_contact = client_contact_from_json(portal["client_contact_json"] or "{}")
    db.execute(
      """
      UPDATE portals
      SET client_contact_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (json.dumps(clean_contact, ensure_ascii=False, separators=(",", ":")), portal_id),
    )
  record_admin_event(actor, "portal_client_contact_updated", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal_name,
    "previousFields": [key for key, value in previous_contact.items() if value],
    "nextFields": [key for key, value in clean_contact.items() if value],
  })
  return get_portal_row(portal_id)


def update_portal_client_name(portal_id, client_name, actor=None):
  clean_name = clean_portal_manual_text(client_name, 120, "client_name_too_long")
  if not clean_name:
    raise ValueError("client_name_required")
  init_db()
  portal_name = ""
  previous_client_name = ""
  with connect_db() as db:
    portal = db.execute(
      "SELECT id, name, client_name FROM portals WHERE id = ?",
      (portal_id,),
    ).fetchone()
    if not portal:
      return None
    portal_name = portal["name"] or ""
    previous_client_name = portal["client_name"] or ""
    db.execute(
      """
      UPDATE portals
      SET client_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (clean_name, portal_id),
    )
  record_admin_event(actor, "portal_client_name_updated", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal_name,
    "previousClientNameSet": bool(previous_client_name),
    "nextClientNameSet": bool(clean_name),
    "changed": previous_client_name != clean_name,
  })
  return get_portal_row(portal_id)


def update_portal_name(portal_id, name, actor=None):
  clean_name = wb_clean_portal_name(name)
  if not clean_name:
    raise ValueError("portal_name_required")
  if len(str(name or "").strip()) > 120:
    raise ValueError("portal_name_too_long")
  init_db()
  old_name = ""
  with connect_db() as db:
    portal = db.execute("SELECT id, name FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      return None
    old_name = portal["name"] or ""
    db.execute(
      """
      UPDATE portals
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (clean_name, portal_id),
    )
  record_admin_event(actor, "portal_name_updated", "portal", portal_id, portal_id=portal_id, details={
    "oldName": old_name,
    "newName": clean_name,
  })
  return get_portal_row(portal_id)


def update_portal_manual_source(portal_id, store_url, manual_source, actor=None):
  clean_store_url = clean_portal_manual_text(store_url, 500, "store_url_too_long")
  clean_manual_source = clean_portal_manual_text(manual_source, 1200, "manual_source_too_long")
  init_db()
  portal_name = ""
  marketplace = ""
  previous_fields = []
  with connect_db() as db:
    portal = db.execute(
      """
      SELECT id, name, marketplace, api_connected, store_url, manual_source
      FROM portals
      WHERE id = ?
      """,
      (portal_id,),
    ).fetchone()
    if not portal:
      return None
    if bool(portal["api_connected"]):
      raise ValueError("portal_source_manual_only")
    portal_name = portal["name"] or ""
    marketplace = portal["marketplace"] or ""
    previous_fields = [
      key for key, value in {
        "storeUrl": portal["store_url"] or "",
        "manualSource": portal["manual_source"] or "",
      }.items()
      if value
    ]
    db.execute(
      """
      UPDATE portals
      SET store_url = ?, manual_source = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (clean_store_url, clean_manual_source, portal_id),
    )
  record_admin_event(actor, "portal_manual_source_updated", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal_name,
    "marketplace": marketplace,
    "previousFields": previous_fields,
    "nextFields": [
      key for key, value in {
        "storeUrl": clean_store_url,
        "manualSource": clean_manual_source,
      }.items()
      if value
    ],
  })
  return get_portal_row(portal_id)


def set_portal_active(portal_id, is_active, actor=None):
  init_db()
  portal_name = ""
  with connect_db() as db:
    portal = db.execute("SELECT id, name FROM portals WHERE id = ?", (portal_id,)).fetchone()
    if not portal:
      return None
    portal_name = portal["name"] or ""
    db.execute(
      """
      UPDATE portals
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (1 if is_active else 0, portal_id),
    )
  record_admin_event(actor, "portal_restored" if is_active else "portal_archived", "portal", portal_id, portal_id=portal_id, details={
    "portalName": portal_name,
  })
  return get_portal_row(portal_id)


def delete_portal(portal_id, actor=None):
  init_db()
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  actor_login = actor["login"] if isinstance(actor, sqlite3.Row) else (actor or {}).get("login", "")
  portal_details = {}
  with connect_db() as db:
    portal = db.execute(
      """
      SELECT id, name, marketplace, scope, status, is_active, api_connected,
             card_count, problem_count, store_url, manual_source, created_by, created_at
      FROM portals
      WHERE id = ?
      """,
      (numeric_portal_id,),
    ).fetchone()
    if not portal:
      return None
    if bool(portal["is_active"]):
      raise ValueError("portal_must_be_archived")
    portal_details = public_wb_value(dict(portal))
    related_counts = {}
    for table in (
      "portal_members",
      "portal_integrations",
      "card_drafts",
      "portal_workset_cards",
      "ozon_tasks",
      "ozon_task_events",
      "card_approval_events",
      "card_competitors",
      "report_history",
      "portal_work_periods",
    ):
      row = db.execute(f"SELECT COUNT(*) AS count FROM {table} WHERE portal_id = ?", (numeric_portal_id,)).fetchone()
      related_counts[table] = int(row["count"] or 0) if row else 0
    db.execute(
      """
      INSERT INTO admin_events (actor_login, action, target_type, target_id, portal_id, details_json)
      VALUES (?, 'portal_deleted', 'portal', ?, ?, ?)
      """,
      (
        str(actor_login or "")[:120],
        str(numeric_portal_id),
        numeric_portal_id,
        json.dumps(admin_event_details({
          "portal": portal_details,
          "relatedCounts": related_counts,
        }), ensure_ascii=False, separators=(",", ":")),
      ),
    )
    db.execute("DELETE FROM portals WHERE id = ?", (numeric_portal_id,))
  return portal_details


def update_portal_sync_stats(portal_id, snapshot):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return
  stats = snapshot.get("stats") or {}
  token_meta = snapshot.get("tokenMeta") or {}
  external_key = wb_snapshot_external_key(snapshot)
  next_name = wb_clean_portal_name(stats.get("portalName", ""))
  with connect_db() as db:
    portal = db.execute("SELECT name FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    current_name = portal["name"] if portal else ""
    stored_name = next_name if should_replace_portal_name(current_name, next_name) else current_name
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
        cards_snapshot_json = ?,
        last_sync_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (
        stored_name,
        stats.get("cardCount", 0),
        stats.get("workCount", 0),
        stats.get("problemCount", 0),
        wb_snapshot_cards_json(snapshot),
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


def update_portal_manual_snapshot(portal_id, snapshot, status="MPStats витрина"):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError):
    return
  stats = snapshot.get("stats") or {}
  next_name = wb_clean_portal_name(stats.get("portalName", ""))
  with connect_db() as db:
    portal = db.execute("SELECT name FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    current_name = portal["name"] if portal else ""
    stored_name = next_name if should_replace_portal_name(current_name, next_name) else current_name
    db.execute(
      """
      UPDATE portals
      SET
        name = COALESCE(NULLIF(?, ''), name),
        status = ?,
        api_connected = 0,
        card_count = ?,
        work_count = ?,
        problem_count = ?,
        cards_snapshot_json = ?,
        last_sync_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (
        stored_name,
        status,
        stats.get("cardCount", 0),
        stats.get("workCount", 0),
        stats.get("problemCount", 0),
        wb_snapshot_cards_json(snapshot),
        stats.get("loadedAt"),
        numeric_portal_id,
      ),
    )


def build_saved_manual_portal_snapshot(row, bootstrap=None, limit=MPSTATS_STORE_BOOTSTRAP_MAX_CARDS):
  existing_cards = wb_snapshot_cards_from_row(row)
  if not existing_cards:
    return {}
  bootstrap = bootstrap if isinstance(bootstrap, dict) else {}
  warnings = list(bootstrap.get("warnings") or [])
  raw_cards = []
  for card in existing_cards[:max(1, min(int(limit or MPSTATS_STORE_BOOTSTRAP_MAX_CARDS), 500))]:
    raw_card = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
    if not raw_card:
      raw_card = card if isinstance(card, dict) else {}
    if raw_card:
      raw_cards.append(enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings))
  cards = [mpstats_normalized_bootstrap_card(raw_card) for raw_card in raw_cards if isinstance(raw_card, dict)]
  if not cards:
    return {}
  period = bootstrap.get("period") if isinstance(bootstrap.get("period"), dict) else audit_period_default()
  loaded_at = utc_now().isoformat()
  source = {
    "kind": "saved-snapshot",
    "source": "wb-public-card-details",
  }
  return {
    "cards": cards,
    "raw_count": len(cards),
    "cursor": {},
    "tokenMeta": {},
    "stats": {
      "cardCount": len(cards),
      "workCount": 0,
      "problemCount": sum(1 for card in cards if int(card.get("issueCount") or 0) > 0),
      "sampleLimit": limit,
      "loadedAt": loaded_at,
      "portalName": "",
      "source": "saved-snapshot",
      "sourceLabel": "saved-snapshot: wb-public-card-details",
    },
    "manualBootstrap": {
      "status": "loaded",
      "cardCount": len(cards),
      "source": source,
      "period": period,
      "warnings": audit_public_warnings(warnings),
      "loadedAt": loaded_at,
    },
  }


def replace_wb_token_for_portal(portal_id, token, snapshot):
  numeric_portal_id = int(portal_id)
  token_meta = snapshot.get("tokenMeta") or wb_token_meta(token)
  external_key = wb_snapshot_external_key(snapshot)
  aad = integration_aad(numeric_portal_id, WB_PROVIDER)
  nonce, ciphertext = encrypt_secret(token, aad)
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    db.execute(
      """
      INSERT INTO portal_integrations (
        portal_id, provider, status, token_nonce, token_ciphertext, token_digest,
        external_key, token_issued_at, token_expires_at, last_checked_at
      )
      VALUES (?, ?, 'connected', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(portal_id, provider) DO UPDATE SET
        status = 'connected',
        token_nonce = excluded.token_nonce,
        token_ciphertext = excluded.token_ciphertext,
        token_digest = excluded.token_digest,
        external_key = excluded.external_key,
        token_issued_at = excluded.token_issued_at,
        token_expires_at = excluded.token_expires_at,
        last_checked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      """,
      (
        numeric_portal_id,
        WB_PROVIDER,
        nonce,
        ciphertext,
        secret_digest(token),
        external_key,
        token_meta.get("issuedAt", ""),
        token_meta.get("expiresAt", ""),
      ),
    )
  update_portal_sync_stats(numeric_portal_id, snapshot)
  return get_portal_row(numeric_portal_id)


def refresh_manual_portal_from_mpstats(portal_id, user):
  row = get_portal_row(portal_id, user)
  if not row:
    raise ValueError("portal_not_found")
  if bool(row["api_connected"]):
    raise ValueError("portal_has_api")
  existing_cards = wb_snapshot_cards_from_row(row)
  context_token = mpstats_call_context_start(user, "Кабинет: обновить из MPStats", portal_id=portal_id, details={
    "portalName": row["name"],
    "storeUrl": row["store_url"] or "",
  })
  try:
    snapshot = build_mpstats_storefront_snapshot(
      row["name"],
      row["store_url"] or "",
      row["manual_source"] or "",
      limit=MPSTATS_STORE_BOOTSTRAP_MAX_CARDS,
    )
  finally:
    mpstats_call_context_stop(context_token)
  bootstrap = snapshot.get("manualBootstrap") or {}
  if not snapshot.get("cards"):
    if bootstrap.get("strictSellerSource"):
      seller_ids = wb_public_seller_ids_from_manual_source(
        row["name"],
        row["store_url"] or "",
        row["manual_source"] or "",
      )
      if existing_cards and not snapshot_cards_match_wb_seller(existing_cards, seller_ids):
        loaded_at = utc_now().isoformat()
        source = bootstrap.get("source") if isinstance(bootstrap.get("source"), dict) else {}
        source_label = f"seller: {source.get('path')}" if source.get("path") else (f"seller: {seller_ids[0]}" if seller_ids else "")
        empty_snapshot = {
          "cards": [],
          "raw_count": 0,
          "cursor": {},
          "tokenMeta": {},
          "stats": {
            "cardCount": 0,
            "workCount": 0,
            "problemCount": 0,
            "sampleLimit": bootstrap.get("limit") or MPSTATS_STORE_BOOTSTRAP_MAX_CARDS,
            "loadedAt": loaded_at,
            "portalName": "",
            "source": "wb-public-seller",
            "sourceLabel": source_label,
          },
          "manualBootstrap": {
            **bootstrap,
            "status": "empty",
            "cardCount": 0,
            "warnings": audit_public_warnings(bootstrap.get("warnings") or []),
            "loadedAt": loaded_at,
            "strictSellerSource": True,
            "replaceExisting": True,
            "clearedMismatchedSnapshot": True,
          },
        }
        update_portal_manual_snapshot(portal_id, empty_snapshot, status="WB seller ожидает загрузку")
        updated_row = get_portal_row(portal_id, user)
        return updated_row, empty_snapshot.get("manualBootstrap") or bootstrap
      return row, bootstrap
    snapshot = build_saved_manual_portal_snapshot(row, bootstrap)
    bootstrap = snapshot.get("manualBootstrap") or bootstrap
    if not snapshot.get("cards"):
      return row, bootstrap
  if existing_cards and not (snapshot.get("manualBootstrap") or {}).get("replaceExisting"):
    snapshot = merge_snapshot_with_existing_cards(row, snapshot)
    bootstrap = snapshot.get("manualBootstrap") or bootstrap
  status = "MPStats витрина" if (snapshot.get("stats") or {}).get("sourceLabel") else "MPStats карточки"
  update_portal_manual_snapshot(portal_id, snapshot, status=status)
  updated_row = get_portal_row(portal_id, user)
  return updated_row, bootstrap


def merge_snapshot_with_existing_cards(row, snapshot):
  if not row or not isinstance(snapshot, dict):
    return snapshot
  existing_cards = wb_snapshot_cards_from_row(row)
  new_cards = snapshot.get("cards") if isinstance(snapshot.get("cards"), list) else []
  if not existing_cards:
    return snapshot
  merged = []
  seen = set()

  def add_card(card):
    if not isinstance(card, dict):
      return
    key = card_key_from_snapshot_card(card) or raw_storefront_card_key(card)
    if not key or key in seen:
      return
    seen.add(key)
    merged.append(card)

  for card in new_cards:
    add_card(card)
  for card in existing_cards:
    add_card(card)
  if len(merged) <= len(new_cards):
    return snapshot
  next_snapshot = {**snapshot, "cards": merged, "raw_count": len(merged)}
  stats = {**(snapshot.get("stats") or {})}
  stats["cardCount"] = len(merged)
  stats["problemCount"] = sum(1 for card in merged if int(card.get("issueCount") or 0) > 0)
  next_snapshot["stats"] = stats
  bootstrap = {**(snapshot.get("manualBootstrap") or {})}
  bootstrap["cardCount"] = len(merged)
  if new_cards and len(merged) > len(new_cards):
    warnings = list(bootstrap.get("warnings") or [])
    warnings.append(f"Сохранены ранее загруженные карточки: {len(existing_cards)}.")
    bootstrap["warnings"] = audit_public_warnings(warnings)
  next_snapshot["manualBootstrap"] = bootstrap
  return next_snapshot


def mpstats_store_import_worker(job_id, portal_id, user, limit):
  context_token = mpstats_call_context_start(user, "Кабинет: загрузить все из MPStats", portal_id=portal_id, details={
    "jobId": job_id,
    "limit": limit,
  })
  try:
    return mpstats_store_import_worker_inner(job_id, portal_id, user, limit)
  finally:
    mpstats_call_context_stop(context_token)


def mpstats_store_import_worker_inner(job_id, portal_id, user, limit):
  try:
    row = get_portal_row(portal_id, user)
    if not row:
      raise ValueError("portal_not_found")
    if bool(row["api_connected"]):
      raise ValueError("portal_has_api")
    existing_cards = wb_snapshot_cards_from_row(row)
    mpstats_store_import_update(
      job_id,
      status="running",
      phase="starting",
      message="Готовим расширенную загрузку",
      loadedCount=len(existing_cards) or int(row["card_count"] or 0),
      totalEstimate=0,
    )
    snapshot = build_mpstats_storefront_snapshot_paged(
      row["name"],
      row["store_url"] or "",
      row["manual_source"] or "",
      limit=limit,
      job_id=job_id,
      existing_cards=existing_cards,
    )
    bootstrap = snapshot.get("manualBootstrap") or {}
    if not snapshot.get("cards"):
      warnings = bootstrap.get("warnings") if isinstance(bootstrap.get("warnings"), list) else []
      existing_count = int(row["card_count"] or 0)
      if existing_count > 0:
        source_limited = any(
          "HTTP 429" in str(warning) or "empty page" in str(warning)
          for warning in warnings
        )
        strict_seller_source = bool(bootstrap.get("strictSellerSource"))
        replace_existing = bool(bootstrap.get("replaceExisting"))
        previous_count = existing_count
        if replace_existing:
          loaded_at = utc_now().isoformat()
          source = bootstrap.get("source") if isinstance(bootstrap.get("source"), dict) else {}
          source_label = f"seller: {source.get('path')}" if source.get("path") else ""
          update_portal_manual_snapshot(portal_id, {
            "cards": [],
            "raw_count": 0,
            "cursor": {},
            "tokenMeta": {},
            "stats": {
              "cardCount": 0,
              "workCount": 0,
              "problemCount": 0,
              "sampleLimit": bootstrap.get("limit") or limit,
              "loadedAt": loaded_at,
              "portalName": "",
              "source": "wb-public-seller" if strict_seller_source else "mpstats",
              "sourceLabel": source_label,
            },
            "manualBootstrap": {
              **bootstrap,
              "status": "empty",
              "cardCount": 0,
              "warnings": audit_public_warnings(warnings),
              "loadedAt": loaded_at,
              "clearedMismatchedSnapshot": True,
            },
          }, status="WB seller ожидает загрузку")
          existing_count = 0
        updated_row = get_portal_row(portal_id, user)
        portal_payload = public_portal_from_row(updated_row) if updated_row else None
        warning = warnings[0] if warnings else ""
        if replace_existing:
          message = f"Старый список из {previous_count} карточек очищен: он не совпадал с WB seller. Источник пока не отдал новые карточки, повторите загрузку позже."
        elif source_limited:
          message = f"Остановлено лимитом источника. В кабинете сохранено {existing_count} карточек."
        else:
          message = f"Новых карточек не найдено. В кабинете сохранено {existing_count} карточек."
        mpstats_store_import_update(
          job_id,
          status="paused" if source_limited or replace_existing else "done",
          phase="paused" if source_limited or replace_existing else "done",
          message=message,
          loadedCount=existing_count,
          totalEstimate=existing_count if strict_seller_source else 0,
          error=warning or ("Старый снимок собран не из WB seller" if replace_existing else ""),
          finishedAt=utc_now().isoformat(),
          portal=portal_payload,
          bootstrap=bootstrap,
        )
        return
      raise ValueError(warnings[0] if warnings else "mpstats_cards_empty")
    if not bootstrap.get("replaceExisting"):
      snapshot = merge_snapshot_with_existing_cards(row, snapshot)
    bootstrap = snapshot.get("manualBootstrap") or {}
    status = "MPStats витрина" if (snapshot.get("stats") or {}).get("sourceLabel") else "MPStats карточки"
    update_portal_manual_snapshot(portal_id, snapshot, status=status)
    updated_row = get_portal_row(portal_id, user)
    portal_payload = public_portal_from_row(updated_row) if updated_row else None
    warning_texts = bootstrap.get("warnings") if isinstance(bootstrap.get("warnings"), list) else []
    source_limited = any(
      "HTTP 429" in str(warning) or "empty page" in str(warning)
      for warning in warning_texts
    )
    loaded_count = len(snapshot.get("cards") or [])
    mpstats_store_import_update(
      job_id,
      status="paused" if source_limited else "done",
      phase="paused" if source_limited else "done",
      message=f"Остановлено лимитом источника. В кабинете сохранено {loaded_count} карточек." if source_limited else f"Загружено {loaded_count} карточек",
      loadedCount=loaded_count,
      totalEstimate=0 if source_limited else loaded_count,
      error=warning_texts[0] if source_limited and warning_texts else None,
      finishedAt=utc_now().isoformat(),
      portal=portal_payload,
      bootstrap=bootstrap,
    )
  except Exception as exc:
    error_text = str(exc) or type(exc).__name__
    if error_text == "mpstats_cards_empty":
      error_text = "MPStats не вернул карточки по сохраненной ссылке или описанию"
    mpstats_store_import_update(
      job_id,
      status="error",
      phase="error",
      message="Загрузка карточек прервалась",
      error=error_text,
      finishedAt=utc_now().isoformat(),
    )


def start_mpstats_store_import(portal_id, user, limit=MPSTATS_STORE_FULL_IMPORT_MAX_CARDS):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  row = get_portal_row(numeric_portal_id, user)
  if not row:
    raise ValueError("portal_not_found")
  if bool(row["api_connected"]):
    raise ValueError("portal_has_api")
  if not (row["store_url"] or row["manual_source"]):
    raise ValueError("manual_source_missing")
  limit = max(MPSTATS_STORE_BOOTSTRAP_MAX_CARDS, min(int(limit or MPSTATS_STORE_FULL_IMPORT_MAX_CARDS), 5000))
  with MPSTATS_STORE_IMPORT_LOCK:
    for job in MPSTATS_STORE_IMPORT_JOBS.values():
      if str(job.get("portalId")) == str(numeric_portal_id) and job.get("status") in {"queued", "running"}:
        return public_mpstats_store_import_job(job)
    job_id = f"store-import-{numeric_portal_id}-{int(time.time())}-{secrets.token_hex(4)}"
    now = utc_now().isoformat()
    job = {
      "id": job_id,
      "portalId": str(numeric_portal_id),
      "status": "queued",
      "phase": "queued",
      "message": "Загрузка поставлена в очередь",
      "loadedCount": int(row["card_count"] or 0),
      "totalEstimate": 0,
      "limit": limit,
      "sourceLabel": "",
      "error": "",
      "startedAt": now,
      "updatedAt": now,
    }
    MPSTATS_STORE_IMPORT_JOBS[job_id] = job
  worker_user = dict(user)
  worker = threading.Thread(
    target=mpstats_store_import_worker,
    args=(job_id, numeric_portal_id, worker_user, limit),
    daemon=True,
  )
  worker.start()
  return public_mpstats_store_import_job(job)


def get_mpstats_store_import_job(job_id, portal_id, user):
  if not user_can_access_portal(user, portal_id):
    raise PermissionError("forbidden")
  with MPSTATS_STORE_IMPORT_LOCK:
    job = MPSTATS_STORE_IMPORT_JOBS.get(str(job_id or ""))
    if not job or str(job.get("portalId")) != str(portal_id):
      return None
    public_job = public_mpstats_store_import_job(job)
    portal_payload = job.get("portal") if isinstance(job.get("portal"), dict) else None
    bootstrap = job.get("bootstrap") if isinstance(job.get("bootstrap"), dict) else None
  return {
    "job": public_job,
    "portal": portal_payload,
    "bootstrap": bootstrap,
  }


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
  meta = sanitize_card_draft_meta(payload.get("meta") if isinstance(payload.get("meta"), dict) else {})
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


def card_draft_semantic_items(payload, key):
  if not isinstance(payload, dict):
    return []
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  items = meta.get(key)
  return items if isinstance(items, list) else []


def card_draft_has_semantic_key(payload, key):
  if not isinstance(payload, dict):
    return False
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  return key in meta


def card_draft_semantic_dict(payload, key):
  if not isinstance(payload, dict):
    return None
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  value = meta.get(key)
  return value if isinstance(value, dict) else None


def merge_card_draft_semantics(next_payload, previous_payload):
  if not isinstance(next_payload, dict) or not isinstance(previous_payload, dict):
    return next_payload
  previous_reports = card_draft_semantic_items(previous_payload, "semanticCoreReports")
  previous_selected = card_draft_semantic_items(previous_payload, "semanticCoreSelected")
  previous_removal = card_draft_semantic_items(previous_payload, "semanticCoreRemoval")
  previous_final = card_draft_semantic_dict(previous_payload, "semanticCoreFinal")
  if not previous_reports and not previous_selected and not previous_removal and not previous_final:
    return next_payload
  has_reports = card_draft_has_semantic_key(next_payload, "semanticCoreReports")
  has_selected = card_draft_has_semantic_key(next_payload, "semanticCoreSelected")
  has_removal = card_draft_has_semantic_key(next_payload, "semanticCoreRemoval")
  has_final = card_draft_has_semantic_key(next_payload, "semanticCoreFinal")
  if has_reports and has_selected and has_removal and has_final:
    return next_payload
  next_meta = next_payload.get("meta") if isinstance(next_payload.get("meta"), dict) else {}
  merged_meta = {
    **next_meta,
  }
  if previous_reports and not has_reports:
    merged_meta["semanticCoreReports"] = previous_reports
  if previous_selected and not has_selected:
    merged_meta["semanticCoreSelected"] = previous_selected
  if previous_removal and not has_removal:
    merged_meta["semanticCoreRemoval"] = previous_removal
  if previous_final and not has_final:
    merged_meta["semanticCoreFinal"] = previous_final
  return {
    **next_payload,
    "meta": merged_meta,
  }


def merge_card_draft_work_context(next_payload, previous_payload):
  if not isinstance(next_payload, dict) or not isinstance(previous_payload, dict):
    return next_payload
  previous_meta = previous_payload.get("meta") if isinstance(previous_payload.get("meta"), dict) else {}
  if not previous_meta:
    return next_payload
  next_meta = next_payload.get("meta") if isinstance(next_payload.get("meta"), dict) else {}
  merged_meta = {**next_meta}
  for key in ("batch", "auditInvalidatedAt", "auditInvalidatedReason"):
    if key not in merged_meta and key in previous_meta:
      merged_meta[key] = previous_meta[key]
  previous_card = previous_meta.get("card") if isinstance(previous_meta.get("card"), dict) else {}
  next_card = merged_meta.get("card") if isinstance(merged_meta.get("card"), dict) else {}
  if previous_card:
    merged_meta["card"] = {**previous_card, **next_card}
  return {
    **next_payload,
    "meta": merged_meta,
  }


def sanitize_audit_summary(summary):
  if not isinstance(summary, dict):
    return summary
  cleaned = {**summary}
  risk_notes = cleaned.get("riskNotes")
  if isinstance(risk_notes, list):
    cleaned["riskNotes"] = audit_public_warnings(risk_notes)
  return cleaned


def sanitize_audit_history_entry(entry):
  if not isinstance(entry, dict):
    return entry
  cleaned = {**entry}
  if isinstance(cleaned.get("summary"), dict):
    cleaned["summary"] = sanitize_audit_summary(cleaned["summary"])
  return cleaned


def sanitize_card_draft_meta(meta):
  if not isinstance(meta, dict):
    return {}
  cleaned = {**meta}
  if isinstance(cleaned.get("auditHistory"), list):
    cleaned["auditHistory"] = [sanitize_audit_history_entry(item) for item in cleaned["auditHistory"]]
  audit_result = cleaned.get("auditResult")
  if isinstance(audit_result, dict):
    audit_result = {**audit_result}
    if isinstance(audit_result.get("summary"), dict):
      audit_result["summary"] = sanitize_audit_summary(audit_result["summary"])
    cleaned["auditResult"] = audit_result
  evidence_summary = cleaned.get("evidenceSummary")
  if isinstance(evidence_summary, dict):
    evidence_summary = {**evidence_summary}
    if isinstance(evidence_summary.get("warnings"), list):
      evidence_summary["warnings"] = audit_public_warnings(evidence_summary["warnings"])
    cleaned["evidenceSummary"] = evidence_summary
  return cleaned


def public_card_draft(row):
  try:
    payload = json.loads(row["payload_json"])
  except (TypeError, json.JSONDecodeError):
    payload = normalize_card_draft_payload({})
  payload = normalize_card_draft_payload(payload)
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


def semantic_collection_name(value):
  return audit_str(value or "", 120)


def semantic_collection_keyword_key(value):
  query = value if isinstance(value, str) else (value.get("query") if isinstance(value, dict) else "")
  return audit_normalized(query)


def semantic_collection_number(value):
  try:
    number = float(value)
  except (TypeError, ValueError):
    return ""
  if not number or number <= 0:
    return ""
  return int(number) if number.is_integer() else number


def normalize_semantic_collection_keywords(items, limit=2000):
  output = []
  seen = set()
  text_fields = (
    "cluster",
    "prioritySubject",
    "prioritySubjectId",
    "frequency365",
    "source",
    "priority",
    "reason",
  )
  numeric_fields = (
    "wbCount",
    "ozonCount",
    "results",
    "totalFound",
    "uniqueDays",
    "orgPos",
    "adPos",
    "avgPos",
    "position",
  )
  for item in items if isinstance(items, list) else []:
    query = audit_str(item if isinstance(item, str) else (item.get("query") if isinstance(item, dict) else ""), 250)
    key = audit_normalized(query)
    if not query or not key or key in seen:
      continue
    seen.add(key)
    normalized = {
      "query": query,
      "status": "selected",
      "field": "work",
    }
    if isinstance(item, dict):
      for field in text_fields:
        value = audit_str(item.get(field), 250)
        if value:
          normalized[field] = value
      for field in numeric_fields:
        value = semantic_collection_number(item.get(field))
        if value:
          normalized[field] = value
    output.append(normalized)
    if len(output) >= limit:
      break
  return output


def merge_semantic_collection_keywords(existing, incoming):
  output = normalize_semantic_collection_keywords(existing)
  seen = {semantic_collection_keyword_key(item) for item in output}
  for item in normalize_semantic_collection_keywords(incoming):
    key = semantic_collection_keyword_key(item)
    if key and key not in seen:
      seen.add(key)
      output.append(item)
  return output[:2000]


def public_semantic_core_collection(row):
  if not row:
    return None
  try:
    keywords = json.loads(row["keywords_json"] or "[]")
  except (TypeError, json.JSONDecodeError):
    keywords = []
  try:
    meta = json.loads(row["meta_json"] or "{}")
  except (TypeError, json.JSONDecodeError):
    meta = {}
  keywords = normalize_semantic_collection_keywords(keywords)
  return {
    "id": row["id"],
    "portalId": str(row["portal_id"]),
    "name": row["name"] or "",
    "keywords": keywords,
    "keywordCount": len(keywords),
    "meta": meta if isinstance(meta, dict) else {},
    "createdBy": row["created_by"] or "",
    "updatedBy": row["updated_by"] or "",
    "createdAt": row["created_at"] or "",
    "updatedAt": row["updated_at"] or "",
  }


def list_semantic_core_collections(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM semantic_core_collections
      WHERE portal_id = ?
      ORDER BY updated_at DESC, name
      """,
      (numeric_portal_id,),
    ).fetchall()
  return {
    "portalId": str(numeric_portal_id),
    "collections": [public_semantic_core_collection(row) for row in rows],
  }


def save_semantic_core_collection(portal_id, name, keywords, user, collection_id=None, mode="append", meta=None):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  clean_name = semantic_collection_name(name)
  replace_mode = str(mode or "").strip().lower() == "replace"
  incoming_keywords = normalize_semantic_collection_keywords(keywords)
  if not clean_name:
    raise ValueError("semantic_collection_name_required")
  if not incoming_keywords and not replace_mode:
    raise ValueError("semantic_collection_keywords_required")
  meta_payload = meta if isinstance(meta, dict) else {}
  init_db()
  with connect_db() as db:
    existing = None
    if collection_id:
      existing = db.execute(
        """
        SELECT *
        FROM semantic_core_collections
        WHERE portal_id = ? AND id = ?
        """,
        (numeric_portal_id, collection_id),
      ).fetchone()
      if not existing:
        raise ValueError("semantic_collection_not_found")
    else:
      existing = db.execute(
        """
        SELECT *
        FROM semantic_core_collections
        WHERE portal_id = ? AND name = ?
        """,
        (numeric_portal_id, clean_name),
      ).fetchone()

    if existing:
      try:
        existing_keywords = json.loads(existing["keywords_json"] or "[]")
      except (TypeError, json.JSONDecodeError):
        existing_keywords = []
      next_keywords = incoming_keywords if replace_mode else merge_semantic_collection_keywords(existing_keywords, incoming_keywords)
      try:
        existing_meta = json.loads(existing["meta_json"] or "{}")
      except (TypeError, json.JSONDecodeError):
        existing_meta = {}
      next_meta = {
        **(existing_meta if isinstance(existing_meta, dict) else {}),
        **meta_payload,
      }
      try:
        db.execute(
          """
          UPDATE semantic_core_collections
          SET name = ?,
              keywords_json = ?,
              meta_json = ?,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE portal_id = ? AND id = ?
          """,
          (
            clean_name,
            json.dumps(next_keywords, ensure_ascii=False, separators=(",", ":")),
            json.dumps(next_meta, ensure_ascii=False, separators=(",", ":")),
            user["login"],
            numeric_portal_id,
            existing["id"],
          ),
        )
      except sqlite3.IntegrityError as exc:
        raise ValueError("semantic_collection_name_exists") from exc
      collection_id = existing["id"]
    else:
      try:
        cursor = db.execute(
          """
          INSERT INTO semantic_core_collections (
            portal_id, name, keywords_json, meta_json, created_by, updated_by
          )
          VALUES (?, ?, ?, ?, ?, ?)
          """,
          (
            numeric_portal_id,
            clean_name,
            json.dumps(incoming_keywords, ensure_ascii=False, separators=(",", ":")),
            json.dumps(meta_payload, ensure_ascii=False, separators=(",", ":")),
            user["login"],
            user["login"],
          ),
        )
      except sqlite3.IntegrityError as exc:
        raise ValueError("semantic_collection_name_exists") from exc
      collection_id = cursor.lastrowid

    row = db.execute(
      """
      SELECT *
      FROM semantic_core_collections
      WHERE portal_id = ? AND id = ?
      """,
      (numeric_portal_id, collection_id),
    ).fetchone()
  return public_semantic_core_collection(row)


def delete_semantic_core_collection(portal_id, collection_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  try:
    numeric_collection_id = int(collection_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_semantic_collection_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    cursor = db.execute(
      """
      DELETE FROM semantic_core_collections
      WHERE portal_id = ? AND id = ?
      """,
      (numeric_portal_id, numeric_collection_id),
    )
  return cursor.rowcount > 0


def card_key_from_snapshot_card(card):
  if not isinstance(card, dict):
    return ""
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  return draft_card_key(
    card.get("nmID")
    or card.get("nmId")
    or card.get("nm_id")
    or raw_fields.get("nmID")
    or raw_fields.get("nmId")
    or raw_fields.get("nm_id")
    or card.get("id")
    or raw_fields.get("id")
    or card.get("vendorCode")
    or card.get("vendor_code")
    or card.get("supplierArticle")
    or raw_fields.get("vendorCode")
    or raw_fields.get("vendor_code")
    or raw_fields.get("supplierArticle")
    or card.get("nmUUID")
    or card.get("nmUuid")
    or card.get("nm_uuid")
    or raw_fields.get("nmUUID")
    or raw_fields.get("nmUuid")
    or raw_fields.get("nm_uuid")
  )


def raw_storefront_card_key(card):
  if not isinstance(card, dict):
    return ""
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  return draft_card_key(
    card.get("nmID")
    or card.get("nmId")
    or card.get("id")
    or card.get("vendorCode")
    or raw_fields.get("nmID")
    or raw_fields.get("nmId")
    or raw_fields.get("id")
    or raw_fields.get("vendorCode")
  )


def snapshot_card_keys(cards):
  output = set()
  if not isinstance(cards, list):
    return output
  for card in cards:
    key = card_key_from_snapshot_card(card) or raw_storefront_card_key(card)
    if key:
      output.add(key)
  return output


def snapshot_cards_match_wb_seller(cards, seller_ids):
  seller_ids = {parse_wb_seller_id(seller_id) for seller_id in seller_ids}
  seller_ids = {seller_id for seller_id in seller_ids if seller_id}
  if not seller_ids or not isinstance(cards, list) or not cards:
    return True
  checked = 0
  for card in cards:
    if not isinstance(card, dict):
      continue
    checked += 1
    if not snapshot_card_matches_wb_seller(card, seller_ids):
      return False
  return checked > 0


def snapshot_card_matches_wb_seller(card, seller_ids):
  if not isinstance(card, dict):
    return False
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  raw_mpstats = raw_fields.get("mpstats") if isinstance(raw_fields.get("mpstats"), dict) else {}
  card_mpstats = card.get("mpstats") if isinstance(card.get("mpstats"), dict) else {}
  source = audit_str(raw_mpstats.get("source") or card_mpstats.get("source") or "")
  supplier_id = parse_wb_seller_id(
    raw_mpstats.get("supplierId")
    or raw_fields.get("supplierId")
    or raw_fields.get("supplier_id")
    or card_mpstats.get("supplierId")
    or card.get("supplierId")
    or card.get("supplier_id")
  )
  return source == "wb-public-seller" and supplier_id in seller_ids


def snapshot_card_lookup(snapshot_json):
  try:
    cards = json.loads(snapshot_json or "[]")
  except json.JSONDecodeError:
    cards = []
  lookup = {}
  if not isinstance(cards, list):
    return lookup
  for card in cards:
    key = card_key_from_snapshot_card(card)
    if key:
      lookup[key] = card
  return lookup


def semantic_core_final_exists(meta):
  if not isinstance(meta, dict):
    return False
  final_export = meta.get("semanticCoreFinal")
  if not isinstance(final_export, dict):
    return False
  semantic_core = final_export.get("semanticCore")
  return isinstance(semantic_core, dict) and bool(semantic_core)


def work_package_title(work_types, cards_count=0, comment=""):
  labels = work_type_labels(work_types)
  prefix = " + ".join(labels) if labels else "Задача"
  count = int(cards_count or 0)
  suffix = f"{count} карточек" if count else "карточки"
  clean_comment = str(comment or "").strip()
  if clean_comment:
    return f"{prefix}: {clean_comment}"[:180]
  return f"{prefix}: {suffix}"[:180]


def active_task_work_types(meta):
  meta = meta if isinstance(meta, dict) else {}
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  work_types = normalize_optional_work_types(batch.get("workTypes"))
  return [
    work_type
    for work_type in work_types
    if not task_work_type_done(meta, work_type)
  ]


TASK_WORK_DONE_STATUSES = {"submitted", "approved", "exported"}
TASK_WORK_STATUS_PRIORITY = {
  "changes_requested": 4,
  "submitted": 3,
  "draft": 2,
  "approved": 1,
  "exported": 1,
}


def row_value(row, key, default=""):
  if row is None:
    return default
  try:
    value = row[key]
  except (IndexError, KeyError, TypeError):
    return default
  return default if value is None else value


def approval_for_task_work_type(meta, work_type):
  meta = meta if isinstance(meta, dict) else {}
  sections = meta.get("approvalSections") if isinstance(meta.get("approvalSections"), dict) else {}
  section = sections.get(work_type) if isinstance(sections.get(work_type), dict) else None
  if section is not None:
    return section
  approval = meta.get("approval") if isinstance(meta.get("approval"), dict) else {}
  return approval


def task_work_type_status(meta, work_type):
  meta = meta if isinstance(meta, dict) else {}
  if work_type == "semantic":
    return "approved" if semantic_core_final_exists(meta) else "draft"
  approval = approval_for_task_work_type(meta, work_type)
  return approval_status_from_approval(approval) if approval else "draft"


def task_work_type_done(meta, work_type):
  return task_work_type_status(meta, work_type) in TASK_WORK_DONE_STATUSES


def task_status_for_work_types(meta, work_types):
  statuses = [task_work_type_status(meta, work_type) for work_type in work_types]
  if not statuses:
    return "draft"
  return sorted(statuses, key=lambda status: TASK_WORK_STATUS_PRIORITY.get(status, 0), reverse=True)[0]


def task_work_completion_label(work_type, status):
  if work_type == "semantic":
    return "добавлено в итоговое СЯ"
  if status == "submitted":
    return "отправлено на согласование"
  if status == "approved":
    return "принято"
  if status == "exported":
    return "выгружено"
  return "завершено"


def completed_task_work_item(meta, work_type, row=None):
  meta = meta if isinstance(meta, dict) else {}
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  if work_type == "semantic":
    final_export = meta.get("semanticCoreFinal") if isinstance(meta.get("semanticCoreFinal"), dict) else {}
    if not semantic_core_final_exists(meta):
      return None
    completed_at = str(
      final_export.get("updatedAt")
      or final_export.get("createdAt")
      or row_value(row, "updated_at")
      or ""
    )
    completed_by = str(
      final_export.get("updatedBy")
      or final_export.get("createdBy")
      or row_value(row, "updated_by")
      or row_value(row, "created_by")
      or batch.get("assigneeLogin")
      or batch.get("createdBy")
      or ""
    )
    return {
      "workType": work_type,
      "status": "approved",
      "completedAt": completed_at,
      "completedBy": completed_by,
      "completionLabel": task_work_completion_label(work_type, "approved"),
    }

  status = task_work_type_status(meta, work_type)
  if status not in TASK_WORK_DONE_STATUSES:
    return None
  approval = approval_for_task_work_type(meta, work_type)
  completed_at = str(
    approval.get("submittedAt")
    or approval.get("reviewedAt")
    or row_value(row, "updated_at")
    or ""
  )
  completed_by = str(
    approval.get("submittedBy")
    or approval.get("reviewedBy")
    or row_value(row, "updated_by")
    or row_value(row, "created_by")
    or batch.get("assigneeLogin")
    or batch.get("createdBy")
    or ""
  )
  return {
    "workType": work_type,
    "status": status,
    "completedAt": completed_at,
    "completedBy": completed_by,
    "completionLabel": task_work_completion_label(work_type, status),
  }


def completed_task_work_items(meta, row=None):
  meta = meta if isinstance(meta, dict) else {}
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  work_types = normalize_optional_work_types(batch.get("workTypes"))
  if not work_types and semantic_core_final_exists(meta):
    work_types = ["semantic"]
  items = []
  for work_type in work_types:
    item = completed_task_work_item(meta, work_type, row)
    if item:
      items.append(item)
  return items


def approval_task_base(row, snapshot_lookup, meta, work_types):
  approval = meta.get("approval") if isinstance(meta.get("approval"), dict) else {}
  card_meta = meta.get("card") if isinstance(meta.get("card"), dict) else {}
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  batch_title = str(batch.get("title") or work_package_title(work_types, batch.get("cardsCount"), batch.get("comment")) or "")[:180]
  try:
    batch_position = int(batch.get("position") or 0)
  except (TypeError, ValueError):
    batch_position = 0
  card = snapshot_lookup.get(row["card_key"], {})
  return {
    "portalId": str(row["portal_id"]),
    "cardKey": row["card_key"],
    "nmID": row["nm_id"] or card_meta.get("nmID") or card.get("nmID") or "",
    "vendorCode": row["vendor_code"] or card_meta.get("vendorCode") or card.get("vendorCode") or "",
    "title": card.get("title") or card_meta.get("title") or row["vendor_code"] or row["nm_id"] or "Карточка WB",
    "subjectName": card.get("subjectName") or card_meta.get("subjectName") or "",
    "assigneeLogin": str(batch.get("assigneeLogin") or approval.get("assigneeLogin") or ""),
    "submittedBy": str(approval.get("submittedBy") or ""),
    "submittedAt": str(approval.get("submittedAt") or ""),
    "reviewedBy": str(approval.get("reviewedBy") or ""),
    "reviewedAt": str(approval.get("reviewedAt") or ""),
    "returnReason": str(approval.get("returnReason") or ""),
    "batchId": str(batch.get("id") or ""),
    "batchKind": str(batch.get("kind") or ""),
    "batchCreatedBy": str(batch.get("createdBy") or ""),
    "batchCreatedAt": str(batch.get("createdAt") or ""),
    "batchTitle": batch_title,
    "batchCardsCount": int(batch.get("cardsCount") or 0),
    "batchPosition": batch_position,
    "workTypes": work_types,
    "workTypeLabels": [WORK_TYPE_LABELS.get(item, item) for item in work_types],
    "workComment": str(batch.get("comment") or "")[:700],
    "hasSemanticCoreFinal": semantic_core_final_exists(meta),
    "updatedAt": row["updated_at"] or "",
  }


def public_approval_task(row, snapshot_lookup):
  try:
    payload = json.loads(row["payload_json"])
  except (TypeError, json.JSONDecodeError):
    payload = normalize_card_draft_payload({})
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  work_types = active_task_work_types(meta)
  status = task_status_for_work_types(meta, work_types)
  audit_status = str(row["audit_status"] or payload.get("auditStatus") or "")
  return {
    **approval_task_base(row, snapshot_lookup, meta, work_types),
    "status": status,
    "auditStatus": audit_status,
    "hasAuditDraft": audit_status == "done" or isinstance(payload.get("auditResult"), dict),
  }


def public_completed_approval_tasks(row, snapshot_lookup):
  try:
    payload = json.loads(row["payload_json"])
  except (TypeError, json.JSONDecodeError):
    payload = normalize_card_draft_payload({})
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  output = []
  for item in completed_task_work_items(meta, row):
    work_type = item["workType"]
    task = {
      **approval_task_base(row, snapshot_lookup, meta, [work_type]),
      "status": item["status"],
      "workType": work_type,
      "workTypes": [work_type],
      "workTypeLabels": [WORK_TYPE_LABELS.get(work_type, work_type)],
      "completedAt": item["completedAt"],
      "completedBy": item["completedBy"],
      "completionLabel": item["completionLabel"],
    }
    output.append(task)
  return output


def normalize_workset_card(value):
  if not isinstance(value, dict):
    value = {}
  card_key = draft_card_key(
    value.get("cardKey")
    or value.get("nmID")
    or value.get("nmId")
    or value.get("nm_id")
    or value.get("id")
    or value.get("vendorCode")
    or value.get("vendor_code")
    or value.get("supplierArticle")
    or value.get("nmUUID")
    or value.get("nmUuid")
    or value.get("nm_uuid")
  )
  return {
    "cardKey": card_key,
    "nmID": str(value.get("nmID") or value.get("nmId") or value.get("nm_id") or value.get("id") or "")[:80],
    "vendorCode": str(value.get("vendorCode") or value.get("vendor_code") or value.get("supplierArticle") or "")[:120],
    "title": str(value.get("title") or "")[:500],
    "subjectName": str(value.get("subjectName") or "")[:240],
  }


def public_workset_card(row):
  return {
    "cardKey": row["card_key"],
    "nmID": row["nm_id"] or "",
    "vendorCode": row["vendor_code"] or "",
    "title": row["title"] or "",
    "subjectName": row["subject_name"] or "",
    "selectedBy": row["selected_by"] or "",
    "updatedAt": row["updated_at"] or "",
  }


def list_portal_workset(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM portal_workset_cards
      WHERE portal_id = ?
      ORDER BY updated_at DESC, card_key
      """,
      (numeric_portal_id,),
    ).fetchall()
  return {
    "portalId": str(numeric_portal_id),
    "cards": [public_workset_card(row) for row in rows],
  }


def save_portal_workset(portal_id, raw_cards, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  cards = []
  seen = set()
  for raw_card in raw_cards if isinstance(raw_cards, list) else []:
    card = normalize_workset_card(raw_card)
    if not card["cardKey"] or card["cardKey"] in seen:
      continue
    seen.add(card["cardKey"])
    cards.append(card)
  cards = cards[:500]
  init_db()
  with connect_db() as db:
    db.execute("DELETE FROM portal_workset_cards WHERE portal_id = ?", (numeric_portal_id,))
    for card in cards:
      db.execute(
        """
        INSERT INTO portal_workset_cards (
          portal_id, card_key, nm_id, vendor_code, title, subject_name, selected_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
          numeric_portal_id,
          card["cardKey"],
          card["nmID"],
          card["vendorCode"],
          card["title"],
          card["subjectName"],
          user["login"],
        ),
      )
  return list_portal_workset(numeric_portal_id, user)


OZON_TASK_STATUSES = {"draft", "done", "skipped", "later", "returned"}
OZON_TASK_STATUS_LABELS = {
  "draft": "в работе",
  "done": "готово",
  "skipped": "пропущено",
  "later": "вернуться позже",
  "returned": "возврат",
}


def ensure_ozon_portal_access(portal_id, user, edit=False):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if edit:
    allowed = user_can_edit_portal(user, numeric_portal_id)
  else:
    allowed = user_can_access_portal(user, numeric_portal_id)
  if not allowed:
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    portal = db.execute(
      "SELECT id, marketplace FROM portals WHERE id = ?",
      (numeric_portal_id,),
    ).fetchone()
  if not portal:
    raise ValueError("portal_not_found")
  if audit_normalized(portal["marketplace"]) != "ozon":
    raise ValueError("ozon_portal_required")
  return numeric_portal_id


def normalize_ozon_task(raw_task):
  raw_task = raw_task if isinstance(raw_task, dict) else {}
  card_key = audit_str(raw_task.get("cardKey") or raw_task.get("card_key"), 160)
  sku = audit_str(raw_task.get("sku") or raw_task.get("id"), 120)
  offer_id = audit_str(raw_task.get("offerId") or raw_task.get("offer_id"), 120)
  title = audit_str(raw_task.get("title"), 240)
  category = audit_str(raw_task.get("category") or raw_task.get("subjectName"), 180)
  task_id = audit_str(raw_task.get("id") or raw_task.get("taskId") or raw_task.get("task_id"), 160)
  if not card_key:
    card_key = draft_card_key(sku or offer_id or title)
  if not task_id:
    task_id = f"ozon-task-{card_key}"
  status = audit_str(raw_task.get("status") or "draft", 40)
  if status not in OZON_TASK_STATUSES:
    status = "draft"
  work_type = audit_str(raw_task.get("workType") or raw_task.get("work_type") or "content", 40)
  payload = {
    "id": task_id,
    "cardKey": card_key,
    "sku": sku,
    "offerId": offer_id,
    "title": title or sku or offer_id or "Ozon карточка",
    "category": category,
    "status": status,
    "workType": work_type or "content",
  }
  return payload if card_key else None


def public_ozon_task(row):
  try:
    payload = json.loads(row["payload_json"] or "{}")
  except (TypeError, json.JSONDecodeError):
    payload = {}
  payload = payload if isinstance(payload, dict) else {}
  return {
    "id": row["task_id"],
    "cardKey": row["card_key"],
    "sku": row["sku"] or payload.get("sku") or "",
    "offerId": row["offer_id"] or payload.get("offerId") or "",
    "title": row["title"] or payload.get("title") or "Ozon карточка",
    "category": row["category"] or payload.get("category") or "",
    "status": row["status"] or "draft",
    "workType": row["work_type"] or payload.get("workType") or "content",
    "createdAt": row["created_at"] or "",
    "updatedAt": row["updated_at"] or "",
    "updatedBy": row["updated_by"] or "",
  }


def public_ozon_task_event(row):
  return {
    "id": str(row["id"]),
    "taskId": row["task_id"] or "",
    "cardKey": row["card_key"] or "",
    "action": row["action"] or "",
    "label": row["label"] or "",
    "actorLogin": row["actor_login"] or "",
    "at": row["event_at"] or "",
  }


def list_ozon_tasks(portal_id, user):
  numeric_portal_id = ensure_ozon_portal_access(portal_id, user, edit=False)
  with connect_db() as db:
    task_rows = db.execute(
      """
      SELECT *
      FROM ozon_tasks
      WHERE portal_id = ?
      ORDER BY created_at ASC, id ASC
      """,
      (numeric_portal_id,),
    ).fetchall()
    event_rows = db.execute(
      """
      SELECT *
      FROM ozon_task_events
      WHERE portal_id = ?
      ORDER BY event_at DESC, id DESC
      LIMIT 30
      """,
      (numeric_portal_id,),
    ).fetchall()
  return {
    "portalId": str(numeric_portal_id),
    "tasks": [public_ozon_task(row) for row in task_rows],
    "recentEvents": [public_ozon_task_event(row) for row in event_rows],
  }


def save_ozon_tasks(portal_id, payload, user):
  numeric_portal_id = ensure_ozon_portal_access(portal_id, user, edit=False)
  payload = payload if isinstance(payload, dict) else {}
  raw_tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
  tasks = []
  seen = set()
  for raw_task in raw_tasks:
    task = normalize_ozon_task(raw_task)
    if not task or task["cardKey"] in seen:
      continue
    seen.add(task["cardKey"])
    tasks.append(task)
  tasks = tasks[:500]
  now = utc_now().isoformat()
  actor_login = user_login_value(user) or ""
  with connect_db() as db:
    previous_rows = db.execute(
      "SELECT task_id, card_key, status, title FROM ozon_tasks WHERE portal_id = ?",
      (numeric_portal_id,),
    ).fetchall()
    previous = {row["task_id"]: row for row in previous_rows}
    next_task_ids = {task["id"] for task in tasks}
    for task in tasks:
      previous_row = previous.get(task["id"])
      db.execute(
        """
        INSERT INTO ozon_tasks (
          portal_id, task_id, card_key, sku, offer_id, title, category,
          status, work_type, payload_json, created_by, updated_by, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(portal_id, task_id) DO UPDATE SET
          card_key = excluded.card_key,
          sku = excluded.sku,
          offer_id = excluded.offer_id,
          title = excluded.title,
          category = excluded.category,
          status = excluded.status,
          work_type = excluded.work_type,
          payload_json = excluded.payload_json,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
          numeric_portal_id,
          task["id"],
          task["cardKey"],
          task["sku"],
          task["offerId"],
          task["title"],
          task["category"],
          task["status"],
          task["workType"],
          json.dumps(task, ensure_ascii=False, separators=(",", ":")),
          actor_login or None,
          actor_login or None,
        ),
      )
      if not previous_row:
        action = "created"
        label = f"Создана Ozon-задача: {task['title']}"
      elif previous_row["status"] != task["status"]:
        action = task["status"]
        label = f"{task['title']}: {OZON_TASK_STATUS_LABELS.get(task['status'], task['status'])}"
      else:
        action = ""
        label = ""
      if action:
        db.execute(
          """
          INSERT INTO ozon_task_events (portal_id, task_id, card_key, action, label, actor_login, event_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          """,
          (numeric_portal_id, task["id"], task["cardKey"], action, label[:500], actor_login, now),
        )
    for row in previous_rows:
      if row["task_id"] not in next_task_ids:
        db.execute(
          """
          INSERT INTO ozon_task_events (portal_id, task_id, card_key, action, label, actor_login, event_at)
          VALUES (?, ?, ?, 'deleted', ?, ?, ?)
          """,
          (numeric_portal_id, row["task_id"], row["card_key"], f"Удалена Ozon-задача: {row['title']}"[:500], actor_login, now),
        )
    db.execute(
      """
      DELETE FROM ozon_tasks
      WHERE portal_id = ?
        AND task_id NOT IN ({})
      """.format(",".join("?" for _ in next_task_ids) or "''"),
      [numeric_portal_id, *next_task_ids],
    )
  record_admin_event(user, "ozon_tasks_updated", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "taskCount": len(tasks),
  })
  return list_ozon_tasks(numeric_portal_id, user)


def workset_batch_draft_payload(card, user, batch_id, existing_payload=None, batch_options=None):
  batch_options = batch_options if isinstance(batch_options, dict) else {}
  work_types = normalize_work_types(batch_options.get("workTypes"))
  comment = str(batch_options.get("comment") or "").strip()[:700]
  title = str(batch_options.get("title") or "").strip()[:180]
  assignee_login = str(batch_options.get("assigneeLogin") or "").strip()[:120]
  created_at = batch_options.get("createdAt") or utc_now().isoformat()
  cards_count = int(batch_options.get("cardsCount") or 0)
  position = int(batch_options.get("position") or 0)
  if not title:
    title = work_package_title(work_types, cards_count, comment)
  payload = normalize_card_draft_payload(existing_payload or {})
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  approval = meta.get("approval") if isinstance(meta.get("approval"), dict) else {}
  if str(approval.get("status") or "draft") == "draft":
    approval = {
      **approval,
      "status": "draft",
      "submittedBy": approval.get("submittedBy") or "",
      "assigneeLogin": approval.get("assigneeLogin") or assignee_login,
    }
  approval_sections = meta.get("approvalSections") if isinstance(meta.get("approvalSections"), dict) else {}
  next_approval_sections = {**approval_sections}
  for work_type in work_types:
    if work_type not in APPROVAL_SECTION_LABELS:
      continue
    section = next_approval_sections.get(work_type) if isinstance(next_approval_sections.get(work_type), dict) else {}
    if str(section.get("status") or "draft") == "draft":
      next_approval_sections[work_type] = {
        **section,
        "status": "draft",
        "submittedBy": section.get("submittedBy") or "",
        "assigneeLogin": section.get("assigneeLogin") or assignee_login,
      }
  payload["meta"] = {
    **meta,
    "approval": approval,
    "approvalSections": next_approval_sections,
    "card": {
      "nmID": card["nmID"],
      "vendorCode": card["vendorCode"],
      "title": card["title"],
      "subjectName": card["subjectName"],
    },
    "batch": {
      "id": batch_id,
      "kind": "mass_work_package",
      "createdBy": user["login"],
      "createdAt": created_at,
      "title": title,
      "assigneeLogin": assignee_login,
      "cardsCount": cards_count,
      "position": position,
      "workTypes": work_types,
      "workTypeLabels": work_type_labels(work_types),
      "comment": comment,
    },
  }
  return payload


def create_workset_tasks(portal_id, raw_cards, user, options=None):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  options = options if isinstance(options, dict) else {}
  work_types = normalize_work_types(options.get("workTypes"))
  comment = str(options.get("comment") or "").strip()[:700]
  title = str(options.get("title") or "").strip()[:180]
  link_period_id, link_task_key = ensure_work_period_link_target(
    numeric_portal_id,
    options.get("workPeriodId") or options.get("periodId"),
    options.get("workPeriodTaskKey") or options.get("taskKey"),
  )
  team = portal_team_roles(numeric_portal_id)
  assignee_login = str(options.get("assigneeLogin") or team.get("tech") or "").strip()[:120]
  workset = save_portal_workset(numeric_portal_id, raw_cards, user)
  cards = workset["cards"]
  batch_id = f"batch-{int(time.time())}-{secrets.token_hex(4)}"
  batch_created_at = utc_now().isoformat()
  batch_options = {
    "workTypes": work_types,
    "comment": comment,
    "title": title,
    "assigneeLogin": assignee_login,
    "createdAt": batch_created_at,
    "cardsCount": len(cards),
  }
  created = 0
  kept = 0
  init_db()
  with connect_db() as db:
    for position, card in enumerate(cards):
      previous = db.execute(
        "SELECT payload_json FROM card_drafts WHERE portal_id = ? AND card_key = ?",
        (numeric_portal_id, card["cardKey"]),
      ).fetchone()
      previous_payload = None
      if previous:
        try:
          previous_payload = json.loads(previous["payload_json"])
        except (TypeError, json.JSONDecodeError):
          previous_payload = None
      payload = workset_batch_draft_payload(card, user, batch_id, previous_payload, {
        **batch_options,
        "position": position,
      })
      payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
      cursor = db.execute(
        """
        INSERT INTO card_drafts (
          portal_id, card_key, nm_id, vendor_code, payload_json,
          audit_status, created_by, updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(portal_id, card_key) DO UPDATE SET
          nm_id = COALESCE(NULLIF(excluded.nm_id, ''), nm_id),
          vendor_code = COALESCE(NULLIF(excluded.vendor_code, ''), vendor_code),
          payload_json = excluded.payload_json,
          audit_status = excluded.audit_status,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
          numeric_portal_id,
          card["cardKey"],
          card["nmID"],
          card["vendorCode"],
          payload_json,
          payload["auditStatus"],
          user["login"],
          user["login"],
        ),
      )
      if previous:
        kept += 1
      else:
        created += 1
  linked_period = None
  if link_period_id and link_task_key:
    linked_period = update_portal_work_period(numeric_portal_id, {
      "periodId": link_period_id,
      "action": "link_task",
      "taskKey": link_task_key,
      "linkedTaskIds": work_period_task_link_ids(batch_id, work_types),
      "linkedBatchIds": [batch_id],
      "comment": title or comment or work_package_title(work_types, len(cards), comment),
    }, user)
  result = {
    "portalId": str(numeric_portal_id),
    "batchId": batch_id,
    "workTypes": work_types,
    "workTypeLabels": work_type_labels(work_types),
    "comment": comment,
    "assigneeLogin": assignee_login,
    "cardsCount": len(cards),
    "tasksCreated": created,
    "tasksUpdated": kept,
    "workset": list_portal_workset(numeric_portal_id, user),
    "workflow": approval_workflow(numeric_portal_id, user),
  }
  if linked_period:
    result["workPeriod"] = linked_period
  return result


def delete_card_work_tasks(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  batch_id = str(payload.get("batchId") or payload.get("batch_id") or "").strip()[:120]
  raw_work_types = payload.get("workTypes")
  if raw_work_types is None:
    raw_work_types = [payload.get("workType") or payload.get("work_type")]
  work_types = normalize_optional_work_types(raw_work_types)
  raw_card_keys = payload.get("cardKeys") if isinstance(payload.get("cardKeys"), list) else []
  if payload.get("cardKey"):
    raw_card_keys.append(payload.get("cardKey"))
  card_keys = []
  seen_card_keys = set()
  for raw_key in raw_card_keys:
    card_key = draft_card_key(raw_key)
    if card_key and card_key not in seen_card_keys:
      seen_card_keys.add(card_key)
      card_keys.append(card_key)
  if not batch_id and not card_keys:
    raise ValueError("invalid_task_delete")

  init_db()
  updated = 0
  matched = 0
  removed_types = set()
  updated_work_periods = []
  now = utc_now().isoformat()
  with connect_db() as db:
    if batch_id:
      rows = db.execute(
        """
        SELECT id, card_key, payload_json
        FROM card_drafts
        WHERE portal_id = ?
          AND json_extract(payload_json, '$.meta.batch.id') = ?
        """,
        (numeric_portal_id, batch_id),
      ).fetchall()
    else:
      placeholders = ",".join("?" for _ in card_keys)
      rows = db.execute(
        f"""
        SELECT id, card_key, payload_json
        FROM card_drafts
        WHERE portal_id = ? AND card_key IN ({placeholders})
        """,
        [numeric_portal_id, *card_keys],
      ).fetchall()

    for row in rows:
      try:
        draft_payload = json.loads(row["payload_json"])
      except (TypeError, json.JSONDecodeError):
        continue
      draft_payload = normalize_card_draft_payload(draft_payload)
      meta = draft_payload.get("meta") if isinstance(draft_payload.get("meta"), dict) else {}
      batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
      current_work_types = normalize_optional_work_types(batch.get("workTypes"))
      if not current_work_types:
        continue
      target_work_types = work_types or current_work_types
      target_set = set(target_work_types)
      row_removed_types = [work_type for work_type in current_work_types if work_type in target_set]
      if not row_removed_types:
        continue
      matched += 1
      removed_types.update(row_removed_types)
      remaining_work_types = [work_type for work_type in current_work_types if work_type not in target_set]
      approval_sections = meta.get("approvalSections") if isinstance(meta.get("approvalSections"), dict) else {}
      approval_sections = {
        key: value
        for key, value in approval_sections.items()
        if key not in row_removed_types
      }
      if approval_sections:
        meta["approvalSections"] = approval_sections
      else:
        meta.pop("approvalSections", None)

      removal_history = meta.get("taskRemovalHistory") if isinstance(meta.get("taskRemovalHistory"), list) else []
      removal_history.append({
        "at": now,
        "by": user["login"],
        "batchId": batch.get("id") or "",
        "cardKey": row["card_key"],
        "workTypes": row_removed_types,
      })
      meta["taskRemovalHistory"] = removal_history[-50:]

      if remaining_work_types:
        previous_title = str(batch.get("title") or "")
        previous_auto_title = work_package_title(current_work_types, batch.get("cardsCount"), batch.get("comment"))
        batch = {
          **batch,
          "workTypes": remaining_work_types,
          "workTypeLabels": [WORK_TYPE_LABELS.get(item, item) for item in remaining_work_types],
        }
        if not previous_title or previous_title == previous_auto_title:
          batch["title"] = work_package_title(remaining_work_types, batch.get("cardsCount"), batch.get("comment"))
        meta["batch"] = batch
      else:
        meta.pop("batch", None)

      draft_payload["meta"] = meta
      db.execute(
        """
        UPDATE card_drafts
        SET payload_json = ?, audit_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND portal_id = ?
        """,
        (
          json.dumps(draft_payload, ensure_ascii=False, separators=(",", ":")),
          draft_payload.get("auditStatus") or "idle",
          user["login"],
          row["id"],
          numeric_portal_id,
        ),
      )
      updated += 1

    if batch_id and removed_types:
      updated_work_periods = unlink_work_period_task_links_in_db(
        db,
        numeric_portal_id,
        linked_task_ids=work_period_task_link_ids(batch_id, sorted(removed_types)),
        linked_batch_ids=[batch_id],
        user=user,
        comment="задача удалена из кабинета",
      )

  record_admin_event(user, "card_work_tasks_deleted", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "batchId": batch_id,
    "cardKeys": card_keys[:50],
    "workTypes": sorted(removed_types),
    "matched": matched,
    "updated": updated,
  })
  return {
    "portalId": str(numeric_portal_id),
    "deleted": updated,
    "matched": matched,
    "workTypes": sorted(removed_types),
    "workflow": approval_workflow(numeric_portal_id, user),
    "workPeriods": updated_work_periods,
  }


def reorder_card_work_tasks(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  batch_id = str(payload.get("batchId") or payload.get("batch_id") or "").strip()[:120]
  raw_card_keys = payload.get("cardKeys") if isinstance(payload.get("cardKeys"), list) else []
  card_keys = []
  seen_card_keys = set()
  for raw_key in raw_card_keys:
    card_key = draft_card_key(raw_key)
    if card_key and card_key not in seen_card_keys:
      seen_card_keys.add(card_key)
      card_keys.append(card_key)
  if not batch_id or len(card_keys) < 2:
    raise ValueError("invalid_task_order")

  init_db()
  updated = 0
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT id, card_key, payload_json, created_at, updated_at
      FROM card_drafts
      WHERE portal_id = ?
        AND json_extract(payload_json, '$.meta.batch.id') = ?
      """,
      (numeric_portal_id, batch_id),
    ).fetchall()
    if not rows:
      raise ValueError("task_batch_not_found")

    rows_by_key = {row["card_key"]: row for row in rows}
    ordered_keys = [card_key for card_key in card_keys if card_key in rows_by_key]
    if len(ordered_keys) < 2:
      raise ValueError("invalid_task_order")

    def row_position(row):
      try:
        draft_payload = json.loads(row["payload_json"])
      except (TypeError, json.JSONDecodeError):
        return len(rows)
      meta = draft_payload.get("meta") if isinstance(draft_payload.get("meta"), dict) else {}
      batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
      try:
        return int(batch.get("position"))
      except (TypeError, ValueError):
        return len(rows)

    tail_rows = [
      row
      for row in rows
      if row["card_key"] not in set(ordered_keys)
    ]
    tail_rows.sort(key=lambda row: (row_position(row), row["created_at"] or "", row["card_key"]))
    next_keys = [*ordered_keys, *[row["card_key"] for row in tail_rows]]
    positions = {card_key: index for index, card_key in enumerate(next_keys)}

    for row in rows:
      try:
        draft_payload = json.loads(row["payload_json"])
      except (TypeError, json.JSONDecodeError):
        continue
      draft_payload = normalize_card_draft_payload(draft_payload)
      meta = draft_payload.get("meta") if isinstance(draft_payload.get("meta"), dict) else {}
      batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
      if str(batch.get("id") or "") != batch_id:
        continue
      next_position = positions.get(row["card_key"])
      if next_position is None:
        continue
      previous_position = batch.get("position")
      try:
        previous_position = int(previous_position)
      except (TypeError, ValueError):
        previous_position = None
      if previous_position == next_position:
        continue
      batch["position"] = next_position
      meta["batch"] = batch
      draft_payload["meta"] = meta
      db.execute(
        """
        UPDATE card_drafts
        SET payload_json = ?, audit_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND portal_id = ?
        """,
        (
          json.dumps(draft_payload, ensure_ascii=False, separators=(",", ":")),
          draft_payload.get("auditStatus") or "idle",
          user_login_value(user) or None,
          row["id"],
          numeric_portal_id,
        ),
      )
      updated += 1

  record_admin_event(user, "card_work_tasks_reordered", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "batchId": batch_id,
    "cardKeys": card_keys[:200],
    "updated": updated,
  })
  return {
    "portalId": str(numeric_portal_id),
    "batchId": batch_id,
    "updated": updated,
    "workflow": approval_workflow(numeric_portal_id, user),
  }


CARD_WORK_EVENT_ACTIONS = {
  "opened": "открыта в конвейере",
  "skipped": "пропущена в текущем проходе",
  "deferred": "перенесена на позже",
  "quick_completed": "закрыта быстрым действием",
  "audit_completed": "аудит карточки готов",
  "audit_failed": "аудит карточки не выполнен",
}


def log_card_work_event(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key"))
  action = str(payload.get("action") or "").strip()[:40]
  if not card_key or action not in CARD_WORK_EVENT_ACTIONS:
    raise ValueError("invalid_task_event")
  work_type = str(payload.get("workType") or payload.get("work_type") or "").strip()
  work_type_label = WORK_TYPE_LABELS.get(work_type, work_type)
  batch_id = str(payload.get("batchId") or payload.get("batch_id") or "").strip()[:120]
  comment = str(payload.get("reason") or "").strip()[:400]

  init_db()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT card_key, nm_id, vendor_code
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
    if not row:
      raise ValueError("task_not_found")
    reason_parts = [CARD_WORK_EVENT_ACTIONS[action]]
    if work_type_label:
      reason_parts.append(work_type_label)
    if batch_id:
      reason_parts.append(f"batch {batch_id}")
    if comment:
      reason_parts.append(comment)
    event = {
      "status": action,
      "action": action,
      "actorLogin": user_login_value(user) or "",
      "assigneeLogin": "",
      "reason": " · ".join(reason_parts)[:1000],
      "eventAt": utc_now().isoformat(),
      "nmID": str(row["nm_id"] or payload.get("nmID") or payload.get("nm_id") or "")[:80],
      "vendorCode": str(row["vendor_code"] or payload.get("vendorCode") or payload.get("vendor_code") or "")[:120],
    }
    insert_card_approval_event(db, numeric_portal_id, card_key, event)

  return {
    "portalId": str(numeric_portal_id),
    "cardKey": card_key,
    "action": action,
    "workflow": approval_workflow(numeric_portal_id, user),
  }


def audit_draft_payload_from_result(audit_payload, previous_payload):
  previous_payload = normalize_card_draft_payload(previous_payload)
  draft_content = audit_payload.get("draftContent") if isinstance(audit_payload.get("draftContent"), dict) else {}
  title = draft_content.get("title") if isinstance(draft_content.get("title"), dict) else {}
  description = draft_content.get("description") if isinstance(draft_content.get("description"), dict) else {}
  characteristics = draft_content.get("characteristics") if isinstance(draft_content.get("characteristics"), dict) else {}
  previous_meta = previous_payload.get("meta") if isinstance(previous_payload.get("meta"), dict) else {}
  previous_history = previous_meta.get("auditHistory") if isinstance(previous_meta.get("auditHistory"), list) else []
  audit_entry = audit_payload.get("auditEntry") if isinstance(audit_payload.get("auditEntry"), dict) else {}
  next_history = [audit_entry, *previous_history] if audit_entry else previous_history
  meta = {
    **previous_meta,
    "auditHistory": next_history[:20],
    "auditResult": audit_payload.get("auditResult") if isinstance(audit_payload.get("auditResult"), dict) else {},
    "evidenceSummary": audit_payload.get("evidenceSummary") if isinstance(audit_payload.get("evidenceSummary"), dict) else {},
  }
  return normalize_card_draft_payload({
    "version": 2,
    "auditStatus": "done",
    "content": {
      "title": {
        "value": title.get("value") or "",
        "source": title.get("source") or "audit",
        "reason": title.get("reason") or "",
      },
      "description": {
        "value": description.get("value") or "",
        "source": description.get("source") or "audit",
        "reason": description.get("reason") or "",
      },
      "characteristics": characteristics,
    },
    "prices": previous_payload.get("prices") if isinstance(previous_payload.get("prices"), dict) else {},
    "stocks": previous_payload.get("stocks") if isinstance(previous_payload.get("stocks"), dict) else {},
    "meta": meta,
  })


def public_audit_task_error_reason(exc):
  if isinstance(exc, (AttributeError, TypeError, KeyError, IndexError)):
    return "invalid_audit_result"
  if isinstance(exc, TimeoutError):
    return "timeout"
  if isinstance(exc, RuntimeError):
    return "service_secret_unavailable"
  return "internal_error"


def audit_and_save_card_task(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key"))
  if not card_key:
    raise ValueError("invalid_card_key")

  init_db()
  with connect_db() as db:
    portal = db.execute(
      "SELECT cards_snapshot_json FROM portals WHERE id = ?",
      (numeric_portal_id,),
    ).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    draft_row = db.execute(
      """
      SELECT payload_json, nm_id, vendor_code
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
    if not draft_row:
      raise ValueError("task_not_found")
    try:
      previous_payload = json.loads(draft_row["payload_json"])
    except (TypeError, json.JSONDecodeError):
      previous_payload = normalize_card_draft_payload({})
    snapshot_card = snapshot_card_lookup(portal["cards_snapshot_json"]).get(card_key) or {}

  raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
  card = snapshot_card or raw_card
  if not card:
    raise ValueError("card_not_found")
  work_type = str(payload.get("workType") or payload.get("work_type") or "").strip()
  batch_id = str(payload.get("batchId") or payload.get("batch_id") or "").strip()[:120]
  context_token = mpstats_call_context_start(user, "Пачка: аудит карточки", portal_id=numeric_portal_id, card_key=card_key, nm_id=card.get("nmID") or card.get("nmId"), details={
    "batchId": batch_id,
    "workType": work_type,
  })
  try:
    audit_payload = build_card_audit(
      numeric_portal_id,
      card_key,
      card,
      subject_characteristics=None,
      mpstats_characteristics=None,
      period=payload.get("period"),
      audit_competitors=payload.get("auditCompetitors") or payload.get("competitorsForAudit"),
    )
  finally:
    mpstats_call_context_stop(context_token)

  next_payload = audit_draft_payload_from_result(audit_payload, previous_payload)
  nm_id = card.get("nmID") or card.get("nmId") or card.get("nm_id") or draft_row["nm_id"] or payload.get("nmID") or ""
  vendor_code = card.get("vendorCode") or card.get("vendor_code") or draft_row["vendor_code"] or payload.get("vendorCode") or ""
  draft = save_card_draft(numeric_portal_id, card_key, nm_id, vendor_code, next_payload, user)
  log_card_work_event(numeric_portal_id, {
    "cardKey": card_key,
    "action": "audit_completed",
    "workType": work_type,
    "batchId": batch_id,
  }, user)
  return {
    "portalId": str(numeric_portal_id),
    "cardKey": card_key,
    "draft": draft,
    "auditEntry": audit_payload.get("auditEntry"),
    "evidenceSummary": audit_payload.get("evidenceSummary"),
    "workflow": approval_workflow(numeric_portal_id, user),
  }


def delete_completed_approval_task(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key"))
  work_type = str(payload.get("workType") or payload.get("work_type") or "").strip()
  if not card_key or work_type != "semantic":
    raise ValueError("invalid_completed_task_delete")

  init_db()
  removed = 0
  now = utc_now().isoformat()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT id, card_key, payload_json
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
    if not row:
      raise ValueError("completed_task_not_found")
    try:
      draft_payload = json.loads(row["payload_json"])
    except (TypeError, json.JSONDecodeError):
      draft_payload = normalize_card_draft_payload({})
    draft_payload = normalize_card_draft_payload(draft_payload)
    meta = draft_payload.get("meta") if isinstance(draft_payload.get("meta"), dict) else {}
    batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
    if batch:
      raise ValueError("completed_task_has_batch")
    final_export = meta.get("semanticCoreFinal") if isinstance(meta.get("semanticCoreFinal"), dict) else {}
    if not semantic_core_final_exists(meta):
      raise ValueError("completed_task_not_found")

    removal_history = meta.get("completedTaskRemovalHistory") if isinstance(meta.get("completedTaskRemovalHistory"), list) else []
    removal_history.append({
      "at": now,
      "by": user_login_value(user),
      "cardKey": row["card_key"],
      "workType": work_type,
      "completedAt": final_export.get("updatedAt") or final_export.get("createdAt") or "",
      "completedBy": final_export.get("updatedBy") or final_export.get("createdBy") or "",
      "reason": str(payload.get("reason") or "removed_from_completed_tasks")[:400],
    })
    meta["completedTaskRemovalHistory"] = removal_history[-50:]
    meta.pop("semanticCoreFinal", None)
    draft_payload["meta"] = meta
    db.execute(
      """
      UPDATE card_drafts
      SET payload_json = ?, audit_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND portal_id = ?
      """,
      (
        json.dumps(draft_payload, ensure_ascii=False, separators=(",", ":")),
        draft_payload.get("auditStatus") or "idle",
        user_login_value(user) or None,
        row["id"],
        numeric_portal_id,
      ),
    )
    removed = 1

  record_admin_event(user, "completed_task_deleted", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "cardKey": card_key,
    "workType": work_type,
    "removed": removed,
  })
  return {
    "portalId": str(numeric_portal_id),
    "deleted": removed,
    "cardKey": card_key,
    "workType": work_type,
    "workflow": approval_workflow(numeric_portal_id, user),
  }


def event_minutes_between(start, end):
  if not start or not end:
    return None
  try:
    start_dt = dt.datetime.fromisoformat(str(start).replace("Z", "+00:00"))
    end_dt = dt.datetime.fromisoformat(str(end).replace("Z", "+00:00"))
  except ValueError:
    return None
  return max(0, int((end_dt - start_dt).total_seconds() // 60))


def event_sort_timestamp(value):
  text = str(value or "").strip()
  if not text:
    return 0
  if " " in text and "T" not in text:
    text = text.replace(" ", "T", 1)
  try:
    parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
  except ValueError:
    return 0
  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=dt.timezone.utc)
  return parsed.timestamp()


def approval_workflow(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    portal = db.execute(
      "SELECT cards_snapshot_json FROM portals WHERE id = ?",
      (numeric_portal_id,),
    ).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    snapshot_lookup = snapshot_card_lookup(portal["cards_snapshot_json"])
    task_rows = db.execute(
      """
      SELECT *
      FROM card_drafts
      WHERE portal_id = ?
        AND COALESCE(NULLIF(json_extract(payload_json, '$.meta.approval.status'), ''), 'draft') IN ('draft', 'submitted', 'changes_requested', 'approved', 'exported')
      ORDER BY
        CASE COALESCE(NULLIF(json_extract(payload_json, '$.meta.approval.status'), ''), 'draft')
          WHEN 'submitted' THEN 1
          WHEN 'changes_requested' THEN 2
          WHEN 'draft' THEN 3
          ELSE 4
        END,
        updated_at DESC
      """,
      (numeric_portal_id,),
    ).fetchall()
    all_event_rows = db.execute(
      """
      SELECT *
      FROM card_approval_events
      WHERE portal_id = ?
      ORDER BY event_at DESC, id DESC
      """,
      (numeric_portal_id,),
    ).fetchall()
    event_rows = all_event_rows[:50]

  tasks = [
    task
    for task in (public_approval_task(row, snapshot_lookup) for row in task_rows)
    if task.get("workTypes")
  ]
  completed_tasks = [
    task
    for row in task_rows
    for task in public_completed_approval_tasks(row, snapshot_lookup)
  ]
  completed_tasks.sort(key=lambda task: event_sort_timestamp(task.get("completedAt") or task.get("updatedAt")), reverse=True)
  completed_count = len(completed_tasks)
  completed_tasks = completed_tasks[:200]
  draft_tasks = [task for task in tasks if task["status"] == "draft"]
  submitted_tasks = [task for task in tasks if task["status"] == "submitted"]
  returned_tasks = [task for task in tasks if task["status"] == "changes_requested"]
  approved_tasks = [task for task in tasks if task["status"] == "approved"]
  latest_submitted_by_card = {}
  approval_minutes = []
  for row in reversed(all_event_rows):
    if row["status"] == "submitted":
      latest_submitted_by_card[row["card_key"]] = row["event_at"]
    elif row["status"] == "approved":
      minutes = event_minutes_between(latest_submitted_by_card.get(row["card_key"]), row["event_at"])
      if minutes is not None:
        approval_minutes.append(minutes)
  approval_minutes = [value for value in approval_minutes if value is not None]
  pending_minutes = [
    event_minutes_between(task.get("submittedAt"), dt.datetime.now(dt.timezone.utc).isoformat())
    for task in submitted_tasks
  ]
  pending_minutes = [value for value in pending_minutes if value is not None]
  recent_events = []
  for row in event_rows:
    card = snapshot_lookup.get(row["card_key"], {})
    recent_events.append({
      "id": row["id"],
      "cardKey": row["card_key"],
      "nmID": row["nm_id"] or card.get("nmID") or "",
      "vendorCode": row["vendor_code"] or card.get("vendorCode") or "",
      "title": card.get("title") or row["vendor_code"] or row["nm_id"] or "Карточка WB",
      "subjectName": card.get("subjectName") or "",
      "status": row["status"],
      "action": row["action"],
      "actorLogin": row["actor_login"],
      "assigneeLogin": row["assignee_login"],
      "reason": row["reason"],
      "eventAt": row["event_at"],
    })
  return {
    "tasks": tasks,
    "analytics": {
      "pendingCount": len(submitted_tasks),
      "draftCount": len(draft_tasks),
      "returnedCount": len(returned_tasks),
      "approvedCount": len(approved_tasks),
      "completedCount": completed_count,
      "eventCount": len(all_event_rows),
      "avgApprovalMinutes": round(sum(approval_minutes) / len(approval_minutes)) if approval_minutes else None,
      "avgPendingMinutes": round(sum(pending_minutes) / len(pending_minutes)) if pending_minutes else None,
      "lastEventAt": recent_events[0]["eventAt"] if recent_events else "",
    },
    "completedTasks": completed_tasks,
    "recentEvents": recent_events,
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


def list_portal_card_drafts(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM card_drafts
      WHERE portal_id = ?
      ORDER BY updated_at DESC, card_key
      """,
      (numeric_portal_id,),
    ).fetchall()
  return {
    "portalId": str(numeric_portal_id),
    "drafts": [public_card_draft(row) for row in rows],
  }


def delete_card_draft(portal_id, card_key, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    cursor = db.execute(
      """
      DELETE FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    )
  return cursor.rowcount > 0


def portal_team_roles(portal_id):
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT project_role, user_login
      FROM portal_members
      WHERE portal_id = ?
      """,
      (portal_id,),
    ).fetchall()
  return {row["project_role"]: row["user_login"] for row in rows if row["project_role"] and row["user_login"]}


def user_can_review_portal_approval(user, portal_id):
  if user_is_admin(user):
    return True
  return portal_team_roles(portal_id).get("manager") == user_login_value(user)


APPROVAL_SECTION_LABELS = {
  "content": "Контент",
  "prices": "Цены",
  "stocks": "Остатки",
}


WORK_TYPE_LABELS = {
  "semantic": "СЯ",
  "content": "Контент",
  "prices": "Цены",
  "stocks": "Остатки",
}


WORK_PERIOD_TASK_LABELS = {
  "supplier_matrix_analysis": "Анализ матрицы поставщика",
  "semantic_core_collection": "Сбор семантического ядра с ключевыми словами",
  "optimized_product_title": "Составление оптимизированного наименования товара",
  "optimized_characteristics": "Заполнение оптимизированных характеристик для каждой карточки товаров",
  "optimized_description": "Подготовка описаний с учетом ключевых слов и ограничений по объему",
  "infographic_preparation": "Подготовка инфографики для карточки товара",
  "review_reply_templates": "Разработка шаблона ответа на отзывы",
  "reviews_questions_monitoring": "Отслеживание отзывов и вопросов покупателей",
  "marketplace_promo_alerts": "Своевременное оповещение о предстоящих акциях на маркетплейсе",
  "internal_ads_recommendations": "Составление рекомендаций по внутренней рекламе",
  "external_ads_recommendations": "Составление рекомендаций по внешней рекламе",
  "ad_bids_monitoring": "Корректировка и мониторинг ставок рекламной кампании",
  "infographic_ab_test": "A/B тест инфографики",
  "rich_content_proposal": "Предложение по подготовке Рич-контента",
  "external_ads_plan_launch": "Рекомендации и запуск внешней рекламы",
  "recommendations_block_setup": "Подготовка рекомендаций по настройке блока «с товаром рекомендуют»",
  "video_content_recommendations": "Составление рекомендаций по видео-контенту",
  "warehouse_supply_recommendations": "Составление рекомендаций по поставкам на склад",
  "storefront_design_recommendations": "Рекомендации по оформлению витрины магазина",
  "store_banner_preparation": "Подготовка баннера для магазина",
  "rich_content_preparation": "Подготовка Rich-контента для карточки товара",
  "margin_calculation": "Расчет маржинальности",
  "stock_monitoring": "Мониторинг остатков",
  "review_points_proposal": "Предложение по подключению инструмента «Баллы за отзывы»",
  "abc_analysis": "ABC-анализ",
  "supply_proposal": "Предложение по поставке",
  "ad_campaign_report": "Составление отчета по рекламной кампании",
  "external_ads_proposal": "Предложение по внешней рекламе",
  "external_ads_connection": "Подключение внешней рекламы",
  "external_ads_report": "Составление отчета по внешней рекламе",
  "wb_guru_article_recommendations": "Подготовка рекомендаций по статье",
  "wb_guru_article_content": "Подготовка визуала и текстового контента для статьи",
  "keyword_positions_report": "Составление отчета по позициям ключевых запросов в карточках товара",
  "self_purchase_recommendations": "Рекомендации по самовыкупам",
  "sales_report": "Составление отчета о продажах",
  "work_done_report": "Составление отчета о проделанной работе",
  "semantic": "Семантика",
  "content": "Контент",
  "prices": "Цены",
  "stocks": "Остатки",
}

DEFAULT_WORK_PERIOD_TASK_KEYS = [
  key
  for key in WORK_PERIOD_TASK_LABELS
  if key not in {"semantic", "content", "prices", "stocks"}
]
MANUAL_WORK_PERIOD_TASK_PREFIX = "manual:"


def normalize_work_types(value):
  if isinstance(value, str):
    raw_items = re.split(r"[\s,;]+", value)
  elif isinstance(value, (list, tuple, set)):
    raw_items = list(value)
  else:
    raw_items = []
  output = []
  seen = set()
  for item in raw_items:
    key = str(item or "").strip().lower()
    if key in WORK_TYPE_LABELS and key not in seen:
      seen.add(key)
      output.append(key)
  return output or ["content"]


def normalize_optional_work_types(value):
  if isinstance(value, str):
    raw_items = re.split(r"[\s,;]+", value)
  elif isinstance(value, (list, tuple, set)):
    raw_items = list(value)
  else:
    raw_items = []
  output = []
  seen = set()
  for item in raw_items:
    key = str(item or "").strip().lower()
    if key in WORK_TYPE_LABELS and key not in seen:
      seen.add(key)
      output.append(key)
  return output


def work_type_labels(work_types):
  return [WORK_TYPE_LABELS.get(item, item) for item in normalize_work_types(work_types)]


def normalize_work_period_task_keys(value, fallback_keys=None):
  if isinstance(value, str):
    raw_items = re.split(r"[\s,;]+", value)
  elif isinstance(value, (list, tuple, set)):
    raw_items = list(value)
  else:
    raw_items = []
  output = []
  seen = set()
  for item in raw_items:
    key = str(item.get("key") if isinstance(item, dict) else item or "").strip().lower()
    if key in WORK_PERIOD_TASK_LABELS and key not in seen:
      seen.add(key)
      output.append(key)
  if output:
    return output
  return list(DEFAULT_WORK_PERIOD_TASK_KEYS if fallback_keys is None else fallback_keys)


def clean_manual_work_period_task_key(value):
  key = str(value or "").strip().lower()
  if not key.startswith(MANUAL_WORK_PERIOD_TASK_PREFIX):
    return ""
  suffix = re.sub(r"[^a-z0-9_-]+", "-", key[len(MANUAL_WORK_PERIOD_TASK_PREFIX):]).strip("-")[:80]
  return f"{MANUAL_WORK_PERIOD_TASK_PREFIX}{suffix}" if suffix else ""


def clean_work_period_attachment_name(value):
  name = str(value or "work-file").split("/")[-1].split("\\")[-1].strip()
  name = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "-", name).strip(". -")
  return name[:160] or "work-file"


def clean_work_period_attachments(items):
  output = []
  for item in items if isinstance(items, list) else []:
    if not isinstance(item, dict):
      continue
    data_url = str(item.get("dataUrl") or "").strip()
    if not data_url or len(data_url) > WORK_PERIOD_ATTACHMENT_MAX_DATA_URL_BYTES:
      continue
    if not data_url.startswith("data:") or ";base64," not in data_url[:200]:
      continue
    header, encoded = data_url.split(";base64,", 1)
    content_type = header[5:].strip()[:120] or "application/octet-stream"
    try:
      decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
      continue
    if len(decoded) > WORK_PERIOD_ATTACHMENT_MAX_BYTES:
      continue
    try:
      size = int(item.get("size") or len(decoded))
    except (TypeError, ValueError):
      size = len(decoded)
    output.append({
      "id": str(item.get("id") or f"attachment-{uuid.uuid4().hex[:12]}")[:80],
      "name": clean_work_period_attachment_name(item.get("name")),
      "type": content_type,
      "size": max(0, min(size, WORK_PERIOD_ATTACHMENT_MAX_BYTES)),
      "dataUrl": f"data:{content_type};base64,{encoded}",
      "uploadedAt": str(item.get("uploadedAt") or "")[:80],
      "uploadedBy": str(item.get("uploadedBy") or "")[:120],
    })
    break
  return output


def work_period_payload_has_tasks(payload):
  return any(key in payload for key in ("tasks", "workTypes", "taskKeys", "manualTasks"))


def work_period_payload_task_items(payload, default_if_missing=False):
  payload = payload if isinstance(payload, dict) else {}
  output = []
  if isinstance(payload.get("tasks"), list):
    output.extend(payload.get("tasks"))
  elif "workTypes" in payload or "taskKeys" in payload:
    output.extend(normalize_work_period_task_keys(payload.get("workTypes") if "workTypes" in payload else payload.get("taskKeys"), fallback_keys=[]))
  elif default_if_missing:
    output.extend(DEFAULT_WORK_PERIOD_TASK_KEYS)
  if isinstance(payload.get("manualTasks"), list):
    output.extend(payload.get("manualTasks"))
  return output


def clean_work_period_status(value):
  status = str(value or "").strip().lower()
  return status if status in {"active", "reported", "archived"} else "active"


def clean_work_period_task_status(value):
  status = str(value or "").strip().lower()
  return status if status in {"planned", "in_progress", "review", "done", "returned", "excluded"} else "planned"


def clean_work_period_note(value, limit=1200):
  return str(value or "").strip()[:limit]


def clean_work_period_history(items):
  output = []
  for item in items if isinstance(items, list) else []:
    if not isinstance(item, dict):
      continue
    action = str(item.get("action") or "").strip()[:40]
    if not action:
      continue
    output.append({
      "action": action,
      "at": str(item.get("at") or "")[:80],
      "by": str(item.get("by") or "")[:120],
      "comment": clean_work_period_note(item.get("comment"), 1000),
      "reason": clean_work_period_note(item.get("reason"), 1000),
    })
  return output[-50:]


def clean_work_period_links(items, limit=200):
  output = []
  seen = set()
  raw_items = items if isinstance(items, list) else []
  for item in raw_items:
    value = str(item or "").strip()[:120]
    if value and value not in seen:
      seen.add(value)
      output.append(value)
    if len(output) >= limit:
      break
  return output


def clean_work_period_task_key(value):
  raw_key = str(value or "").strip().lower()
  return raw_key if raw_key in WORK_PERIOD_TASK_LABELS else clean_manual_work_period_task_key(raw_key)


def work_period_task_link_ids(batch_id, work_types):
  clean_batch_id = str(batch_id or "").strip()[:120]
  if not clean_batch_id:
    return []
  return clean_work_period_links([
    f"{work_type}:{clean_batch_id}"
    for work_type in normalize_work_types(work_types)
  ])


def work_period_task_ids_reference_batch(task_ids, batch_id):
  clean_batch_id = str(batch_id or "").strip()
  if not clean_batch_id:
    return False
  return any(str(task_id or "").endswith(f":{clean_batch_id}") for task_id in task_ids)


def parse_work_period_task_link_id(value):
  text = str(value or "").strip()
  if ":" not in text:
    return "", ""
  work_type, batch_id = text.split(":", 1)
  work_type = normalize_optional_work_types([work_type])
  clean_batch_id = str(batch_id or "").strip()[:120]
  return (work_type[0] if work_type else ""), clean_batch_id


def work_period_status_for_task_work_status(work_type, status):
  if work_type == "semantic":
    return "done" if status == "approved" else "in_progress"
  if status in {"approved", "exported"}:
    return "done"
  if status == "submitted":
    return "review"
  return "in_progress"


def work_period_status_context_for_payload(payload, work_type, row=None):
  meta = payload.get("meta") if isinstance(payload, dict) and isinstance(payload.get("meta"), dict) else {}
  status = task_work_type_status(meta, work_type)
  period_status = work_period_status_for_task_work_status(work_type, status)
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  if work_type == "semantic":
    final_export = meta.get("semanticCoreFinal") if isinstance(meta.get("semanticCoreFinal"), dict) else {}
    return {
      "status": period_status,
      "sourceStatus": status,
      "at": str(final_export.get("updatedAt") or final_export.get("createdAt") or row_value(row, "updated_at") or utc_now().isoformat())[:80],
      "by": str(final_export.get("updatedBy") or final_export.get("createdBy") or row_value(row, "updated_by") or batch.get("assigneeLogin") or batch.get("createdBy") or "")[:120],
      "reason": "",
    }
  approval = approval_for_task_work_type(meta, work_type)
  event_at = (
    approval.get("reviewedAt") if status in {"approved", "exported", "changes_requested"} else ""
  ) or approval.get("submittedAt") or row_value(row, "updated_at") or utc_now().isoformat()
  actor = (
    approval.get("reviewedBy") if status in {"approved", "exported", "changes_requested"} else ""
  ) or approval.get("submittedBy") or row_value(row, "updated_by") or batch.get("assigneeLogin") or batch.get("createdBy") or ""
  return {
    "status": period_status,
    "sourceStatus": status,
    "at": str(event_at)[:80],
    "by": str(actor)[:120],
    "reason": clean_work_period_note(approval.get("returnReason"), 1000) if status == "changes_requested" else "",
  }


def aggregate_batch_work_period_status(db, portal_id, batch_id, work_type):
  clean_batch_id = str(batch_id or "").strip()[:120]
  work_type = normalize_optional_work_types([work_type])
  if not clean_batch_id or not work_type:
    return None
  work_type = work_type[0]
  rows = db.execute(
    """
    SELECT payload_json, updated_at, updated_by, created_by
    FROM card_drafts
    WHERE portal_id = ?
      AND json_extract(payload_json, '$.meta.batch.id') = ?
    """,
    (portal_id, clean_batch_id),
  ).fetchall()
  contexts = []
  for row in rows:
    try:
      payload = normalize_card_draft_payload(json.loads(row["payload_json"]))
    except (TypeError, json.JSONDecodeError):
      continue
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
    if work_type not in normalize_optional_work_types(batch.get("workTypes")):
      continue
    contexts.append(work_period_status_context_for_payload(payload, work_type, row))
  if not contexts:
    return None
  priority = {"in_progress": 3, "review": 2, "done": 1}
  target_status = sorted(contexts, key=lambda item: priority.get(item["status"], 0), reverse=True)[0]["status"]
  candidates = [item for item in contexts if item["status"] == target_status]
  reason_candidates = [item for item in candidates if item.get("reason")]
  selected = sorted(reason_candidates or candidates, key=lambda item: item.get("at") or "", reverse=True)[0]
  return {
    "status": target_status,
    "at": selected.get("at") or utc_now().isoformat(),
    "by": selected.get("by") or "",
    "reason": selected.get("reason") or "",
    "sourceStatus": selected.get("sourceStatus") or "",
  }


def aggregate_work_period_task_link_status(db, portal_id, task):
  link_ids = clean_work_period_links(task.get("linkedTaskIds"))
  links = [parse_work_period_task_link_id(item) for item in link_ids]
  links = [(work_type, batch_id) for work_type, batch_id in links if work_type and batch_id]
  if not links:
    return None
  contexts = [
    aggregate_batch_work_period_status(db, portal_id, batch_id, work_type)
    for work_type, batch_id in links
  ]
  contexts = [item for item in contexts if item]
  if not contexts:
    return None
  priority = {"in_progress": 3, "review": 2, "done": 1}
  target_status = sorted(contexts, key=lambda item: priority.get(item["status"], 0), reverse=True)[0]["status"]
  candidates = [item for item in contexts if item["status"] == target_status]
  reason_candidates = [item for item in candidates if item.get("reason")]
  selected = sorted(reason_candidates or candidates, key=lambda item: item.get("at") or "", reverse=True)[0]
  return {
    "status": target_status,
    "at": selected.get("at") or utc_now().isoformat(),
    "by": selected.get("by") or "",
    "reason": selected.get("reason") or "",
    "sourceStatus": selected.get("sourceStatus") or "",
  }


def work_period_auto_status_comment(status):
  if status == "done":
    return "связанная задача выполнена"
  if status == "review":
    return "связанная задача на согласовании"
  return "связанная задача в работе"


def apply_work_period_auto_status(task, context, fallback_user):
  target_status = clean_work_period_task_status(context.get("status"))
  if task.get("status") == "excluded" or target_status in {"returned", "excluded"}:
    return task, False
  changed = task.get("status") != target_status
  reason = clean_work_period_note(context.get("reason"), 1000)
  if target_status == "in_progress" and reason and task.get("returnReason") != reason:
    changed = True
  if not changed:
    return task, False
  event_at = str(context.get("at") or utc_now().isoformat())[:80]
  actor = str(context.get("by") or user_login_value(fallback_user) or "")[:120]
  history = clean_work_period_history(task.get("history"))
  history.append({
    "action": f"auto_status:{target_status}",
    "at": event_at,
    "by": actor,
    "comment": work_period_auto_status_comment(target_status),
    "reason": reason,
  })
  next_task = {
    **task,
    "status": target_status,
    "statusUpdatedAt": event_at,
    "statusUpdatedBy": actor,
    "history": clean_work_period_history(history),
  }
  if target_status == "done":
    next_task = {
      **next_task,
      "completedAt": event_at,
      "completedBy": actor,
      "returnReason": "",
      "returnedAt": "",
      "returnedBy": "",
    }
  elif target_status == "review":
    next_task = {
      **next_task,
      "completedAt": "",
      "completedBy": "",
      "returnReason": "",
      "returnedAt": "",
      "returnedBy": "",
    }
  else:
    next_task = {
      **next_task,
      "completedAt": "",
      "completedBy": "",
    }
    if reason:
      next_task = {
        **next_task,
        "returnReason": reason,
        "returnedAt": event_at,
        "returnedBy": actor,
      }
  return next_task, True


def sync_work_period_task_statuses_for_batch_in_db(db, portal_id, batch_id, user=None):
  clean_batch_id = str(batch_id or "").strip()[:120]
  if not clean_batch_id:
    return []
  rows = db.execute(
    """
    SELECT *
    FROM portal_work_periods
    WHERE portal_id = ? AND status != 'archived'
    ORDER BY period_start DESC, id DESC
    """,
    (portal_id,),
  ).fetchall()
  updated_periods = []
  for row in rows:
    tasks = normalize_work_period_tasks(parse_work_period_json(row["tasks_json"], []))
    next_tasks = []
    changed = False
    for task in tasks:
      linked_task_ids = clean_work_period_links(task.get("linkedTaskIds"))
      if not any(parse_work_period_task_link_id(item)[1] == clean_batch_id for item in linked_task_ids):
        next_tasks.append(task)
        continue
      context = aggregate_work_period_task_link_status(db, portal_id, task)
      if not context:
        next_tasks.append(task)
        continue
      next_task, task_changed = apply_work_period_auto_status(task, context, user)
      next_tasks.append(next_task)
      changed = changed or task_changed
    if not changed:
      continue
    next_status = clean_work_period_status(row["status"])
    if next_status == "reported":
      next_status = "active"
    db.execute(
      """
      UPDATE portal_work_periods
      SET status = ?, tasks_json = ?, report_json = '{}', updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE portal_id = ? AND id = ?
      """,
      (
        next_status,
        json.dumps(next_tasks, ensure_ascii=False, separators=(",", ":")),
        user_login_value(user),
        portal_id,
        row["id"],
      ),
    )
    updated_row = db.execute(
      "SELECT * FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (portal_id, row["id"]),
    ).fetchone()
    if updated_row:
      updated_periods.append(public_portal_work_period(updated_row))
  return updated_periods


def sync_work_period_task_statuses_for_draft_in_db(db, portal_id, payload, previous_payload, user=None):
  meta = payload.get("meta") if isinstance(payload, dict) and isinstance(payload.get("meta"), dict) else {}
  previous_meta = previous_payload.get("meta") if isinstance(previous_payload, dict) and isinstance(previous_payload.get("meta"), dict) else {}
  batch = meta.get("batch") if isinstance(meta.get("batch"), dict) else {}
  previous_batch = previous_meta.get("batch") if isinstance(previous_meta.get("batch"), dict) else {}
  batch_id = str(batch.get("id") or previous_batch.get("id") or "").strip()[:120]
  if not batch_id:
    return []
  work_types = normalize_optional_work_types(batch.get("workTypes") or previous_batch.get("workTypes"))
  if not work_types:
    return []
  changed = False
  for work_type in work_types:
    if task_work_type_status(meta, work_type) != task_work_type_status(previous_meta, work_type):
      changed = True
      break
  if not changed:
    return []
  return sync_work_period_task_statuses_for_batch_in_db(db, portal_id, batch_id, user)


def normalize_work_period_tasks(value, fallback_default=True):
  raw_items = value if isinstance(value, list) else normalize_work_period_task_keys(value)
  tasks = []
  seen = set()
  for item in raw_items:
    if isinstance(item, dict):
      key = str(item.get("key") or "").strip().lower()
      raw_task = item
    else:
      key = str(item or "").strip().lower()
      raw_task = {}
    manual = False
    if key in WORK_PERIOD_TASK_LABELS:
      label = WORK_PERIOD_TASK_LABELS[key]
    else:
      key = clean_manual_work_period_task_key(key)
      label = clean_report_text(raw_task.get("label"), 180)
      manual = True
    if not key or not label or key in seen:
      continue
    seen.add(key)
    tasks.append({
      "key": key,
      "label": label,
      "manual": manual,
      "description": clean_work_period_note(raw_task.get("description"), 1600),
      "status": clean_work_period_task_status(raw_task.get("status")),
      "comment": clean_work_period_note(raw_task.get("comment")),
      "statusUpdatedAt": str(raw_task.get("statusUpdatedAt") or "")[:80],
      "statusUpdatedBy": str(raw_task.get("statusUpdatedBy") or "")[:120],
      "completedAt": str(raw_task.get("completedAt") or "")[:80],
      "completedBy": str(raw_task.get("completedBy") or "")[:120],
      "returnReason": clean_work_period_note(raw_task.get("returnReason")),
      "returnedAt": str(raw_task.get("returnedAt") or "")[:80],
      "returnedBy": str(raw_task.get("returnedBy") or "")[:120],
      "exclusionReason": clean_work_period_note(raw_task.get("exclusionReason")),
      "excludedAt": str(raw_task.get("excludedAt") or "")[:80],
      "excludedBy": str(raw_task.get("excludedBy") or "")[:120],
      "linkedTaskIds": clean_work_period_links(raw_task.get("linkedTaskIds")),
      "linkedBatchIds": clean_work_period_links(raw_task.get("linkedBatchIds")),
      "attachments": clean_work_period_attachments(raw_task.get("attachments")),
      "history": clean_work_period_history(raw_task.get("history")),
    })
  if not tasks and fallback_default:
    tasks = normalize_work_period_tasks(list(DEFAULT_WORK_PERIOD_TASK_KEYS), fallback_default=False)
  return tasks


def work_period_task_summary(tasks):
  clean_tasks = normalize_work_period_tasks(tasks)
  active_tasks = [task for task in clean_tasks if task["status"] != "excluded"]
  total = len(active_tasks)
  done = len([task for task in active_tasks if task["status"] == "done"])
  in_progress = len([task for task in active_tasks if task["status"] == "in_progress"])
  review = len([task for task in active_tasks if task["status"] == "review"])
  returned = len([task for task in active_tasks if task["status"] == "returned"])
  excluded = len([task for task in clean_tasks if task["status"] == "excluded"])
  planned = len([task for task in active_tasks if task["status"] == "planned"])
  return {
    "total": total,
    "done": done,
    "inProgress": in_progress,
    "review": review,
    "returned": returned,
    "excluded": excluded,
    "planned": planned,
    "progress": round(done / total * 100) if total else 0,
  }


def work_period_report_payload(period, tasks, user):
  clean_tasks = normalize_work_period_tasks(tasks)
  completed = []
  not_completed = []
  excluded = []
  for task in clean_tasks:
    payload = {
      "key": task["key"],
      "label": task["label"],
      "manual": bool(task.get("manual")),
      "description": task.get("description") or "",
      "status": task["status"],
      "comment": task.get("comment") or "",
      "statusUpdatedAt": task.get("statusUpdatedAt") or "",
      "statusUpdatedBy": task.get("statusUpdatedBy") or "",
      "completedAt": task.get("completedAt") or "",
      "completedBy": task.get("completedBy") or "",
      "returnReason": task.get("returnReason") or "",
      "returnedAt": task.get("returnedAt") or "",
      "returnedBy": task.get("returnedBy") or "",
      "exclusionReason": task.get("exclusionReason") or "",
      "excludedAt": task.get("excludedAt") or "",
      "excludedBy": task.get("excludedBy") or "",
      "linkedTaskIds": clean_work_period_links(task.get("linkedTaskIds")),
      "linkedBatchIds": clean_work_period_links(task.get("linkedBatchIds")),
      "attachments": clean_work_period_attachments(task.get("attachments")),
    }
    if task["status"] == "excluded":
      if not payload["exclusionReason"]:
        payload["exclusionReason"] = "исключено при корректировке плана"
      excluded.append(payload)
    elif task["status"] == "done":
      completed.append(payload)
    else:
      if not payload["returnReason"] and payload["comment"]:
        payload["returnReason"] = payload["comment"]
      if not payload["returnReason"]:
        payload["returnReason"] = {
          "in_progress": "в работе к моменту формирования отчета",
          "review": "на согласовании к моменту формирования отчета",
          "planned": "не начато к моменту формирования отчета",
        }.get(task["status"], "не выполнено к моменту формирования отчета")
      not_completed.append(payload)
  return {
    "generatedAt": utc_now().isoformat(),
    "generatedBy": user["login"],
    "period": {
      "start": period.get("start") or "",
      "end": period.get("end") or "",
    },
    "summary": work_period_task_summary(clean_tasks),
    "completed": completed,
    "notCompleted": not_completed,
    "excluded": excluded,
  }


def parse_work_period_json(value, fallback):
  try:
    parsed = json.loads(value or "")
  except (TypeError, json.JSONDecodeError):
    return fallback
  return parsed


def public_portal_work_period(row):
  tasks = normalize_work_period_tasks(parse_work_period_json(row["tasks_json"], []))
  report = parse_work_period_json(row["report_json"], {})
  if not isinstance(report, dict):
    report = {}
  return {
    "id": str(row["id"]),
    "portalId": str(row["portal_id"]),
    "title": row["title"] or "",
    "period": {
      "start": row["period_start"] or "",
      "end": row["period_end"] or "",
    },
    "status": clean_work_period_status(row["status"]),
    "tasks": tasks,
    "summary": work_period_task_summary(tasks),
    "report": report,
    "createdBy": row["created_by"] or "",
    "updatedBy": row["updated_by"] or "",
    "createdAt": row["created_at"] or "",
    "updatedAt": row["updated_at"] or "",
  }


def validate_work_period_dates(start, end):
  start = clean_report_date(start)
  end = clean_report_date(end)
  if not start or not end or start > end:
    raise ValueError("invalid_work_period")
  start_day = dt.date.fromisoformat(start)
  end_day = dt.date.fromisoformat(end)
  if (end_day - start_day).days > 370:
    raise ValueError("work_period_too_long")
  return start, end


def work_period_is_closed(end):
  end = clean_report_date(end)
  if not end:
    return False
  end_day = dt.date.fromisoformat(end)
  return utc_now().date() >= end_day


def ensure_work_period_link_target(portal_id, period_id, task_key):
  if not period_id and not task_key:
    return "", ""
  if not period_id or not task_key:
    raise ValueError("invalid_work_period_link")
  try:
    numeric_portal_id = int(portal_id)
    numeric_period_id = int(period_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_work_period") from exc
  clean_task_key = clean_work_period_task_key(task_key)
  if numeric_period_id <= 0 or not clean_task_key:
    raise ValueError("invalid_work_period_link")
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT tasks_json FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (numeric_portal_id, numeric_period_id),
    ).fetchone()
  if not row:
    raise ValueError("work_period_not_found")
  tasks = normalize_work_period_tasks(parse_work_period_json(row["tasks_json"], []))
  target = next((task for task in tasks if task["key"] == clean_task_key), None)
  if not target:
    raise ValueError("work_period_task_not_found")
  if target["status"] == "excluded":
    raise ValueError("work_period_task_excluded")
  return str(numeric_period_id), clean_task_key


def unlink_work_period_task_links_in_db(db, portal_id, linked_task_ids=None, linked_batch_ids=None, user=None, comment=""):
  linked_task_ids = clean_work_period_links(linked_task_ids)
  linked_batch_ids = clean_work_period_links(linked_batch_ids)
  if not linked_task_ids and not linked_batch_ids:
    return []
  now = utc_now().isoformat()
  user_login = user_login_value(user)
  clean_comment = clean_work_period_note(comment, 1000)
  rows = db.execute(
    """
    SELECT *
    FROM portal_work_periods
    WHERE portal_id = ? AND status != 'archived'
    ORDER BY period_start DESC, id DESC
    """,
    (portal_id,),
  ).fetchall()
  updated_periods = []
  for row in rows:
    tasks = normalize_work_period_tasks(parse_work_period_json(row["tasks_json"], []))
    next_tasks = []
    changed = False
    for task in tasks:
      current_task_ids = [item for item in clean_work_period_links(task.get("linkedTaskIds")) if item not in linked_task_ids]
      current_batch_ids = [
        item
        for item in clean_work_period_links(task.get("linkedBatchIds"))
        if item not in linked_batch_ids or work_period_task_ids_reference_batch(current_task_ids, item)
      ]
      if current_task_ids != clean_work_period_links(task.get("linkedTaskIds")) or current_batch_ids != clean_work_period_links(task.get("linkedBatchIds")):
        history = clean_work_period_history(task.get("history"))
        history.append({
          "action": "unlinked_task",
          "at": now,
          "by": user_login,
          "comment": clean_comment,
          "reason": ", ".join(linked_task_ids or linked_batch_ids)[:1000],
        })
        task = {
          **task,
          "linkedTaskIds": current_task_ids,
          "linkedBatchIds": current_batch_ids,
          "history": clean_work_period_history(history),
        }
        changed = True
      next_tasks.append(task)
    if not changed:
      continue
    next_status = clean_work_period_status(row["status"])
    if next_status == "reported":
      next_status = "active"
    db.execute(
      """
      UPDATE portal_work_periods
      SET status = ?, tasks_json = ?, report_json = '{}', updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE portal_id = ? AND id = ?
      """,
      (
        next_status,
        json.dumps(next_tasks, ensure_ascii=False, separators=(",", ":")),
        user_login,
        portal_id,
        row["id"],
      ),
    )
    updated_row = db.execute(
      "SELECT * FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (portal_id, row["id"]),
    ).fetchone()
    if updated_row:
      updated_periods.append(public_portal_work_period(updated_row))
  return updated_periods


def list_portal_work_periods(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    rows = db.execute(
      """
      SELECT *
      FROM portal_work_periods
      WHERE portal_id = ?
      ORDER BY period_start DESC, id DESC
      """,
      (numeric_portal_id,),
    ).fetchall()
  return {
    "portalId": str(numeric_portal_id),
    "periods": [public_portal_work_period(row) for row in rows],
  }


def create_portal_work_period(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  period = payload.get("period") if isinstance(payload.get("period"), dict) else {}
  start, end = validate_work_period_dates(period.get("start") or payload.get("start"), period.get("end") or payload.get("end"))
  title = clean_report_text(payload.get("title") or f"Рабочий период {start} - {end}", 180)
  if work_period_payload_has_tasks(payload):
    tasks = normalize_work_period_tasks(work_period_payload_task_items(payload, default_if_missing=False), fallback_default=False)
    if not tasks:
      raise ValueError("invalid_work_period_task")
  else:
    tasks = normalize_work_period_tasks(work_period_payload_task_items(payload, default_if_missing=True))
  init_db()
  with connect_db() as db:
    portal = db.execute("SELECT id, name FROM portals WHERE id = ?", (numeric_portal_id,)).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    cursor = db.execute(
      """
      INSERT INTO portal_work_periods (
        portal_id, title, period_start, period_end, status, tasks_json, report_json,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, 'active', ?, '{}', ?, ?)
      """,
      (
        numeric_portal_id,
        title,
        start,
        end,
        json.dumps(tasks, ensure_ascii=False, separators=(",", ":")),
        user["login"],
        user["login"],
      ),
    )
    row = db.execute(
      "SELECT * FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (numeric_portal_id, cursor.lastrowid),
    ).fetchone()
  record_admin_event(user, "portal_work_period_created", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "title": title,
    "period": f"{start} - {end}",
    "tasks": [task["key"] for task in tasks],
    "manualTasks": len([task for task in tasks if task.get("manual")]),
  })
  return public_portal_work_period(row)


def update_portal_work_period(portal_id, payload, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  payload = payload if isinstance(payload, dict) else {}
  try:
    period_id = int(payload.get("periodId") or payload.get("id") or 0)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_work_period") from exc
  if period_id <= 0:
    raise ValueError("invalid_work_period")
  action = str(payload.get("action") or "update").strip().lower()
  now = utc_now().isoformat()
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT * FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (numeric_portal_id, period_id),
    ).fetchone()
    if not row:
      raise ValueError("work_period_not_found")
    tasks = normalize_work_period_tasks(parse_work_period_json(row["tasks_json"], []))
    report = parse_work_period_json(row["report_json"], {})
    status = clean_work_period_status(row["status"])
    title = row["title"] or ""
    start = row["period_start"] or ""
    end = row["period_end"] or ""

    if action == "update":
      period = payload.get("period") if isinstance(payload.get("period"), dict) else {}
      next_start = period.get("start") or payload.get("start") or start
      next_end = period.get("end") or payload.get("end") or end
      start, end = validate_work_period_dates(next_start, next_end)
      title = clean_report_text(payload.get("title") or title or f"Рабочий период {start} - {end}", 180)
      if work_period_payload_has_tasks(payload):
        incoming_tasks = normalize_work_period_tasks(work_period_payload_task_items(payload, default_if_missing=False), fallback_default=False)
        if not incoming_tasks:
          raise ValueError("invalid_work_period_task")
        incoming_keys = [task["key"] for task in incoming_tasks]
        incoming_by_key = {task["key"]: task for task in incoming_tasks}
        task_by_key = {task["key"]: task for task in tasks}
        next_tasks = []
        for key in incoming_keys:
          incoming_task = incoming_by_key[key]
          task = task_by_key.get(key)
          if task:
            task = {
              **task,
              "label": incoming_task["label"],
              "manual": bool(incoming_task.get("manual")),
              "description": incoming_task.get("description") or "",
            }
            if task["status"] == "excluded":
              history = clean_work_period_history(task.get("history"))
              history.append({
                "action": "restored",
                "at": now,
                "by": user["login"],
                "comment": "",
                "reason": "",
              })
              task = {
                **task,
                "status": "planned",
                "exclusionReason": "",
                "excludedAt": "",
                "excludedBy": "",
                "history": clean_work_period_history(history),
              }
            next_tasks.append(task)
          else:
            task = incoming_task
            task["history"] = clean_work_period_history([{
              "action": "added",
              "at": now,
              "by": user["login"],
              "comment": "",
              "reason": "",
            }])
            next_tasks.append(task)
        exclusion_reason = clean_work_period_note(payload.get("exclusionReason")) or "исключено при корректировке плана"
        for task in tasks:
          if task["key"] in incoming_keys:
            continue
          history = clean_work_period_history(task.get("history"))
          history.append({
            "action": "excluded",
            "at": now,
            "by": user["login"],
            "comment": "",
            "reason": exclusion_reason,
          })
          next_tasks.append({
            **task,
            "status": "excluded",
            "exclusionReason": exclusion_reason,
            "excludedAt": now,
            "excludedBy": user["login"],
            "history": clean_work_period_history(history),
          })
        tasks = next_tasks
        report = {}
        if status == "reported":
          status = "active"
    elif action in {"complete_task", "return_task", "update_task_status"}:
      task_key = clean_work_period_task_key(payload.get("taskKey") or payload.get("task"))
      if not task_key:
        raise ValueError("invalid_work_period_task")
      comment = clean_work_period_note(payload.get("comment"))
      reason = clean_work_period_note(payload.get("reason") or payload.get("returnReason"))
      next_task_status = clean_work_period_task_status(payload.get("taskStatus") or payload.get("status"))
      if action == "update_task_status" and next_task_status in {"returned", "excluded"}:
        raise ValueError("invalid_work_period_task_status")
      next_tasks = []
      changed = False
      for task in tasks:
        if task["key"] != task_key:
          next_tasks.append(task)
          continue
        if task["status"] == "excluded":
          raise ValueError("work_period_task_excluded")
        changed = True
        history = clean_work_period_history(task.get("history"))
        if action in {"complete_task", "update_task_status"}:
          attachments = clean_work_period_attachments(payload.get("attachments")) if "attachments" in payload else clean_work_period_attachments(task.get("attachments"))
          attachments = [
            {
              **attachment,
              "uploadedAt": attachment.get("uploadedAt") or now,
              "uploadedBy": attachment.get("uploadedBy") or user["login"],
            }
            for attachment in attachments
          ]
          target_status = "done" if action == "complete_task" else next_task_status
          history.append({
            "action": "completed" if target_status == "done" else f"status:{target_status}",
            "at": now,
            "by": user["login"],
            "comment": comment,
            "reason": "",
          })
          completed_at = now if target_status == "done" else ""
          completed_by = user["login"] if target_status == "done" else ""
          task = {
            **task,
            "status": target_status,
            "comment": comment,
            "statusUpdatedAt": now,
            "statusUpdatedBy": user["login"],
            "completedAt": completed_at,
            "completedBy": completed_by,
            "returnReason": "",
            "returnedAt": "",
            "returnedBy": "",
            "attachments": attachments,
            "history": clean_work_period_history(history),
          }
        else:
          if not reason:
            raise ValueError("work_period_return_reason_required")
          history.append({
            "action": "returned",
            "at": now,
            "by": user["login"],
            "comment": "",
            "reason": reason,
          })
          task = {
            **task,
            "status": "returned",
            "returnReason": reason,
            "returnedAt": now,
            "returnedBy": user["login"],
            "history": clean_work_period_history(history),
          }
        next_tasks.append(task)
      if not changed:
        raise ValueError("work_period_task_not_found")
      tasks = next_tasks
      report = {}
      if status == "reported":
        status = "active"
    elif action == "link_task":
      task_key = clean_work_period_task_key(payload.get("taskKey") or payload.get("task"))
      if not task_key:
        raise ValueError("invalid_work_period_task")
      linked_task_ids = clean_work_period_links(payload.get("linkedTaskIds") or payload.get("taskIds"))
      linked_batch_ids = clean_work_period_links(payload.get("linkedBatchIds") or payload.get("batchIds"))
      if not linked_task_ids and not linked_batch_ids:
        raise ValueError("invalid_work_period_link")
      comment = clean_work_period_note(payload.get("comment"), 1000)
      next_tasks = []
      changed = False
      for task in tasks:
        current_task_ids = [item for item in clean_work_period_links(task.get("linkedTaskIds")) if item not in linked_task_ids]
        current_batch_ids = [
          item
          for item in clean_work_period_links(task.get("linkedBatchIds"))
          if item not in linked_batch_ids or work_period_task_ids_reference_batch(current_task_ids, item)
        ]
        if task["key"] != task_key:
          next_tasks.append({
            **task,
            "linkedTaskIds": current_task_ids,
            "linkedBatchIds": current_batch_ids,
          })
          continue
        if task["status"] == "excluded":
          raise ValueError("work_period_task_excluded")
        changed = True
        history = clean_work_period_history(task.get("history"))
        history.append({
          "action": "linked_task",
          "at": now,
          "by": user["login"],
          "comment": comment,
          "reason": ", ".join(linked_task_ids or linked_batch_ids)[:1000],
        })
        task_status = "in_progress" if task["status"] == "planned" else task["status"]
        next_tasks.append({
          **task,
          "status": task_status,
          "statusUpdatedAt": now if task_status != task["status"] else task.get("statusUpdatedAt", ""),
          "statusUpdatedBy": user["login"] if task_status != task["status"] else task.get("statusUpdatedBy", ""),
          "linkedTaskIds": clean_work_period_links([*current_task_ids, *linked_task_ids]),
          "linkedBatchIds": clean_work_period_links([*current_batch_ids, *linked_batch_ids]),
          "history": clean_work_period_history(history),
        })
      if not changed:
        raise ValueError("work_period_task_not_found")
      tasks = next_tasks
      report = {}
      if status == "reported":
        status = "active"
    elif action == "unlink_task":
      task_key = clean_work_period_task_key(payload.get("taskKey") or payload.get("task"))
      if not task_key:
        raise ValueError("invalid_work_period_task")
      linked_task_ids = clean_work_period_links(payload.get("linkedTaskIds") or payload.get("taskIds"))
      linked_batch_ids = clean_work_period_links(payload.get("linkedBatchIds") or payload.get("batchIds"))
      if not linked_task_ids and not linked_batch_ids:
        raise ValueError("invalid_work_period_link")
      comment = clean_work_period_note(payload.get("comment"), 1000)
      next_tasks = []
      changed = False
      for task in tasks:
        if task["key"] != task_key:
          next_tasks.append(task)
          continue
        current_task_ids = [item for item in clean_work_period_links(task.get("linkedTaskIds")) if item not in linked_task_ids]
        current_batch_ids = [
          item
          for item in clean_work_period_links(task.get("linkedBatchIds"))
          if item not in linked_batch_ids or work_period_task_ids_reference_batch(current_task_ids, item)
        ]
        if current_task_ids == clean_work_period_links(task.get("linkedTaskIds")) and current_batch_ids == clean_work_period_links(task.get("linkedBatchIds")):
          next_tasks.append(task)
          continue
        changed = True
        history = clean_work_period_history(task.get("history"))
        history.append({
          "action": "unlinked_task",
          "at": now,
          "by": user["login"],
          "comment": comment,
          "reason": ", ".join(linked_task_ids or linked_batch_ids)[:1000],
        })
        next_tasks.append({
          **task,
          "linkedTaskIds": current_task_ids,
          "linkedBatchIds": current_batch_ids,
          "history": clean_work_period_history(history),
        })
      if not changed:
        raise ValueError("work_period_link_not_found")
      tasks = next_tasks
      report = {}
      if status == "reported":
        status = "active"
    elif action == "generate_report":
      if not work_period_is_closed(end):
        raise ValueError("work_period_not_finished")
      report = work_period_report_payload({"start": start, "end": end}, tasks, user)
      status = "reported"
    else:
      raise ValueError("invalid_work_period_action")

    db.execute(
      """
      UPDATE portal_work_periods
      SET title = ?, period_start = ?, period_end = ?, status = ?,
          tasks_json = ?, report_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE portal_id = ? AND id = ?
      """,
      (
        title,
        start,
        end,
        status,
        json.dumps(tasks, ensure_ascii=False, separators=(",", ":")),
        json.dumps(report if isinstance(report, dict) else {}, ensure_ascii=False, separators=(",", ":")),
        user["login"],
        numeric_portal_id,
        period_id,
      ),
    )
    row = db.execute("SELECT * FROM portal_work_periods WHERE portal_id = ? AND id = ?", (numeric_portal_id, period_id)).fetchone()
  record_admin_event(user, f"portal_work_period_{action}", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "periodId": period_id,
    "title": title,
    "action": action,
  })
  return public_portal_work_period(row)


def save_portal_work_period(portal_id, payload, user):
  payload = payload if isinstance(payload, dict) else {}
  if payload.get("periodId") or payload.get("id"):
    return update_portal_work_period(portal_id, payload, user)
  return create_portal_work_period(portal_id, payload, user)


def delete_portal_work_period(portal_id, period_id, user):
  try:
    numeric_portal_id = int(portal_id)
    numeric_period_id = int(period_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_work_period") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT id, title FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (numeric_portal_id, numeric_period_id),
    ).fetchone()
    if not row:
      raise ValueError("work_period_not_found")
    db.execute(
      "DELETE FROM portal_work_periods WHERE portal_id = ? AND id = ?",
      (numeric_portal_id, numeric_period_id),
    )
  record_admin_event(user, "portal_work_period_deleted", "portal", numeric_portal_id, portal_id=numeric_portal_id, details={
    "periodId": numeric_period_id,
    "title": row["title"] if row else "",
  })
  return True


def approval_from_payload(payload):
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  approval = meta.get("approval") if isinstance(meta.get("approval"), dict) else {}
  return approval


def approval_sections_from_payload(payload):
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  sections = meta.get("approvalSections") if isinstance(meta.get("approvalSections"), dict) else {}
  return {
    key: value
    for key, value in sections.items()
    if key in APPROVAL_SECTION_LABELS and isinstance(value, dict)
  }


def approval_sections_for_comparison(payload):
  sections = approval_sections_from_payload(payload)
  if sections:
    return sections
  approval = approval_from_payload(payload)
  if not approval:
    return {}
  return {key: {**approval} for key in APPROVAL_SECTION_LABELS}


def approval_status_from_approval(approval):
  return str(approval.get("status") or "draft").strip() or "draft"


def approval_status_from_payload(payload):
  return approval_status_from_approval(approval_from_payload(payload))


def approval_event_from_approval(approval, user, nm_id="", vendor_code="", section_label=""):
  history = approval.get("history") if isinstance(approval.get("history"), list) else []
  latest = history[0] if history and isinstance(history[0], dict) else {}
  status = approval_status_from_approval(approval)
  event_at = (
    latest.get("createdAt")
    or (approval.get("reviewedAt") if status in {"approved", "changes_requested"} else "")
    or approval.get("submittedAt")
    or dt.datetime.now(dt.timezone.utc).isoformat()
  )
  reason = str(latest.get("reason") or approval.get("returnReason") or "")[:1000]
  if section_label:
    reason = f"{section_label}: {reason}"[:1000] if reason else section_label
  return {
    "status": status[:40],
    "action": str(latest.get("action") or status)[:40],
    "actorLogin": str(latest.get("userLogin") or user_login_value(user) or "")[:120],
    "assigneeLogin": str(approval.get("assigneeLogin") or "")[:120],
    "reason": reason,
    "eventAt": str(event_at)[:80],
    "nmID": str(nm_id or "")[:80],
    "vendorCode": str(vendor_code or "")[:120],
  }


def approval_event_from_payload(payload, user, nm_id="", vendor_code=""):
  return approval_event_from_approval(approval_from_payload(payload), user, nm_id, vendor_code)


def restricted_approval_changes(payload, previous_payload):
  restricted_statuses = {"approved", "changes_requested"}
  sections = approval_sections_from_payload(payload)
  if sections:
    previous_sections = approval_sections_for_comparison(previous_payload or {})
    changes = []
    for key, approval in sections.items():
      status = approval_status_from_approval(approval)
      previous_status = approval_status_from_approval(previous_sections.get(key, {}))
      if status in restricted_statuses and status != previous_status:
        changes.append(key)
    return changes
  status = approval_status_from_payload(payload)
  previous_status = approval_status_from_payload(previous_payload or {})
  return ["approval"] if status in restricted_statuses and status != previous_status else []


def approval_events_from_payload_change(payload, previous_payload, user, nm_id="", vendor_code=""):
  sections = approval_sections_from_payload(payload)
  if sections:
    previous_sections = approval_sections_for_comparison(previous_payload or {})
    events = []
    for key, approval in sections.items():
      status = approval_status_from_approval(approval)
      previous_status = approval_status_from_approval(previous_sections.get(key, {}))
      if status != "draft" and status != previous_status:
        events.append(approval_event_from_approval(
          approval,
          user,
          nm_id,
          vendor_code,
          APPROVAL_SECTION_LABELS.get(key, ""),
        ))
    return events
  approval_status = approval_status_from_payload(payload)
  previous_status = approval_status_from_payload(previous_payload or {})
  if approval_status != "draft" and approval_status != previous_status:
    return [approval_event_from_payload(payload, user, nm_id, vendor_code)]
  return []


def insert_card_approval_event(db, portal_id, card_key, event):
  db.execute(
    """
    INSERT INTO card_approval_events (
      portal_id, card_key, nm_id, vendor_code, status, action,
      actor_login, assignee_login, reason, event_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    (
      portal_id,
      card_key,
      event["nmID"],
      event["vendorCode"],
      event["status"],
      event["action"],
      event["actorLogin"],
      event["assigneeLogin"],
      event["reason"],
      event["eventAt"],
    ),
  )


def subject_ids_from_cards_snapshot(snapshot_json):
  try:
    cards = json.loads(snapshot_json or "[]")
  except json.JSONDecodeError:
    cards = []
  if not isinstance(cards, list):
    return []
  subject_ids = []
  for card in cards:
    if not isinstance(card, dict):
      continue
    subject_id = card.get("subjectID")
    raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
    subject_id = subject_id or raw_fields.get("subjectID")
    if subject_id:
      subject_ids.append(str(subject_id))
  return sorted(set(subject_ids))


def reset_portal_work_cache(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    portal = db.execute(
      "SELECT cards_snapshot_json FROM portals WHERE id = ?",
      (numeric_portal_id,),
    ).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    subject_ids = subject_ids_from_cards_snapshot(portal["cards_snapshot_json"])
    draft_cursor = db.execute(
      "DELETE FROM card_drafts WHERE portal_id = ?",
      (numeric_portal_id,),
    )
    workset_cursor = db.execute(
      "DELETE FROM portal_workset_cards WHERE portal_id = ?",
      (numeric_portal_id,),
    )
    approval_cursor = db.execute(
      "DELETE FROM card_approval_events WHERE portal_id = ?",
      (numeric_portal_id,),
    )
    mpstats_deleted = 0
    if subject_ids:
      placeholders = ",".join("?" for _ in subject_ids)
      mpstats_cursor = db.execute(
        f"""
        DELETE FROM mpstats_characteristics_cache
        WHERE report_type = 'subject' AND value IN ({placeholders})
        """,
        subject_ids,
      )
      mpstats_deleted = mpstats_cursor.rowcount
  return {
    "draftsDeleted": draft_cursor.rowcount,
    "worksetDeleted": workset_cursor.rowcount,
    "approvalEventsDeleted": approval_cursor.rowcount,
    "mpstatsDeleted": mpstats_deleted,
    "subjectIDs": subject_ids,
  }


def draft_has_audit_data(payload):
  if str(payload.get("auditStatus") or "") == "done":
    return True
  content = payload.get("content") if isinstance(payload.get("content"), dict) else {}
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  if isinstance(meta.get("auditHistory"), list) and meta["auditHistory"]:
    return True
  for field_name in ("title", "description"):
    field = content.get(field_name) if isinstance(content.get(field_name), dict) else {}
    if field.get("source") == "audit":
      return True
  characteristics = content.get("characteristics") if isinstance(content.get("characteristics"), dict) else {}
  return any(isinstance(item, dict) and item.get("source") == "audit" for item in characteristics.values())


def reset_portal_analysis_cache(portal_id, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  invalidated_at = utc_now().isoformat()
  drafts_updated = 0
  with connect_db() as db:
    portal = db.execute(
      "SELECT cards_snapshot_json FROM portals WHERE id = ?",
      (numeric_portal_id,),
    ).fetchone()
    if not portal:
      raise ValueError("portal_not_found")
    subject_ids = subject_ids_from_cards_snapshot(portal["cards_snapshot_json"])
    mpstats_deleted = 0
    if subject_ids:
      placeholders = ",".join("?" for _ in subject_ids)
      mpstats_cursor = db.execute(
        f"""
        DELETE FROM mpstats_characteristics_cache
        WHERE report_type = 'subject' AND value IN ({placeholders})
        """,
        subject_ids,
      )
      mpstats_deleted = mpstats_cursor.rowcount
    draft_rows = db.execute(
      """
      SELECT id, payload_json
      FROM card_drafts
      WHERE portal_id = ?
      """,
      (numeric_portal_id,),
    ).fetchall()
    for row in draft_rows:
      try:
        payload = json.loads(row["payload_json"])
      except (TypeError, json.JSONDecodeError):
        payload = normalize_card_draft_payload({})
      payload = normalize_card_draft_payload(payload)
      if not draft_has_audit_data(payload):
        continue
      meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
      meta = {
        **meta,
        "auditHistory": [],
        "auditInvalidatedAt": invalidated_at,
        "auditInvalidatedReason": "wb_snapshot_refresh",
      }
      payload["auditStatus"] = "stale"
      payload["meta"] = meta
      db.execute(
        """
        UPDATE card_drafts
        SET payload_json = ?, audit_status = 'stale', updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
          json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
          user["login"],
          row["id"],
        ),
      )
      drafts_updated += 1
  return {
    "draftsUpdated": drafts_updated,
    "mpstatsDeleted": mpstats_deleted,
    "subjectIDs": subject_ids,
    "auditInvalidatedAt": invalidated_at,
  }


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
  updated_work_periods = []
  with connect_db() as db:
    previous = db.execute(
      """
      SELECT payload_json
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
    previous_payload = normalize_card_draft_payload({})
    if previous:
      try:
        previous_payload = json.loads(previous["payload_json"])
      except (TypeError, json.JSONDecodeError):
        previous_payload = normalize_card_draft_payload({})
    previous_payload = normalize_card_draft_payload(previous_payload)
    normalized_payload = merge_card_draft_semantics(normalized_payload, previous_payload)
    normalized_payload = merge_card_draft_work_context(normalized_payload, previous_payload)
    payload_json = json.dumps(normalized_payload, ensure_ascii=False, separators=(",", ":"))
    if restricted_approval_changes(normalized_payload, previous_payload) and not user_can_review_portal_approval(user, numeric_portal_id):
      raise PermissionError("approval_forbidden")
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
    for event in approval_events_from_payload_change(normalized_payload, previous_payload, user, nm_id, vendor_code):
      insert_card_approval_event(
        db,
        numeric_portal_id,
        card_key,
        event,
      )
    updated_work_periods = sync_work_period_task_statuses_for_draft_in_db(
      db,
      numeric_portal_id,
      normalized_payload,
      previous_payload,
      user,
    )
  draft = get_card_draft(numeric_portal_id, card_key, user)
  if draft is not None:
    draft["_workPeriods"] = updated_work_periods
  return draft


def parse_competitor_nm_id(value):
  text = str(value or "").strip()
  if not text:
    return ""
  matches = re.findall(r"\d{6,12}", text)
  return matches[-1] if matches else ""


def wb_public_card_url(nm_id):
  nm_id = parse_competitor_nm_id(nm_id)
  return f"https://www.wildberries.ru/catalog/{nm_id}/detail.aspx" if nm_id else ""


def safe_json_object(value):
  if isinstance(value, dict):
    return value
  try:
    parsed = json.loads(value or "{}")
  except (TypeError, json.JSONDecodeError):
    return {}
  return parsed if isinstance(parsed, dict) else {}


def safe_json_list(value):
  if isinstance(value, list):
    return value
  try:
    parsed = json.loads(value or "[]")
  except (TypeError, json.JSONDecodeError):
    return []
  return parsed if isinstance(parsed, list) else []


def parse_iso_datetime(value):
  text = audit_str(value)
  if not text:
    return None
  try:
    parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
  except ValueError:
    return None
  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=dt.timezone.utc)
  return parsed.astimezone(dt.timezone.utc)


def wb_public_price(value):
  try:
    number = float(value)
  except (TypeError, ValueError):
    return None
  if number <= 0:
    return None
  return round(number / 100, 2) if number > 10000 else round(number, 2)


def wb_public_product_price(product, keys):
  if not isinstance(product, dict):
    return None
  for key in keys:
    value = product.get(key)
    price = wb_public_price(value)
    if price is not None:
      return price
  for size in product.get("sizes") or []:
    if not isinstance(size, dict):
      continue
    price_meta = size.get("price") if isinstance(size.get("price"), dict) else {}
    for key in keys:
      price = wb_public_price(size.get(key) or price_meta.get(key))
      if price is not None:
        return price
  return None


def fetch_wb_public_product(nm_id, warnings):
  nm_id = parse_competitor_nm_id(nm_id)
  if not nm_id:
    return {}
  params = urlencode({
    "appType": "1",
    "curr": "rub",
    "dest": "-1257786",
    "spp": "30",
    "nm": nm_id,
  })
  last_error = ""
  for version in ("v4", "v2"):
    url = f"https://card.wb.ru/cards/{version}/detail?{params}"
    try:
      request = urlrequest.Request(url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 OptiCards/0.1 competitors-wb-public"})
      with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
        payload = json.loads(response.read().decode("utf-8"))
    except (urlerror.HTTPError, urlerror.URLError, TimeoutError, json.JSONDecodeError) as exc:
      last_error = f"{type(exc).__name__}{f' {exc.code}' if isinstance(exc, urlerror.HTTPError) else ''}"
      continue
    data = payload.get("data") if isinstance(payload, dict) else {}
    products = payload.get("products") if isinstance(payload, dict) else []
    if not isinstance(products, list) or not products:
      products = data.get("products") if isinstance(data, dict) else []
    if isinstance(products, list) and products:
      product = products[0]
      return product if isinstance(product, dict) else {}
  warnings.append(f"WB public detail недоступен для {nm_id}: {last_error or 'empty response'}")
  return {}


def wb_public_basket_guess(nm_int):
  vol = nm_int // 100000
  basket_limits = (
    143, 287, 431, 719, 1007, 1061, 1115, 1169, 1313, 1601,
    1655, 1919, 2045, 2189, 2405, 2621, 2837, 3053, 3269, 3485,
    3701, 3917, 4133, 4349, 4565, 4781, 5183, 5501, 5797, 6235,
    6553, 6861, 7205, 7597, 8081, 8533, 9017, 9437, 9885, 10293,
    10709, 11157, 11621, 12093, 12597, 13045, 13505, 13969, 14457,
    14941, 15421, 15881, 16369, 16853, 17333, 17817, 18297, 18777,
    19257,
  )
  for index, limit in enumerate(basket_limits, start=1):
    if vol <= limit:
      return index
  return len(basket_limits)


def wb_public_basket_candidates(nm_int):
  guess = wb_public_basket_guess(nm_int)
  cached = WB_PUBLIC_BASKET_CACHE.get(str(nm_int))
  candidates = [cached] if cached else []
  if guess not in candidates:
    candidates.append(guess)
  scan = range(max(1, guess - 2), min(80, guess + 3))
  for basket in scan:
    if basket not in candidates:
      candidates.append(basket)
  if guess >= 27:
    return candidates
  scan = range(1, 61)
  for basket in scan:
    if basket not in candidates:
      candidates.append(basket)
  return candidates


def wb_public_resource_exists(url):
  try:
    request = urlrequest.Request(url, method="HEAD", headers={"Accept": "*/*", "User-Agent": "Mozilla/5.0 OptiCards/0.1 wb-public"})
    with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
      return 200 <= response.status < 400
  except (urlerror.HTTPError, urlerror.URLError, TimeoutError):
    return False


def wb_public_resolve_basket(nm_id):
  nm_id = parse_competitor_nm_id(nm_id)
  if not nm_id:
    return None
  try:
    nm_int = int(nm_id)
  except ValueError:
    return None
  if nm_id in WB_PUBLIC_BASKET_CACHE:
    return WB_PUBLIC_BASKET_CACHE[nm_id]
  vol = nm_int // 100000
  part = nm_int // 1000
  for basket in wb_public_basket_candidates(nm_int):
    url = f"https://basket-{basket:02d}.wbbasket.ru/vol{vol}/part{part}/{nm_int}/info/ru/card.json"
    if wb_public_resource_exists(url):
      WB_PUBLIC_BASKET_CACHE[nm_id] = basket
      return basket
  basket = wb_public_basket_guess(nm_int)
  WB_PUBLIC_BASKET_CACHE[nm_id] = basket
  return basket


def wb_public_image_urls(nm_id, image_number=1):
  nm_id = parse_competitor_nm_id(nm_id)
  if not nm_id:
    return []
  try:
    nm_int = int(nm_id)
    image_number = max(1, int(image_number or 1))
  except ValueError:
    return []
  vol = nm_int // 100000
  part = nm_int // 1000
  basket = wb_public_resolve_basket(nm_id)
  if not basket:
    return []
  base = f"https://basket-{basket:02d}.wbbasket.ru/vol{vol}/part{part}/{nm_int}/images"
  return [
    f"{base}/big/{image_number}.webp",
    f"{base}/c516x688/{image_number}.webp",
    f"{base}/c246x328/{image_number}.webp",
  ]


def wb_public_photo_rows(nm_id, pics=1):
  count = audit_int(pics, 1)
  if count <= 0:
    count = 1
  output = []
  for image_number in range(1, min(count, 30) + 1):
    image_urls = wb_public_image_urls(nm_id, image_number)
    if len(image_urls) >= 3:
      output.append({"big": image_urls[0], "c516x688": image_urls[1], "c246x328": image_urls[2]})
  return output


def wb_public_seller_ids_from_manual_source(name, store_url, manual_source, limit=5):
  text = mpstats_manual_source_text(name, store_url, manual_source)
  output = []
  seen = set()
  for raw_url in re.findall(r"https?://[^\s,;]+", text):
    parsed = urlparse(raw_url)
    path_parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(path_parts):
      normalized_part = audit_normalized(part)
      next_part = path_parts[index + 1] if index + 1 < len(path_parts) else ""
      if normalized_part in {"seller", "sellers", "supplier", "suppliers"}:
        seller_id = parse_wb_seller_id(next_part)
        if seller_id and seller_id not in seen:
          seen.add(seller_id)
          output.append(seller_id)
          if len(output) >= limit:
            return output
    query = parse_qs(parsed.query)
    for key in ("seller", "supplier", "supplier_id", "supplierId"):
      for value in query.get(key, []):
        seller_id = parse_wb_seller_id(value)
        if seller_id and seller_id not in seen:
          seen.add(seller_id)
          output.append(seller_id)
          if len(output) >= limit:
            return output
  return output


def parse_wb_seller_id(value):
  text = str(value or "").strip()
  if not text:
    return ""
  matches = re.findall(r"\d{3,12}", text)
  return matches[-1] if matches else ""


def wb_public_catalog_characteristics(product):
  rows = []
  colors = product.get("colors") if isinstance(product, dict) and isinstance(product.get("colors"), list) else []
  color_names = audit_unique(
    color.get("name") if isinstance(color, dict) else color
    for color in colors
  )
  if color_names:
    rows.append({"name": "Цвет", "value": ", ".join(color_names)})
  return rows


def wb_public_catalog_raw_card(product, source="wb-public-seller"):
  if not isinstance(product, dict):
    return None
  nm_id = parse_competitor_nm_id(product.get("id") or product.get("nmID") or product.get("nmId"))
  if not nm_id:
    return None
  price = wb_public_product_price(product, ("priceU", "price", "basicPriceU", "basic", "total"))
  discounted_price = wb_public_product_price(product, ("salePriceU", "salePrice", "clientSalePriceU", "product", "total")) or price
  photos = wb_public_photo_rows(nm_id, product.get("pics") or product.get("photosCount") or 1)
  stock = audit_number(product.get("totalQuantity") or product.get("volume"), None)
  sizes = []
  if price is not None or discounted_price is not None or stock is not None:
    sizes.append({
      "techSize": "единый",
      "price": price,
      "discountedPrice": discounted_price,
      "stock": stock,
      "sellerStock": None,
      "wbStock": stock,
      "skus": [],
    })
  return {
    "nmID": nm_id,
    "imtID": product.get("root") or product.get("rootId") or "",
    "vendorCode": product.get("supplierArticle") or product.get("vendorCode") or "",
    "title": audit_str(product.get("name") or f"WB {nm_id}"),
    "description": "",
    "brand": audit_named_value(product.get("brand") or ""),
    "sellerName": audit_named_value(product.get("supplier") or product.get("supplierName") or ""),
    "subjectID": product.get("subjectId") or product.get("subjectID"),
    "subjectName": audit_str(product.get("entity") or product.get("subjectName") or product.get("subject") or "категория не указана"),
    "photos": photos,
    "photosCount": product.get("pics") or product.get("photosCount") or len(photos),
    "photoUrl": first_photo_url({"photos": photos}),
    "characteristics": wb_public_catalog_characteristics(product),
    "sizes": sizes,
    "price": price,
    "discountedPrice": discounted_price,
    "discount": product.get("sale") or product.get("clientSale"),
    "stock": stock,
    "sellerStock": None,
    "wbStock": stock,
    "rating": audit_number(product.get("reviewRating") or product.get("rating"), None),
    "feedbacks": audit_int(product.get("feedbacks") or product.get("comments"), 0),
    "createdAt": "",
    "updatedAt": utc_now().isoformat(),
    "mpstats": {
      "source": source,
      "supplierId": product.get("supplierId") or product.get("supplier_id"),
      "url": wb_public_card_url(nm_id),
    },
  }


def fetch_wb_public_seller_catalog(seller_id, limit=100, warnings=None, skip_keys=None, start_page=1):
  seller_id = parse_wb_seller_id(seller_id)
  if not seller_id:
    return []
  warnings = warnings if isinstance(warnings, list) else []
  skip_keys = set(skip_keys or [])
  limit = max(1, min(int(limit or 100), 1000))
  rows = []
  page = max(1, int(start_page or 1))
  page_budget = max(10, min(60, (limit // 100) + 8))
  max_page = page + page_budget - 1
  while len(rows) < limit and page <= max_page:
    params = urlencode({
      "appType": "1",
      "curr": "rub",
      "dest": "-1257786",
      "lang": "ru",
      "page": page,
      "sort": "popular",
      "spp": "30",
      "supplier": seller_id,
    })
    url = f"https://catalog.wb.ru/sellers/v4/catalog?{params}"
    payload = None
    for attempt in range(3):
      try:
        request = urlrequest.Request(url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 OptiCards/0.1 seller-bootstrap"})
        with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
          payload = json.loads(response.read().decode("utf-8"))
        break
      except urlerror.HTTPError as exc:
        retry_after = parse_retry_after(exc.headers.get("Retry-After"))
        if exc.code == 429 and attempt < 2:
          time.sleep(min(retry_after if retry_after is not None else 3 * (attempt + 1), 20))
          continue
        warnings.append(f"WB seller catalog {seller_id}: HTTP {exc.code}")
        return rows
      except (urlerror.URLError, TimeoutError, json.JSONDecodeError) as exc:
        warnings.append(f"WB seller catalog {seller_id}: {type(exc).__name__}")
        return rows
    if payload is None:
      break
    data = payload.get("data") if isinstance(payload, dict) else {}
    products = payload.get("products") if isinstance(payload, dict) else []
    if not isinstance(products, list) or not products:
      products = data.get("products") if isinstance(data, dict) else []
    if not products:
      total_count = audit_int(
        payload.get("total")
        or payload.get("totalCount")
        or (data.get("total") if isinstance(data, dict) else 0)
        or (data.get("totalCount") if isinstance(data, dict) else 0),
        0,
      )
      if total_count > (page - 1) * 100:
        warnings.append(f"WB seller catalog {seller_id}: empty page {page} before total {total_count}")
      break
    for product in products:
      nm_id = parse_competitor_nm_id(product.get("id") or product.get("nmID") or product.get("nmId"))
      if nm_id and draft_card_key(nm_id) in skip_keys:
        continue
      raw_card = wb_public_catalog_raw_card(product)
      key = raw_storefront_card_key(raw_card)
      if raw_card and key not in skip_keys:
        skip_keys.add(key)
        rows.append(raw_card)
        if len(rows) >= limit:
          break
    page += 1
    if len(rows) < limit:
      time.sleep(0.35)
  return rows


def competitor_text_digest(value):
  text = audit_normalized(value)
  return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""


def competitor_characteristic_value_text(row):
  values = row.get("values") if isinstance(row, dict) else []
  if not isinstance(values, list):
    values = [values]
  text = ", ".join(audit_str(value) for value in values if audit_str(value))
  unit = audit_str(row.get("unitName") if isinstance(row, dict) else "")
  return f"{text} {unit}".strip() if text and unit else text


def competitor_characteristic_public(row):
  return {
    "key": audit_str(row.get("key") or f"charc-name:{audit_normalized(row.get('name'))}"),
    "name": audit_str(row.get("name") or "Характеристика"),
    "value": competitor_characteristic_value_text(row),
  }


COMPETITOR_IGNORED_CHARACTERISTIC_NAMES = {
  "основная информация",
  "дополнительная информация",
  "документы проверены",
  "тнвэд",
  "декларация соответствия",
  "сертификат соответствия",
}


def competitor_characteristic_rows(characteristics):
  rows = []
  for row in audit_card_characteristics({"characteristics": characteristics}):
    public_row = competitor_characteristic_public(row)
    normalized_name = audit_normalized(public_row.get("name"))
    normalized_value = audit_normalized(public_row.get("value"))
    if not normalized_name or not normalized_value:
      continue
    if normalized_name in COMPETITOR_IGNORED_CHARACTERISTIC_NAMES:
      continue
    if normalized_name in {"основная информация", "дополнительная информация"} and normalized_name == normalized_value:
      continue
    rows.append(public_row)
  return rows


def competitor_characteristic_signature(characteristics):
  return "|".join(
    f"{audit_normalized(row.get('name'))}={audit_normalized(row.get('value'))}"
    for row in competitor_characteristic_rows(characteristics)[:80]
  )


def competitor_characteristic_map(characteristics):
  output = {}
  for row in competitor_characteristic_rows(characteristics):
    key = row.get("key") or f"charc-name:{audit_normalized(row.get('name'))}"
    output[key] = row
  return output


def competitor_characteristics_diff(previous_characteristics, current_characteristics, limit=6):
  previous_map = competitor_characteristic_map(previous_characteristics)
  current_map = competitor_characteristic_map(current_characteristics)
  added = [current_map[key] for key in current_map.keys() - previous_map.keys()]
  removed = [previous_map[key] for key in previous_map.keys() - current_map.keys()]
  changed = []
  for key in previous_map.keys() & current_map.keys():
    before = previous_map[key]
    after = current_map[key]
    if audit_normalized(before.get("value")) != audit_normalized(after.get("value")):
      changed.append({
        "name": after.get("name") or before.get("name"),
        "previous": before.get("value"),
        "current": after.get("value"),
      })
  summary_parts = []
  if changed:
    item = changed[0]
    summary_parts.append(f"{item['name']}: было {item['previous'] or 'пусто'}, стало {item['current'] or 'пусто'}")
  if added:
    item = added[0]
    summary_parts.append(f"добавили {item['name']}: {item['value']}")
  if removed:
    item = removed[0]
    summary_parts.append(f"убрали {item['name']}: {item['value']}")
  return {
    "added": added[:limit],
    "removed": removed[:limit],
    "changed": changed[:limit],
    "addedCount": len(added),
    "removedCount": len(removed),
    "changedCount": len(changed),
    "summary": "; ".join(summary_parts),
  }


def competitor_characteristics_comparison(current_characteristics, competitor_characteristics, limit=6):
  current_map = competitor_characteristic_map(current_characteristics)
  competitor_map = competitor_characteristic_map(competitor_characteristics)
  same = []
  different = []
  for key in current_map.keys() & competitor_map.keys():
    current = current_map[key]
    competitor = competitor_map[key]
    row = {
      "name": competitor.get("name") or current.get("name"),
      "current": current.get("value"),
      "competitor": competitor.get("value"),
    }
    if audit_normalized(current.get("value")) == audit_normalized(competitor.get("value")):
      same.append(row)
    else:
      different.append(row)
  only_competitor = [competitor_map[key] for key in competitor_map.keys() - current_map.keys()]
  only_current = [current_map[key] for key in current_map.keys() - competitor_map.keys()]
  return {
    "same": same[:limit],
    "different": different[:limit],
    "onlyCompetitor": only_competitor[:limit],
    "onlyCurrent": only_current[:limit],
    "sameCount": len(same),
    "differentCount": len(different),
    "onlyCompetitorCount": len(only_competitor),
    "onlyCurrentCount": len(only_current),
  }


def competitor_snapshot_from_sources(nm_id):
  nm_id = parse_competitor_nm_id(nm_id)
  warnings = []
  product = fetch_wb_public_product(nm_id, warnings)
  cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  info = {}
  full_payload = {}
  legacy_item_payload = {}
  legacy_item = {}
  legacy_full_payload = {}
  version_snapshot = {}
  version_rows = []
  if token:
    period = audit_period_default()
    info = audit_mpstats_get(token, f"/analytics/v1/wb/items/{nm_id}", warnings, cache_ttl=86400)
    full_payload = audit_mpstats_get(
      token,
      f"/analytics/v1/wb/items/{nm_id}/full?{urlencode({'d1': period['d1'], 'd2': period['d2']})}",
      warnings,
      cache_ttl=86400,
    )
    legacy_item_payload = audit_mpstats_get(token, f"/wb/get/item/{nm_id}", warnings, cache_ttl=86400)
    legacy_item = legacy_item_payload.get("item") if isinstance(legacy_item_payload.get("item"), dict) else {}
    legacy_full_payload = audit_mpstats_get(
      token,
      f"/wb/get/item/{nm_id}/full?{urlencode({'d1': period['d1'], 'd2': period['d2']})}",
      warnings,
      cache_ttl=86400,
    )
    version_snapshot, version_rows = audit_mpstats_latest_full_page_snapshot(token, nm_id, warnings, cache_ttl=86400)
    photo_history = audit_mpstats_photo_history(token, nm_id, [], cache_ttl=86400)
  else:
    photo_history = []
  stats = full_payload.get("period_stats") if isinstance(full_payload, dict) else {}
  if not isinstance(stats, dict):
    stats = {}
  mpstats_prices = mpstats_price_metrics(info, full_payload, stats, legacy_item_payload, legacy_item, legacy_full_payload)
  photo_block = full_payload.get("photo") if isinstance(full_payload.get("photo"), dict) else {}
  merged = audit_merge_card_content({}, cdn_card)
  title = audit_str(product.get("name") or version_snapshot.get("title") or merged.get("title") or legacy_item.get("full_name") or legacy_item.get("name") or info.get("name") or full_payload.get("name") or "")
  brand = audit_named_value(product.get("brand") or version_snapshot.get("brand") or merged.get("brand") or legacy_item.get("brand") or legacy_full_payload.get("brand") or info.get("brand") or full_payload.get("brand") or "")
  subject = audit_str(product.get("subjectName") or product.get("entity") or merged.get("subjectName") or audit_subject_name_from_payload(legacy_full_payload) or audit_subject_name_from_payload(full_payload) or audit_subject_name_from_payload(info) or "")
  fallback_description = audit_str(merged.get("description") or "")
  description_length = version_snapshot.get("descriptionLength") or len(fallback_description)
  description_preview = version_snapshot.get("descriptionPreview") or audit_str(fallback_description, 420)
  description_hash = version_snapshot.get("descriptionHash") or competitor_text_digest(fallback_description)
  characteristics = version_snapshot.get("characteristics") or audit_card_characteristics(merged)
  price = wb_public_product_price(product, ("priceU", "price", "basicPriceU", "basic", "total"))
  if price is None:
    price = audit_positive_number(mpstats_prices.get("price"), mpstats_prices.get("discountedPrice"), mpstats_prices.get("avgSalePrice"))
  extended = product.get("extended") if isinstance(product.get("extended"), dict) else {}
  discounted_price = wb_public_product_price(product, ("salePriceU", "salePrice", "clientSalePriceU", "product", "total"))
  if discounted_price is None:
    discounted_price = wb_public_price(extended.get("clientPriceU"))
  if discounted_price is None:
    discounted_price = audit_positive_number(mpstats_prices.get("discountedPrice"), mpstats_prices.get("walletPrice"), mpstats_prices.get("avgSalePrice"))
  if discounted_price is None:
    discounted_price = price
  mpstats_filled = bool(info or full_payload or legacy_item_payload or legacy_full_payload or version_snapshot)
  warning_list = audit_public_warnings(warnings)
  if mpstats_filled and (title or price or discounted_price):
    warning_list = [item for item in warning_list if "WB public detail недоступен" not in item]
  signals = []
  if audit_int(stats.get("sales"), 0):
    signals.append("есть продажи MPStats")
  if audit_number(stats.get("revenue"), 0):
    signals.append("есть выручка MPStats")
  if discounted_price:
    signals.append("цена получена")
  if description_length > 0:
    signals.append("описание доступно")
  snapshot = {
    "nmID": parse_competitor_nm_id(nm_id),
    "url": wb_public_card_url(nm_id),
    "title": title,
    "brand": brand,
    "subjectName": subject,
    "price": price,
    "discountedPrice": discounted_price,
    "walletPrice": mpstats_prices.get("walletPrice"),
    "avgSalePrice": mpstats_prices.get("avgSalePrice"),
    "discount": product.get("sale") or product.get("clientSale") or None,
    "rating": product.get("reviewRating") or product.get("rating") or legacy_item.get("rating") or legacy_full_payload.get("rating") or info.get("rating") or None,
    "feedbacks": product.get("feedbacks") or product.get("comments") or legacy_item.get("comments") or legacy_full_payload.get("comments") or info.get("comments") or None,
    "sales": audit_int(stats.get("sales"), 0),
    "salesPerDay": audit_number(stats.get("sales_per_day") or stats.get("salesPerDay"), 0),
    "revenue": audit_number(stats.get("revenue"), 0),
    "balance": audit_number(stats.get("balance"), 0),
    "photosCount": product.get("pics") or product.get("photosCount") or version_snapshot.get("photosCount") or audit_int(photo_block.get("count"), 0) or None,
    "photoChangedByMpstats": bool(photo_block.get("is_changed")),
    "photoHistory": photo_history,
    "lastPhotoChangedAt": photo_history[0].get("changedAt") if photo_history else "",
    "mpstatsVersion": version_snapshot.get("version") or "",
    "mpstatsVersionAt": version_snapshot.get("changedAt") or "",
    "mpstatsVersions": version_rows[:8],
    "mpstatsUpdatedAt": mpstats_date_iso(legacy_item.get("updated") or legacy_full_payload.get("updated")),
    "descriptionLength": description_length,
    "descriptionPreview": description_preview,
    "descriptionHash": description_hash,
    "characteristicsCount": len(characteristics),
    "characteristics": characteristics[:40],
    "characteristicsSignature": competitor_characteristic_signature(characteristics),
    "source": "mpstats" if mpstats_filled else "wb_public",
    "signals": audit_unique(signals, limit=8),
    "checkedAt": utc_now().isoformat(),
    "warnings": warning_list,
  }
  return snapshot


def competitor_snapshot_value(snapshot, key):
  value = snapshot.get(key) if isinstance(snapshot, dict) else None
  if key in {"discountedPrice", "price"}:
    number = audit_number(value, None)
    return str(number) if number and number > 0 else ""
  if value is None:
    return ""
  return str(value)


def competitor_subject_leaf(value):
  return audit_normalized(str(value or "").split("/")[-1].strip())


def competitor_snapshot_values_equal(previous, current, key):
  if key == "subjectName":
    return competitor_subject_leaf(previous.get(key)) == competitor_subject_leaf(current.get(key))
  if key in {"discountedPrice", "price"}:
    return competitor_snapshot_value(previous, key) == competitor_snapshot_value(current, key)
  if key == "descriptionHash":
    previous_hash = audit_str(previous.get("descriptionHash") or competitor_text_digest(previous.get("descriptionPreview") or ""))
    current_hash = audit_str(current.get("descriptionHash") or competitor_text_digest(current.get("descriptionPreview") or ""))
    return previous_hash == current_hash
  return competitor_snapshot_value(previous, key) == competitor_snapshot_value(current, key)


def competitor_snapshot_changes(previous, current):
  previous = previous if isinstance(previous, dict) else {}
  current = current if isinstance(current, dict) else {}
  if not previous:
    return []
  content_detected_at = audit_str(current.get("mpstatsVersionAt") or "")
  price_detected_at = audit_str(current.get("mpstatsUpdatedAt") or "")
  fields = [
    ("title", "Заголовок"),
    ("brand", "Бренд"),
    ("subjectName", "Категория"),
    ("discountedPrice", "Цена со скидкой"),
    ("price", "Цена до скидки"),
    ("descriptionHash", "Описание"),
  ]
  changes = []
  for key, label in fields:
    if competitor_snapshot_values_equal(previous, current, key):
      continue
    before = competitor_snapshot_value(previous, key)
    after = competitor_snapshot_value(current, key)
    change = {
      "field": key,
      "label": label,
      "previous": previous.get(key),
      "current": current.get(key),
      "critical": key in {"title", "discountedPrice", "descriptionHash"},
    }
    if key == "descriptionHash":
      change["previous"] = previous.get("descriptionPreview") or f"{audit_int(previous.get('descriptionLength'), 0)} зн."
      change["current"] = current.get("descriptionPreview") or f"{audit_int(current.get('descriptionLength'), 0)} зн."
      change["summary"] = (
        "изменили описание: "
        f"было {audit_int(previous.get('descriptionLength'), 0)} зн., стало {audit_int(current.get('descriptionLength'), 0)} зн."
      )
      if content_detected_at:
        change["detectedAt"] = content_detected_at
        change["detectedBy"] = "mpstats"
    if key == "discountedPrice":
      old_price = audit_number(previous.get(key), None)
      new_price = audit_number(current.get(key), None)
      if old_price and new_price:
        change["deltaPercent"] = round((new_price - old_price) / old_price * 100, 1)
        change["critical"] = new_price < old_price * 0.97
      if price_detected_at:
        change["detectedAt"] = price_detected_at
        change["detectedBy"] = "mpstats"
    if key == "title" and content_detected_at:
      change["detectedAt"] = content_detected_at
      change["detectedBy"] = "mpstats"
    changes.append(change)
  characteristics_diff = competitor_characteristics_diff(
    previous.get("characteristics") or [],
    current.get("characteristics") or [],
  )
  if characteristics_diff["addedCount"] or characteristics_diff["removedCount"] or characteristics_diff["changedCount"]:
    changes.append({
      "field": "characteristics",
      "label": "Характеристики",
      "previous": previous.get("characteristics") or [],
      "current": current.get("characteristics") or [],
      "critical": True,
      "details": characteristics_diff,
      "detectedAt": content_detected_at,
      "detectedBy": "mpstats" if content_detected_at else "",
      "summary": characteristics_diff.get("summary") or (
        f"изменили характеристики: значений {characteristics_diff['changedCount']}, "
        f"добавлено {characteristics_diff['addedCount']}, убрано {characteristics_diff['removedCount']}"
      ),
    })
  return changes[:12]


def competitor_next_auto_check_at(base_value=None):
  base_dt = parse_iso_datetime(base_value) or utc_now()
  return (base_dt + dt.timedelta(days=CARD_COMPETITOR_AUTO_CHECK_DAYS)).isoformat()


def competitor_row_due_at(row):
  next_at = parse_iso_datetime(row["next_auto_check_at"] if row and "next_auto_check_at" in row.keys() else "")
  if next_at:
    return next_at
  base_at = parse_iso_datetime(row["last_checked_at"] if row and "last_checked_at" in row.keys() else "")
  if not base_at:
    base_at = parse_iso_datetime(row["created_at"] if row and "created_at" in row.keys() else "")
  if not base_at:
    return utc_now() + dt.timedelta(days=CARD_COMPETITOR_AUTO_CHECK_DAYS)
  return base_at + dt.timedelta(days=CARD_COMPETITOR_AUTO_CHECK_DAYS)


def competitor_row_due_for_auto_check(row, now=None):
  now = now or utc_now()
  return competitor_row_due_at(row) <= now


def competitor_is_service_characteristic(item):
  if not isinstance(item, dict):
    return False
  name = audit_normalized(item.get("name") or "")
  if name in {"документы проверены", "тнвэд", "декларация соответствия", "сертификат соответствия"}:
    return True
  if name not in {"основная информация", "дополнительная информация"}:
    return False
  values = [
    item.get("value"),
    item.get("previous"),
    item.get("current"),
    item.get("competitor"),
  ]
  return any(audit_normalized(value) == name for value in values)


def competitor_actionable_characteristics_details(details):
  details = details if isinstance(details, dict) else {}
  cleaned = {
    **details,
    "changed": [item for item in details.get("changed", []) if not competitor_is_service_characteristic(item)],
    "added": [item for item in details.get("added", []) if not competitor_is_service_characteristic(item)],
    "removed": [item for item in details.get("removed", []) if not competitor_is_service_characteristic(item)],
  }
  cleaned["changedCount"] = len(cleaned["changed"])
  cleaned["addedCount"] = len(cleaned["added"])
  cleaned["removedCount"] = len(cleaned["removed"])
  return cleaned


def competitor_actionable_changes(changes):
  output = []
  for change in changes if isinstance(changes, list) else []:
    if not isinstance(change, dict):
      continue
    if change.get("field") != "characteristics":
      output.append(change)
      continue
    cleaned_details = competitor_actionable_characteristics_details(change.get("details"))
    if cleaned_details["changedCount"] or cleaned_details["addedCount"] or cleaned_details["removedCount"]:
      output.append({
        **change,
        "details": cleaned_details,
      })
  return output[:12]


def competitor_change_hash(changes):
  actionable = competitor_actionable_changes(changes)
  if not actionable:
    return ""
  normalized = json.dumps(actionable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
  return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def competitor_characteristic_change_summary(details):
  details = details if isinstance(details, dict) else {}
  lines = []
  for item in details.get("changed", [])[:3]:
    lines.append(f"{item.get('name') or 'Характеристика'}: было {item.get('previous') or 'пусто'}, стало {item.get('current') or 'пусто'}")
  for item in details.get("added", [])[:3]:
    value = item.get("value") or item.get("current") or item.get("competitor") or ""
    lines.append(f"добавили {item.get('name') or 'Характеристика'}: {value or 'пусто'}")
  for item in details.get("removed", [])[:3]:
    value = item.get("value") or item.get("previous") or item.get("competitor") or ""
    lines.append(f"убрали {item.get('name') or 'Характеристика'}: {value or 'пусто'}")
  return lines


def competitor_change_summary(changes, limit=6):
  parts = []
  for change in competitor_actionable_changes(changes):
    field = change.get("field")
    if field == "discountedPrice":
      parts.append(f"финальная цена: {competitor_snapshot_value({'value': change.get('previous')}, 'value') or change.get('previous') or 'нет'} -> {change.get('current') or 'нет'}")
    elif field == "price":
      parts.append(f"цена до скидки: {change.get('previous') or 'нет'} -> {change.get('current') or 'нет'}")
    elif field == "title":
      parts.append("изменили заголовок")
    elif field == "descriptionHash":
      parts.append(change.get("summary") or "изменили описание")
    elif field == "characteristics":
      parts.extend(competitor_characteristic_change_summary(change.get("details")) or ["изменили характеристики"])
    else:
      parts.append(f"{change.get('label') or 'Поле'}: {audit_str(change.get('previous'), 80) or 'пусто'} -> {audit_str(change.get('current'), 80) or 'пусто'}")
    if len(parts) >= limit:
      break
  return "; ".join(parts[:limit])


def competitor_change_detected_at(changes, snapshot, checked_at):
  for change in competitor_actionable_changes(changes):
    if change.get("detectedAt"):
      return audit_str(change.get("detectedAt"))
  snapshot = snapshot if isinstance(snapshot, dict) else {}
  return audit_str(snapshot.get("mpstatsVersionAt") or snapshot.get("mpstatsUpdatedAt") or checked_at or utc_now().isoformat())


def competitor_review_payload(existing_review, changes, snapshot, checked_at, assignee_login):
  existing_review = existing_review if isinstance(existing_review, dict) else {}
  actionable = competitor_actionable_changes(changes)
  change_hash = competitor_change_hash(actionable)
  if not change_hash:
    return existing_review if existing_review.get("changeHash") else {}, False
  if existing_review.get("changeHash") == change_hash:
    status = existing_review.get("status") or "open"
    return {
      **existing_review,
      "status": status,
      "assigneeLogin": existing_review.get("assigneeLogin") or assignee_login or "",
    }, False
  detected_at = competitor_change_detected_at(actionable, snapshot, checked_at)
  now_text = utc_now().isoformat()
  history = existing_review.get("history") if isinstance(existing_review.get("history"), list) else []
  summary = competitor_change_summary(actionable)
  review = {
    "status": "open",
    "changeHash": change_hash,
    "detectedAt": detected_at,
    "createdAt": now_text,
    "assigneeLogin": assignee_login or "",
    "summary": summary,
    "changes": actionable[:8],
    "history": [
      {
        "action": "detected",
        "at": now_text,
        "detectedAt": detected_at,
        "changeHash": change_hash,
        "summary": summary,
      },
      *history[:9],
    ],
  }
  return review, True


def db_valid_user_login(db, login):
  login = audit_str(login, 120)
  if not login:
    return ""
  row = db.execute("SELECT login FROM users WHERE login = ? AND is_active = 1", (login,)).fetchone()
  return row["login"] if row else ""


def portal_team_roles_from_db(db, portal_id):
  rows = db.execute(
    """
    SELECT project_role, user_login
    FROM portal_members
    WHERE portal_id = ?
    """,
    (portal_id,),
  ).fetchall()
  return {row["project_role"]: row["user_login"] for row in rows if row["project_role"] and row["user_login"]}


def competitor_review_assignee(db, portal_id, row, user=None):
  roles = portal_team_roles_from_db(db, portal_id)
  candidates = [
    roles.get("tech"),
    (user or {}).get("login") if isinstance(user, dict) else "",
    row["updated_by"] if row and "updated_by" in row.keys() else "",
    row["created_by"] if row and "created_by" in row.keys() else "",
  ]
  for candidate in candidates:
    login = db_valid_user_login(db, candidate)
    if login:
      return login
  return ""


def ensure_competitor_change_task(db, portal_id, card_key, row, card, snapshot, changes, review, actor_login=""):
  if not review or review.get("status") != "open" or not review.get("changeHash"):
    return False
  existing = db.execute(
    """
    SELECT *
    FROM card_drafts
    WHERE portal_id = ? AND card_key = ?
    """,
    (portal_id, card_key),
  ).fetchone()
  previous_payload = {}
  if existing:
    try:
      previous_payload = json.loads(existing["payload_json"])
    except (TypeError, json.JSONDecodeError):
      previous_payload = {}
  payload = normalize_card_draft_payload(previous_payload)
  meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
  current_monitoring = meta.get("competitorMonitoring") if isinstance(meta.get("competitorMonitoring"), dict) else {}
  if current_monitoring.get("changeHash") == review.get("changeHash") and current_monitoring.get("status") == "open":
    return False
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  nm_id = audit_str(row["nm_id"] or card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or "")
  vendor_code = audit_str(row["vendor_code"] or card.get("vendorCode") or raw_fields.get("vendorCode") or "")
  card_title = audit_str(card.get("title") or raw_fields.get("title") or snapshot.get("title") or "")
  subject_name = audit_str(card.get("subjectName") or raw_fields.get("subjectName") or "")
  now_text = utc_now().isoformat()
  assignee_login = db_valid_user_login(db, review.get("assigneeLogin")) or db_valid_user_login(db, actor_login)
  draft_user = assignee_login or db_valid_user_login(db, row["updated_by"] if row and "updated_by" in row.keys() else "") or db_valid_user_login(db, row["created_by"] if row and "created_by" in row.keys() else "")
  monitoring_history = current_monitoring.get("history") if isinstance(current_monitoring.get("history"), list) else []
  meta = {
    **meta,
    "competitorMonitoring": {
      "status": "open",
      "changeHash": review.get("changeHash"),
      "competitorNmID": row["competitor_nm_id"],
      "assigneeLogin": assignee_login,
      "detectedAt": review.get("detectedAt") or now_text,
      "createdAt": review.get("createdAt") or now_text,
      "summary": review.get("summary") or competitor_change_summary(changes),
      "changes": competitor_actionable_changes(changes)[:8],
      "history": [
        {
          "action": "detected",
          "at": now_text,
          "userLogin": actor_login or "system",
          "changeHash": review.get("changeHash"),
          "summary": review.get("summary") or competitor_change_summary(changes),
        },
        *monitoring_history[:9],
      ],
    },
    "card": {
      "nmID": nm_id,
      "vendorCode": vendor_code,
      "title": card_title,
      "subjectName": subject_name,
    },
  }
  approval = meta.get("approval") if isinstance(meta.get("approval"), dict) else {}
  approval_status = approval.get("status") or "draft"
  if approval_status in {"draft", "approved", "changes_requested", ""}:
    meta["approval"] = {
      **approval,
      "status": "draft",
      "assigneeLogin": assignee_login or approval.get("assigneeLogin") or "",
    }
  payload["meta"] = meta
  payload_json = json.dumps(normalize_card_draft_payload(payload), ensure_ascii=False, separators=(",", ":"))
  db.execute(
    """
    INSERT INTO card_drafts (
      portal_id, card_key, nm_id, vendor_code, payload_json,
      audit_status, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(portal_id, card_key) DO UPDATE SET
      nm_id = COALESCE(NULLIF(excluded.nm_id, ''), nm_id),
      vendor_code = COALESCE(NULLIF(excluded.vendor_code, ''), vendor_code),
      payload_json = excluded.payload_json,
      audit_status = excluded.audit_status,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
    """,
    (
      portal_id,
      card_key,
      nm_id[:80],
      vendor_code[:120],
      payload_json,
      payload.get("auditStatus") or "idle",
      draft_user or None,
      draft_user or None,
    ),
  )
  insert_card_approval_event(
    db,
    portal_id,
    card_key,
    {
      "nmID": nm_id,
      "vendorCode": vendor_code,
      "status": "draft",
      "action": "competitor_change_detected",
      "actorLogin": actor_login or "system",
      "assigneeLogin": assignee_login,
      "reason": review.get("summary") or competitor_change_summary(changes),
      "eventAt": now_text,
    },
  )
  return True


def competitor_metric_delta(current_value, competitor_value):
  current_number = audit_number(current_value, None)
  competitor_number = audit_number(competitor_value, None)
  if not current_number or not competitor_number:
    return None
  return round((competitor_number - current_number) / current_number * 100, 1)


def card_competitor_baseline(card, market_data):
  card = card if isinstance(card, dict) else {}
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  description = audit_str(card.get("description") or raw_fields.get("description") or "")
  characteristics = audit_card_characteristics(card)
  photos = card.get("photos") if isinstance(card.get("photos"), list) else raw_fields.get("photos")
  return {
    "nmID": audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or ""),
    "title": audit_str(card.get("title") or raw_fields.get("title") or ""),
    "brand": audit_str(card.get("brand") or raw_fields.get("brand") or ""),
    "subjectName": audit_str(card.get("subjectName") or raw_fields.get("subjectName") or ""),
    "price": audit_card_price(card, market_data),
    "descriptionLength": len(description),
    "descriptionPreview": audit_str(description, 420),
    "descriptionHash": competitor_text_digest(description),
    "characteristicsCount": len(characteristics),
    "characteristics": characteristics[:80],
    "characteristicsSignature": competitor_characteristic_signature(characteristics),
    "photosCount": len(photos) if isinstance(photos, list) else audit_int(card.get("photosCount") or raw_fields.get("photosCount"), 0),
  }


def competitor_snapshot_from_candidate(candidate, current_card, market_data):
  candidate = candidate if isinstance(candidate, dict) else {}
  current = card_competitor_baseline(current_card, market_data)
  nm_id = parse_competitor_nm_id(candidate.get("nmId") or candidate.get("nmID") or "")
  characteristics = audit_card_characteristics({"characteristics": candidate.get("characteristics") or []})
  description_length = audit_int(candidate.get("descriptionLength"), 0)
  description_preview = audit_str(candidate.get("descriptionPreview") or candidate.get("description") or "", 420)
  description_hash = audit_str(candidate.get("descriptionHash") or competitor_text_digest(candidate.get("description") or description_preview))
  characteristics_count = len(characteristics) if characteristics else audit_int(candidate.get("characteristicsCount"), 0)
  photo_history = candidate.get("photoHistory") if isinstance(candidate.get("photoHistory"), list) else []
  price = audit_positive_number(candidate.get("price"), candidate.get("basePrice"), default=None)
  discounted_price = audit_positive_number(
    candidate.get("discountedPrice"),
    candidate.get("finalPrice"),
    candidate.get("walletPrice"),
    candidate.get("avgSalePrice"),
    price,
    default=None,
  )
  comparison_price = discounted_price or price
  comparison = {
    "priceDeltaPercent": competitor_metric_delta(current.get("price"), comparison_price),
    "descriptionDelta": description_length - audit_int(current.get("descriptionLength"), 0) if description_length else None,
    "characteristicsDelta": characteristics_count - audit_int(current.get("characteristicsCount"), 0) if characteristics_count else None,
    "characteristics": competitor_characteristics_comparison(current.get("characteristics") or [], characteristics),
    "titleOverlap": round(audit_token_overlap_score(current.get("title"), candidate.get("title")), 2),
    "current": current,
  }
  signals = []
  if comparison["priceDeltaPercent"] is not None:
    if comparison["priceDeltaPercent"] <= -7:
      signals.append("конкурент дешевле")
    elif comparison["priceDeltaPercent"] >= 7:
      signals.append("конкурент дороже")
    else:
      signals.append("цена рядом")
  if audit_int(candidate.get("sales"), 0) > 0:
    signals.append("есть продажи MPStats")
  if audit_number(candidate.get("revenue"), 0):
    signals.append("есть выручка MPStats")
  if comparison["descriptionDelta"] is not None and comparison["descriptionDelta"] > 150:
    signals.append("описание подробнее")
  if comparison["characteristicsDelta"] is not None and comparison["characteristicsDelta"] > 2:
    signals.append("характеристик больше")
  return {
    "nmID": nm_id,
    "url": wb_public_card_url(nm_id),
    "title": audit_str(candidate.get("title") or ""),
    "brand": audit_str(candidate.get("brand") or ""),
    "seller": audit_str(candidate.get("seller") or ""),
    "subjectName": audit_str(candidate.get("subjectName") or current.get("subjectName") or ""),
    "price": price or discounted_price,
    "discountedPrice": discounted_price or price,
    "walletPrice": audit_number(candidate.get("walletPrice"), None),
    "avgSalePrice": audit_number(candidate.get("avgSalePrice"), None),
    "sales": audit_int(candidate.get("sales"), 0),
    "salesPerDay": audit_number(candidate.get("salesPerDay"), 0),
    "revenue": audit_number(candidate.get("revenue"), 0),
    "rating": audit_number(candidate.get("rating"), None),
    "feedbacks": audit_int(candidate.get("comments"), 0),
    "balance": audit_number(candidate.get("balance"), 0),
    "position": candidate.get("position"),
    "photosCount": audit_int(candidate.get("photosCount"), 0),
    "photoChangedByMpstats": bool(candidate.get("photoChangedByMpstats")),
    "photoHistory": photo_history[:12],
    "lastPhotoChangedAt": audit_str(candidate.get("lastPhotoChangedAt") or (photo_history[0].get("changedAt") if photo_history and isinstance(photo_history[0], dict) else "")),
    "mpstatsVersion": audit_str(candidate.get("mpstatsVersion") or ""),
    "mpstatsVersionAt": audit_str(candidate.get("mpstatsVersionAt") or ""),
    "mpstatsVersions": candidate.get("mpstatsVersions")[:8] if isinstance(candidate.get("mpstatsVersions"), list) else [],
    "mpstatsUpdatedAt": audit_str(candidate.get("mpstatsUpdatedAt") or ""),
    "descriptionLength": description_length,
    "descriptionPreview": description_preview,
    "descriptionHash": description_hash,
    "characteristicsCount": characteristics_count,
    "characteristics": characteristics[:40],
    "characteristicsSignature": competitor_characteristic_signature(characteristics),
    "source": audit_str(candidate.get("selectionSource") or candidate.get("source") or "manual"),
    "similarityScore": audit_int(candidate.get("similarityScore"), 0),
    "similarityReasons": audit_unique(candidate.get("similarityReasons") or [], limit=6),
    "reason": audit_str(candidate.get("whyRelevant") or ""),
    "comparison": comparison,
    "signals": audit_unique(signals, limit=8),
    "checkedAt": utc_now().isoformat(),
    "warnings": [],
  }


def public_card_competitor(row):
  snapshot = safe_json_object(row["snapshot_json"])
  previous_snapshot = safe_json_object(row["previous_snapshot_json"])
  changes = safe_json_list(row["changed_fields_json"])
  review = safe_json_object(row["review_json"] if "review_json" in row.keys() else "{}")
  if not changes and review.get("status") == "open" and isinstance(review.get("changes"), list):
    changes = review.get("changes")[:12]
  if not review and competitor_actionable_changes(changes):
    review, _created = competitor_review_payload({}, changes, snapshot, row["last_checked_at"] or snapshot.get("checkedAt") or "", "")
  return {
    "id": row["id"],
    "portalId": str(row["portal_id"]),
    "cardKey": row["card_key"],
    "nmID": row["nm_id"],
    "vendorCode": row["vendor_code"],
    "competitorNmID": row["competitor_nm_id"],
    "url": row["competitor_url"] or wb_public_card_url(row["competitor_nm_id"]),
    "note": row["note"] or "",
    "position": row["position"],
    "snapshot": snapshot,
    "previousSnapshot": previous_snapshot,
    "changes": changes,
    "changeReview": review,
    "hasCriticalChanges": any(bool(item.get("critical")) for item in changes if isinstance(item, dict)),
    "lastCheckedAt": row["last_checked_at"] or "",
    "nextAutoCheckAt": row["next_auto_check_at"] if "next_auto_check_at" in row.keys() else "",
    "createdBy": row["created_by"] or "",
    "updatedBy": row["updated_by"] or "",
    "createdAt": row["created_at"] or "",
    "updatedAt": row["updated_at"] or "",
  }


def card_competitor_row_is_auto(row):
  note = audit_normalized(row["note"] if row and "note" in row.keys() else "")
  snapshot = safe_json_object(row["snapshot_json"] if row and "snapshot_json" in row.keys() else "{}")
  reason = audit_normalized(snapshot.get("reason") or "")
  text = f"{note} {reason}"
  return any(marker in text for marker in (
    "добран автоматически",
    "подобран автоматически",
    "автодобор",
  ))


def prune_card_competitor_rows(numeric_portal_id, card_key, rows):
  rows = list(rows or [])
  remove_ids = [row["id"] for row in rows if card_competitor_row_is_auto(row)]
  kept_rows = [row for row in rows if row["id"] not in remove_ids]
  extra_rows = kept_rows[CARD_COMPETITOR_LIMIT:]
  if extra_rows:
    remove_ids.extend(row["id"] for row in extra_rows)
    kept_rows = kept_rows[:CARD_COMPETITOR_LIMIT]
  if remove_ids:
    with connect_db() as db:
      db.executemany(
        "DELETE FROM card_competitors WHERE portal_id = ? AND card_key = ? AND id = ?",
        [(numeric_portal_id, card_key, row_id) for row_id in remove_ids],
      )
  return kept_rows


def competitor_snapshot_needs_backfill(snapshot):
  if not isinstance(snapshot, dict) or not snapshot:
    return True
  if not audit_positive_number(snapshot.get("discountedPrice"), snapshot.get("price")):
    return True
  if not isinstance(snapshot.get("comparison"), dict):
    return True
  return False


def competitor_refresh_context(numeric_portal_id, card_key):
  card = content_card_for_portal(numeric_portal_id, card_key, {})
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  nm_id = audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or "")
  subject_id = card.get("subjectID") or card.get("subjectId") or raw_fields.get("subjectID") or raw_fields.get("subjectId")
  period = audit_period_default()
  warnings = []
  market_data = {}
  if nm_id:
    cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
    card = audit_merge_card_content(card, cdn_card)
    market_data = audit_market_data(nm_id, subject_id, period, warnings)
  return {
    "card": card,
    "rawFields": card.get("rawFields") if isinstance(card.get("rawFields"), dict) else raw_fields,
    "nmID": nm_id,
    "subjectID": subject_id,
    "period": period,
    "warnings": warnings,
    "marketData": market_data,
  }


def build_competitor_snapshot_for_row(row, context, checked_at):
  nm_id = context.get("nmID") or ""
  card = context.get("card") or {}
  market_data = context.get("marketData") or {}
  period = context.get("period") or audit_period_default()
  if nm_id:
    row_warnings = list(context.get("warnings") or [])
    candidate = audit_manual_competitor_candidate(row["competitor_nm_id"], period, row_warnings)
    score, reasons = audit_competitor_similarity(card, market_data, candidate)
    candidate["similarityScore"] = score
    candidate["similarityReasons"] = reasons
    candidate["whyRelevant"] = row["note"] or f"Добавлен специалистом; проверка схожести: {', '.join(reasons[:3]) or 'данные сверены через MPStats'}."
    current_snapshot = competitor_snapshot_from_candidate(candidate, card, market_data)
    current_snapshot["warnings"] = audit_public_warnings([*current_snapshot.get("warnings", []), *row_warnings])[:4]
    return current_snapshot
  current_snapshot = competitor_snapshot_from_sources(row["competitor_nm_id"])
  current_snapshot["source"] = "manual"
  current_snapshot["checkedAt"] = current_snapshot.get("checkedAt") or checked_at
  return current_snapshot


def refresh_card_competitor_rows(numeric_portal_id, card_key, rows, user=None, auto=False):
  rows = list(rows or [])
  if not rows:
    return False
  checked_at = utc_now().isoformat()
  context = competitor_refresh_context(numeric_portal_id, card_key)
  snapshot_updates = []
  for row in rows:
    previous_snapshot = safe_json_object(row["snapshot_json"])
    try:
      current_snapshot = build_competitor_snapshot_for_row(row, context, checked_at)
    except (MpstatsApiError, urlerror.HTTPError, urlerror.URLError, TimeoutError, RuntimeError, json.JSONDecodeError, KeyError, IndexError) as exc:
      current_snapshot = {
        **previous_snapshot,
        "checkedAt": checked_at,
        "warnings": audit_public_warnings([
          *safe_json_list(previous_snapshot.get("warnings") or []),
          f"Автопроверка конкурента не обновилась: {type(exc).__name__}",
        ])[:4],
      } if previous_snapshot else {
        "nmID": row["competitor_nm_id"],
        "url": row["competitor_url"] or wb_public_card_url(row["competitor_nm_id"]),
        "source": "manual",
        "checkedAt": checked_at,
        "warnings": [f"Автопроверка конкурента не обновилась: {type(exc).__name__}"],
      }
    has_current_data = bool(current_snapshot.get("title") or current_snapshot.get("price") or current_snapshot.get("discountedPrice"))
    if previous_snapshot and not has_current_data:
      current_snapshot = {
        **previous_snapshot,
        "checkedAt": current_snapshot.get("checkedAt") or checked_at,
        "warnings": current_snapshot.get("warnings") or ["Публичный снимок WB временно не обновился"],
      }
      changes = []
    else:
      changes = competitor_snapshot_changes(previous_snapshot, current_snapshot)
    snapshot_updates.append((row, previous_snapshot, current_snapshot, changes))
  task_updates = []
  with connect_db() as db:
    for row, previous_snapshot, current_snapshot, changes in snapshot_updates:
      assignee = competitor_review_assignee(db, numeric_portal_id, row, user)
      review, is_new_review = competitor_review_payload(
        safe_json_object(row["review_json"] if "review_json" in row.keys() else "{}"),
        changes,
        current_snapshot,
        checked_at,
        assignee,
      )
      actor_login = (user or {}).get("login") if isinstance(user, dict) else ""
      actor_db_login = db_valid_user_login(db, actor_login) or db_valid_user_login(db, row["updated_by"] if "updated_by" in row.keys() else "") or db_valid_user_login(db, row["created_by"] if "created_by" in row.keys() else "") or assignee
      db.execute(
        """
        UPDATE card_competitors
        SET snapshot_json = ?,
            previous_snapshot_json = ?,
            changed_fields_json = ?,
            review_json = ?,
            last_checked_at = ?,
            next_auto_check_at = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
          json.dumps(current_snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(previous_snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(changes, ensure_ascii=False, separators=(",", ":")),
          json.dumps(review, ensure_ascii=False, separators=(",", ":")),
          checked_at,
          competitor_next_auto_check_at(checked_at),
          actor_db_login or None,
          row["id"],
        ),
      )
      task_updates.append((row, current_snapshot, changes, review, is_new_review, actor_login))
    for row, current_snapshot, changes, review, is_new_review, actor_login in task_updates:
      if is_new_review and review.get("status") == "open":
        ensure_competitor_change_task(
          db,
          numeric_portal_id,
          card_key,
          row,
          context.get("card") or {},
          current_snapshot,
          changes,
          review,
          actor_login=actor_login or ("system-auto" if auto else ""),
        )
  return True


def auto_refresh_due_card_competitors(numeric_portal_id, card_key, rows, user=None):
  if not CARD_COMPETITOR_AUTO_CHECK_ENABLED:
    return False
  now = utc_now()
  due_rows = [row for row in rows if competitor_row_due_for_auto_check(row, now)]
  if not due_rows:
    return False
  return refresh_card_competitor_rows(numeric_portal_id, card_key, due_rows, user=user, auto=True)


def backfill_stale_card_competitors(numeric_portal_id, card_key, rows, user):
  stale_rows = [row for row in rows if competitor_snapshot_needs_backfill(safe_json_object(row["snapshot_json"]))]
  if not stale_rows:
    return False
  card = content_card_for_portal(numeric_portal_id, card_key, {})
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  nm_id = audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or "")
  if not nm_id:
    return False
  subject_id = card.get("subjectID") or card.get("subjectId") or raw_fields.get("subjectID") or raw_fields.get("subjectId")
  warnings = []
  period = audit_period_default()
  cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
  card = audit_merge_card_content(card, cdn_card)
  market_data = audit_market_data(nm_id, subject_id, period, warnings)
  checked_at = utc_now().isoformat()
  with connect_db() as db:
    for row in stale_rows:
      previous_snapshot = safe_json_object(row["snapshot_json"])
      candidate = audit_manual_competitor_candidate(row["competitor_nm_id"], period, warnings)
      score, reasons = audit_competitor_similarity(card, market_data, candidate)
      candidate["similarityScore"] = score
      candidate["similarityReasons"] = reasons
      candidate["whyRelevant"] = row["note"] or f"Ручной конкурент; проверка схожести: {', '.join(reasons[:3]) or 'данные сверены через MPStats'}."
      snapshot = competitor_snapshot_from_candidate(candidate, card, market_data)
      snapshot["warnings"] = audit_public_warnings([*snapshot.get("warnings", []), *warnings])[:4]
      changes = competitor_snapshot_changes(previous_snapshot, snapshot)
      db.execute(
        """
        UPDATE card_competitors
        SET snapshot_json = ?,
            previous_snapshot_json = ?,
            changed_fields_json = ?,
            last_checked_at = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
          json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(previous_snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(changes, ensure_ascii=False, separators=(",", ":")),
          checked_at,
          user["login"],
          row["id"],
        ),
      )
  return True


def list_card_competitors(portal_id, card_key, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE portal_id = ? AND card_key = ?
      ORDER BY position, updated_at DESC, id
      """,
      (numeric_portal_id, card_key),
    ).fetchall()
  rows = prune_card_competitor_rows(numeric_portal_id, card_key, rows)
  if backfill_stale_card_competitors(numeric_portal_id, card_key, rows, user):
    with connect_db() as db:
      rows = db.execute(
        """
        SELECT *
        FROM card_competitors
        WHERE portal_id = ? AND card_key = ?
        ORDER BY position, updated_at DESC, id
        """,
        (numeric_portal_id, card_key),
      ).fetchall()
    rows = prune_card_competitor_rows(numeric_portal_id, card_key, rows)
  if auto_refresh_due_card_competitors(numeric_portal_id, card_key, rows, user):
    with connect_db() as db:
      rows = db.execute(
        """
        SELECT *
        FROM card_competitors
        WHERE portal_id = ? AND card_key = ?
        ORDER BY position, updated_at DESC, id
        """,
        (numeric_portal_id, card_key),
      ).fetchall()
    rows = prune_card_competitor_rows(numeric_portal_id, card_key, rows)
  return [public_card_competitor(row) for row in rows]


def save_card_competitors(portal_id, card_key, nm_id, vendor_code, competitors, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  if not isinstance(competitors, list):
    raise ValueError("invalid_competitors")
  cleaned = []
  seen = set()
  for index, item in enumerate(competitors[:CARD_COMPETITOR_LIMIT]):
    raw_value = (item.get("url") or item.get("competitorNmID") or item.get("nmID") or item.get("nmId")) if isinstance(item, dict) else item
    competitor_nm_id = parse_competitor_nm_id(raw_value)
    if not competitor_nm_id or competitor_nm_id in seen:
      continue
    seen.add(competitor_nm_id)
    note = str(item.get("note") or "")[:500] if isinstance(item, dict) else ""
    cleaned.append({
      "competitorNmID": competitor_nm_id,
      "url": wb_public_card_url(competitor_nm_id),
      "note": note,
      "position": index,
    })
  with connect_db() as db:
    existing_rows = db.execute(
      """
      SELECT competitor_nm_id
      FROM card_competitors
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchall()
    existing_ids = {row["competitor_nm_id"] for row in existing_rows}
    next_ids = {item["competitorNmID"] for item in cleaned}
    for competitor_nm_id in existing_ids - next_ids:
      db.execute(
        "DELETE FROM card_competitors WHERE portal_id = ? AND card_key = ? AND competitor_nm_id = ?",
        (numeric_portal_id, card_key, competitor_nm_id),
      )
    for item in cleaned:
      next_auto_check_at = competitor_next_auto_check_at()
      db.execute(
        """
        INSERT INTO card_competitors (
          portal_id, card_key, nm_id, vendor_code, competitor_nm_id,
          competitor_url, note, position, review_json, next_auto_check_at,
          created_by, updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
        ON CONFLICT(portal_id, card_key, competitor_nm_id) DO UPDATE SET
          nm_id = excluded.nm_id,
          vendor_code = excluded.vendor_code,
          competitor_url = excluded.competitor_url,
          note = excluded.note,
          position = excluded.position,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
          numeric_portal_id,
          card_key,
          str(nm_id or "")[:80],
          str(vendor_code or "")[:120],
          item["competitorNmID"],
          item["url"],
          item["note"],
          item["position"],
          next_auto_check_at,
          user["login"],
          user["login"],
        ),
      )
  return list_card_competitors(numeric_portal_id, card_key, user)


def refresh_card_competitors(portal_id, card_key, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE portal_id = ? AND card_key = ?
      ORDER BY position, id
      """,
      (numeric_portal_id, card_key),
    ).fetchall()
  rows = prune_card_competitor_rows(numeric_portal_id, card_key, rows)
  refresh_card_competitor_rows(numeric_portal_id, card_key, rows, user=user, auto=False)
  return list_card_competitors(numeric_portal_id, card_key, user)


def suggest_card_competitors(portal_id, card_key, raw_card, manual_competitors, user):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  card = content_card_for_portal(numeric_portal_id, card_key, raw_card)
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  nm_id = audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or "")
  if not nm_id:
    raise ValueError("missing_nm_id")
  subject_id = card.get("subjectID") or card.get("subjectId") or raw_fields.get("subjectID") or raw_fields.get("subjectId")
  warnings = []
  period = audit_period_default()
  cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
  card = audit_merge_card_content(card, cdn_card)
  market_data = audit_market_data(nm_id, subject_id, period, warnings)
  competitors, selection = audit_pick_competitors(
    nm_id,
    card,
    market_data,
    warnings,
    manual_competitors,
    period=period,
    manual_limit=CARD_COMPETITOR_LIMIT,
  )
  if not competitors:
    warnings.append(f"Товарный аудит пуст: добавьте до {CARD_COMPETITOR_LIMIT} конкурентов вручную.")
    return {
      "competitors": list_card_competitors(numeric_portal_id, card_key, user),
      "selection": selection,
      "warnings": audit_public_warnings(warnings),
    }
  checked_at = utc_now().isoformat()
  with connect_db() as db:
    existing_rows = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchall()
  existing_rows = prune_card_competitor_rows(numeric_portal_id, card_key, existing_rows)
  with connect_db() as db:
    previous_by_id = {row["competitor_nm_id"]: safe_json_object(row["snapshot_json"]) for row in existing_rows}
    review_by_id = {row["competitor_nm_id"]: safe_json_object(row["review_json"] if "review_json" in row.keys() else "{}") for row in existing_rows}
    selected_ids = {parse_competitor_nm_id(item.get("nmId") or item.get("nmID")) for item in competitors[:CARD_COMPETITOR_LIMIT]}
    for row in existing_rows:
      if row["competitor_nm_id"] not in selected_ids:
        db.execute(
          "DELETE FROM card_competitors WHERE portal_id = ? AND card_key = ? AND competitor_nm_id = ?",
          (numeric_portal_id, card_key, row["competitor_nm_id"]),
        )
    for index, item in enumerate(competitors[:CARD_COMPETITOR_LIMIT]):
      competitor_nm_id = parse_competitor_nm_id(item.get("nmId") or item.get("nmID"))
      if not competitor_nm_id:
        continue
      snapshot = competitor_snapshot_from_candidate(item, card, market_data)
      snapshot["warnings"] = audit_public_warnings([*snapshot.get("warnings", []), *warnings])[:4]
      previous_snapshot = previous_by_id.get(competitor_nm_id, {})
      changes = competitor_snapshot_changes(previous_snapshot, snapshot)
      note = audit_str(item.get("whyRelevant") or "; ".join(item.get("similarityReasons") or []) or "Добавлен специалистом.", 500)
      next_auto_check_at = competitor_next_auto_check_at(checked_at)
      row_like = {
        "competitor_nm_id": competitor_nm_id,
        "competitor_url": wb_public_card_url(competitor_nm_id),
        "nm_id": nm_id[:80],
        "vendor_code": audit_str(card.get("vendorCode") or raw_fields.get("vendorCode") or "", 120),
        "note": note,
        "created_by": user["login"],
        "updated_by": user["login"],
      }
      assignee = competitor_review_assignee(db, numeric_portal_id, row_like, user)
      review, is_new_review = competitor_review_payload(
        review_by_id.get(competitor_nm_id, {}),
        changes,
        snapshot,
        checked_at,
        assignee,
      )
      db.execute(
        """
        INSERT INTO card_competitors (
          portal_id, card_key, nm_id, vendor_code, competitor_nm_id,
          competitor_url, note, position, snapshot_json, previous_snapshot_json,
          changed_fields_json, review_json, last_checked_at, next_auto_check_at,
          created_by, updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(portal_id, card_key, competitor_nm_id) DO UPDATE SET
          nm_id = excluded.nm_id,
          vendor_code = excluded.vendor_code,
          competitor_url = excluded.competitor_url,
          note = excluded.note,
          position = excluded.position,
          snapshot_json = excluded.snapshot_json,
          previous_snapshot_json = excluded.previous_snapshot_json,
          changed_fields_json = excluded.changed_fields_json,
          review_json = excluded.review_json,
          last_checked_at = excluded.last_checked_at,
          next_auto_check_at = excluded.next_auto_check_at,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
          numeric_portal_id,
          card_key,
          nm_id[:80],
          audit_str(card.get("vendorCode") or raw_fields.get("vendorCode") or "", 120),
          competitor_nm_id,
          wb_public_card_url(competitor_nm_id),
          note,
          index,
          json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(previous_snapshot, ensure_ascii=False, separators=(",", ":")),
          json.dumps(changes, ensure_ascii=False, separators=(",", ":")),
          json.dumps(review, ensure_ascii=False, separators=(",", ":")),
          checked_at,
          next_auto_check_at,
          user["login"],
          user["login"],
        ),
      )
      if is_new_review and review.get("status") == "open":
        ensure_competitor_change_task(
          db,
          numeric_portal_id,
          card_key,
          row_like,
          card,
          snapshot,
          changes,
          review,
          actor_login=user["login"],
        )
  return {
    "competitors": list_card_competitors(numeric_portal_id, card_key, user),
    "selection": selection,
    "warnings": audit_public_warnings(warnings),
  }


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
        SELECT login, full_name, role, user_role, access_level, is_active
        FROM users
        ORDER BY id
        """
      ).fetchall()
    return db.execute(
      """
      SELECT DISTINCT users.login, users.full_name, users.role, users.user_role, users.access_level, users.is_active
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
      "SELECT login, full_name, role, user_role, access_level, is_active FROM users WHERE login = ?",
      (login,),
    ).fetchone()
  record_admin_event(current_user, "user_created", "user", login, details={
    "fullName": full_name,
    "role": role,
    "userRole": user_role,
    "accessLevel": access_level,
  })
  return public_user(row), password


def update_user_account(payload, current_user):
  if not user_can_manage_users(current_user):
    raise PermissionError("forbidden")
  login = normalize_new_user_login(payload.get("login"))
  if not login:
    raise ValueError("invalid_user")
  full_name = str(payload.get("fullName") or payload.get("full_name") or "").strip()
  role = str(payload.get("role") or "").strip()
  user_role = str(payload.get("userRole") or payload.get("user_role") or "manager").strip()
  access_level = str(payload.get("accessLevel") or payload.get("access_level") or "overview").strip()
  is_active = bool(payload.get("isActive", payload.get("is_active", True)))
  if user_role not in {"admin", "manager", "tech"}:
    user_role = "manager"
  if access_level not in {"all", "overview", "readonly_wb"}:
    access_level = "overview"
  if not full_name or not role:
    raise ValueError("invalid_user")
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT login, full_name, role, user_role, access_level, is_active FROM users WHERE login = ?",
      (login,),
    ).fetchone()
    if not row:
      raise ValueError("user_not_found")
    if row["user_role"] == "admin" and current_user["user_role"] != "admin":
      raise PermissionError("forbidden")
    if user_role == "admin" and current_user["user_role"] != "admin":
      raise PermissionError("forbidden")
    if login == current_user["login"] and (not is_active or user_role != current_user["user_role"]):
      raise PermissionError("forbidden")
    db.execute(
      """
      UPDATE users
      SET full_name = ?,
          role = ?,
          user_role = ?,
          access_level = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE login = ?
      """,
      (full_name, role, user_role, access_level, 1 if is_active else 0, login),
    )
    updated = db.execute(
      "SELECT login, full_name, role, user_role, access_level, is_active FROM users WHERE login = ?",
      (login,),
    ).fetchone()
  record_admin_event(current_user, "user_updated", "user", login, details={
    "fullName": full_name,
    "role": role,
    "userRole": user_role,
    "accessLevel": access_level,
    "isActive": is_active,
  })
  return public_user(updated)


def reset_user_password(payload, current_user):
  if not user_can_manage_users(current_user):
    raise PermissionError("forbidden")
  login = normalize_new_user_login(payload.get("login"))
  if not login:
    raise ValueError("invalid_user")
  init_db()
  with connect_db() as db:
    row = db.execute(
      "SELECT login, full_name, role, user_role, access_level, is_active FROM users WHERE login = ? AND is_active = 1",
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
  record_admin_event(current_user, "password_reset", "user", login)
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


def wb_json_request(token, base_url, path, method="GET", payload=None, locale=None, attempts=3):
  separator = "&" if "?" in path else "?"
  locale_query = f"{separator}locale={locale}" if locale else ""
  url = f"{base_url.rstrip('/')}{path}{locale_query}"
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
  headers = {
    "Authorization": token,
    "Accept": "application/json",
    "User-Agent": "OptiCards/0.1 read-only",
  }
  if payload is not None:
    headers["Content-Type"] = "application/json"

  for attempt in range(attempts):
    request = urlrequest.Request(url, data=body, headers=headers, method=method)
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


def wb_request_json(token, path, payload, locale="ru", attempts=3, base_url=None):
  return wb_json_request(token, base_url or WB_CONTENT_API_BASE, path, method="POST", payload=payload, locale=locale, attempts=attempts)


def wb_get_json(token, path, locale="ru", attempts=3, base_url=None):
  return wb_json_request(token, base_url or WB_CONTENT_API_BASE, path, method="GET", locale=locale, attempts=attempts)


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
        mpstats_usage_record("GET", path, status=f"ok-attempt-{attempt + 1}", http_status=response.getcode(), balance_remaining=mpstats_balance_from_headers(response.headers))
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      mpstats_usage_record("GET", path, status=f"error-attempt-{attempt + 1}", http_status=exc.code, balance_remaining=mpstats_balance_from_headers(exc.headers))
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(
        exc.code,
        mpstats_error_message(response_body, HTTPStatus(exc.code).phrase),
        retryable=retryable,
      ) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      mpstats_usage_record("GET", path, status=f"timeout-attempt-{attempt + 1}", http_status=HTTPStatus.GATEWAY_TIMEOUT)
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
    request_path = f"{path}{'?' + query if query else ''}"
    try:
      with urlrequest.urlopen(request, timeout=MPSTATS_CONNECT_TIMEOUT + MPSTATS_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        mpstats_usage_record("POST", request_path, status=f"ok-attempt-{attempt + 1}", http_status=response.getcode(), balance_remaining=mpstats_balance_from_headers(response.headers))
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 429 or 500 <= exc.code < 600
      mpstats_usage_record("POST", request_path, status=f"error-attempt-{attempt + 1}", http_status=exc.code, balance_remaining=mpstats_balance_from_headers(exc.headers))
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.5 * (2 ** attempt))
        continue
      raise MpstatsApiError(
        exc.code,
        mpstats_error_message(response_body, HTTPStatus(exc.code).phrase),
        retryable=retryable,
      ) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      mpstats_usage_record("POST", request_path, status=f"timeout-attempt-{attempt + 1}", http_status=HTTPStatus.GATEWAY_TIMEOUT)
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
      mpstats_usage_record("POST", "/analytics/v1/wb/characteristics-analysis", source="cache", status="hit")
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
    attempts=1,
  )
  report_hash = create_payload.get("result") if isinstance(create_payload, dict) else ""
  if not report_hash:
    raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_report_hash_missing", retryable=True)

  report_payload = {}
  for attempt in range(3):
    report_payload = mpstats_get_json(token, f"/analytics/v1/wb/characteristics-analysis/{report_hash}", attempts=1)
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


AUDIT_REQUIRED_KEYS = ("category", "competitors", "title", "description", "characteristics", "summary")

AUDIT_LLM_SYSTEM_PROMPT = """
Ты — аналитик маркетплейсов для Wildberries. Заполни структурированный результат аудита карточки:
category, competitors, title, description, characteristics, summary.

ПРИНЦИП №1: ничего не выдумывать. Каждый факт, число и рекомендация должны опираться только на evidenceBundle.
Нет данных — оставь консервативно и вынеси ограничение в summary.riskNotes.

Пиши простым русским для владельца магазина. Любая оценка "мало/много/выше/ниже" должна иметь число или ориентир.
Различай органическую, рекламную и итоговую позицию. Не обещай рост продаж в процентах.
Приоритет high/medium/low ставь только при наличии причины и числа.

description.recommended должен быть готовым переписанным текстом карточки, а не советом специалисту.
Не пиши в description.recommended фразы-инструкции вроде "добавьте", "раскройте", "опишите", "проверьте".
Что именно изменено и почему, объясняй в description.reason.

Верни строго JSON без текста вокруг. Не добавляй поля кроме допустимых верхнеуровневых блоков и _meta.
""".strip()

CONTENT_REOPTIMIZE_SYSTEM_PROMPT = """
Ты — SEO-редактор карточек Wildberries. Перепиши заголовок и описание карточки под новое семантическое ядро.

Правила:
- используй только факты из evidenceBundle;
- не выдумывай состав, материал, размер, назначение, бренд, комплектацию и свойства;
- если новые ключевые запросы переданы, включи их естественно, без переспама и повторов;
- запросы из evidenceBundle.semanticCore.removeKeywords предложены к удалению: не включай их намеренно и переформулируй текст без точной фразы, если это не ломает фактическое свойство товара;
- заголовок должен быть готовым названием карточки WB длиной до 60 символов;
- описание должно быть готовым текстом карточки, а не советом специалисту;
- не обещай рост продаж, медицинский эффект, сертификацию или преимущества без фактов.

Верни строго JSON:
{
  "title": {"value": "...", "reason": "...", "keywords": ["..."]},
  "description": {"value": "...", "reason": "...", "keywords": ["..."]},
  "_meta": {"warnings": ["..."]}
}
""".strip()

COMPETITOR_CHANGE_REOPTIMIZE_SYSTEM_PROMPT = """
Ты — SEO-редактор карточек Wildberries. Подготовь черновик заголовка и описания нашей карточки с учетом изменений у конкурента.

Правила:
- используй только факты из evidenceBundle о нашей карточке и изменениях конкурента;
- не копируй текст конкурента дословно;
- не выдумывай состав, материал, размер, комплектацию, бренд и свойства;
- если у конкурента изменились характеристики, можно усилить только те свойства, которые уже подтверждены в нашей карточке;
- если изменение только по цене, текст можно оставить близким к текущему, а причину сделать про проверку позиционирования;
- заголовок должен быть готовым названием WB длиной до 60 символов;
- описание должно быть готовым текстом карточки, а не советом специалисту;
- не обещай рост продаж, медицинский эффект, сертификацию или преимущества без фактов.

Верни строго JSON:
{
  "title": {"value": "...", "reason": "..."},
  "description": {"value": "...", "reason": "..."},
  "_meta": {"warnings": ["..."]}
}
""".strip()


def audit_period_default():
  d2 = (utc_now().date() - dt.timedelta(days=14))
  d1 = d2 - dt.timedelta(days=29)
  return {"d1": d1.isoformat(), "d2": d2.isoformat()}


def mpstats_semantic_period_default():
  days = max(1, min(int(MPSTATS_SEMANTIC_PERIOD_DAYS or 30), 365))
  lag_days = max(0, min(int(MPSTATS_SEMANTIC_PERIOD_LAG_DAYS or 0), 30))
  d2 = utc_now().date() - dt.timedelta(days=lag_days)
  d1 = d2 - dt.timedelta(days=days - 1)
  return {"d1": d1.isoformat(), "d2": d2.isoformat()}


def audit_str(value, limit=None):
  text = str(value or "").strip()
  if limit and len(text) > limit:
    return text[:limit].rstrip()
  return text


def content_title_limit(value, limit=60):
  text = audit_str(value)
  if len(text) <= limit:
    return text
  words = text.split()
  output = ""
  for word in words:
    candidate = f"{output} {word}".strip()
    if len(candidate) > limit:
      break
    output = candidate
  return output or text[:limit].rstrip()


def audit_number(value, default=None):
  try:
    if value in (None, ""):
      return default
    return float(value)
  except (TypeError, ValueError):
    return default


def audit_positive_number(*values, default=None):
  for value in values:
    number = audit_number(value, None)
    if number is not None and number > 0:
      return number
  return default


def audit_average_price_from_stats(stats):
  if not isinstance(stats, dict):
    return None
  revenue = audit_positive_number(stats.get("revenue"), stats.get("revenue_estimated"))
  sales = audit_positive_number(stats.get("sales"), stats.get("sales_estimated"))
  if revenue and sales:
    return round(revenue / sales, 2)
  return None


def mpstats_price_metrics(*payloads):
  price_sources = []
  stats_sources = []
  for payload in payloads:
    if not isinstance(payload, dict):
      continue
    item_payload = payload.get("item") if isinstance(payload.get("item"), dict) else None
    if item_payload is not None:
      nested_metrics = mpstats_price_metrics(item_payload)
      price_sources.append({
        "price": nested_metrics.get("price"),
        "finalPrice": nested_metrics.get("discountedPrice"),
        "walletPrice": nested_metrics.get("walletPrice"),
      })
    price_block = payload.get("price") if isinstance(payload.get("price"), dict) else {}
    price_sources.append({
      "price": audit_positive_number(
        price_block.get("price"),
        payload.get("price"),
        payload.get("basic_price"),
        payload.get("basicPrice"),
      ),
      "finalPrice": audit_positive_number(
        price_block.get("final_price"),
        price_block.get("finalPrice"),
        payload.get("final_price"),
        payload.get("finalPrice"),
        payload.get("sale_price"),
        payload.get("salePrice"),
        payload.get("client_price"),
        payload.get("clientPrice"),
      ),
      "walletPrice": audit_positive_number(
        price_block.get("wallet_price"),
        price_block.get("walletPrice"),
        payload.get("wallet_price"),
        payload.get("walletPrice"),
      ),
    })
    stats = payload.get("period_stats") if isinstance(payload.get("period_stats"), dict) else payload
    if isinstance(stats, dict):
      stats_sources.append(stats)
  base_price = audit_positive_number(*(item.get("price") for item in price_sources))
  final_price = audit_positive_number(*(item.get("finalPrice") for item in price_sources))
  wallet_price = audit_positive_number(*(item.get("walletPrice") for item in price_sources))
  average_price = audit_positive_number(*(audit_average_price_from_stats(stats) for stats in stats_sources))
  return {
    "price": base_price or final_price or wallet_price or average_price,
    "discountedPrice": final_price or wallet_price or average_price or base_price,
    "walletPrice": wallet_price,
    "avgSalePrice": average_price,
  }


def mpstats_timestamp_iso(value):
  number = audit_number(value, None)
  if number is None or number <= 0:
    return ""
  if number > 10000000000:
    number = number / 1000
  try:
    return dt.datetime.fromtimestamp(number, dt.timezone.utc).isoformat()
  except (OverflowError, OSError, ValueError):
    return ""


def mpstats_date_iso(value):
  if value in (None, ""):
    return ""
  numeric = audit_number(value, None)
  if numeric is not None:
    return mpstats_timestamp_iso(numeric)
  text = audit_str(value)
  for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
    try:
      parsed = dt.datetime.strptime(text, fmt)
      return parsed.isoformat()
    except ValueError:
      continue
  return text


def mpstats_photo_history_rows(payload, limit=12):
  rows = []
  for item in audit_extract_list(payload):
    if not isinstance(item, dict):
      continue
    changed_at = mpstats_timestamp_iso(item.get("date") or item.get("created") or item.get("created_at") or item.get("updated"))
    thumb = audit_str(item.get("thumb") or item.get("url") or item.get("photo") or item.get("image") or "")
    if not changed_at and not thumb:
      continue
    rows.append({
      "changedAt": changed_at,
      "thumb": thumb,
    })
    if len(rows) >= limit:
      break
  return rows


def audit_mpstats_photo_history(token, nm_id, warnings, cache_ttl=86400):
  if not token:
    return []
  photo_payload = audit_mpstats_get(
    token,
    f"/analytics/v1/wb/items/{parse_competitor_nm_id(nm_id)}/photos_history",
    warnings,
    cache_ttl=cache_ttl,
  )
  return mpstats_photo_history_rows(photo_payload)


def mpstats_full_page_version_rows(payload, limit=12):
  rows = []
  for item in audit_extract_list(payload):
    if not isinstance(item, dict):
      continue
    version = audit_str(item.get("version") or item.get("hash") or item.get("id") or "")
    if not version:
      continue
    changed_at = mpstats_date_iso(item.get("date") or item.get("created") or item.get("created_at") or item.get("updated"))
    rows.append({
      "version": version,
      "changedAt": changed_at,
    })
    if len(rows) >= limit:
      break
  return rows


def mpstats_full_page_characteristics(payload):
  if not isinstance(payload, dict):
    return []
  rows = []
  seen = set()
  names = payload.get("param_names") if isinstance(payload.get("param_names"), list) else []
  values = payload.get("param_values") if isinstance(payload.get("param_values"), list) else []
  for index, name in enumerate(names):
    label = audit_str(name)
    value = values[index] if index < len(values) else ""
    text = audit_str(value)
    key = audit_normalized(label)
    if not label or not text or key in seen:
      continue
    seen.add(key)
    rows.append({"name": label, "value": text})
  for label, key in (
    ("Состав", "consist"),
    ("Цвет", "color"),
    ("Страна производства", "country"),
  ):
    text = audit_str(payload.get(key))
    normalized_label = audit_normalized(label)
    if text and normalized_label not in seen:
      seen.add(normalized_label)
      rows.append({"name": label, "value": text})
  return rows


def mpstats_full_page_snapshot(payload, version_row=None):
  if not isinstance(payload, dict) or not payload:
    return {}
  version_row = version_row if isinstance(version_row, dict) else {}
  title = audit_str(payload.get("full_name") or payload.get("name") or "")
  description = audit_str(payload.get("description") or "")
  characteristics = audit_card_characteristics({"characteristics": mpstats_full_page_characteristics(payload)})
  changed_at = version_row.get("changedAt") or mpstats_date_iso(payload.get("data") or payload.get("date"))
  return {
    "version": audit_str(version_row.get("version") or payload.get("version") or ""),
    "changedAt": changed_at,
    "versionDate": audit_str(payload.get("data") or ""),
    "title": title,
    "brand": audit_str(payload.get("brand") or ""),
    "descriptionLength": len(description),
    "descriptionPreview": audit_str(description, 420),
    "descriptionHash": competitor_text_digest(description),
    "characteristics": characteristics[:80],
    "characteristicsCount": len(characteristics),
    "characteristicsSignature": competitor_characteristic_signature(characteristics),
    "photosCount": audit_int(payload.get("images_count"), 0),
  }


def audit_mpstats_full_page_versions(token, nm_id, warnings, cache_ttl=86400):
  if not token:
    return []
  payload = audit_mpstats_get(
    token,
    f"/wb/get/item/{parse_competitor_nm_id(nm_id)}/full_page/versions",
    warnings,
    cache_ttl=cache_ttl,
  )
  return mpstats_full_page_version_rows(payload)


def audit_mpstats_latest_full_page_snapshot(token, nm_id, warnings, cache_ttl=86400):
  versions = audit_mpstats_full_page_versions(token, nm_id, warnings, cache_ttl=cache_ttl)
  if not versions:
    return {}, []
  version = versions[0].get("version")
  if not version:
    return {}, versions
  payload = audit_mpstats_get(
    token,
    f"/wb/get/item/{parse_competitor_nm_id(nm_id)}/full_page?{urlencode({'version': version})}",
    warnings,
    cache_ttl=cache_ttl,
  )
  return mpstats_full_page_snapshot(payload, versions[0]), versions


def audit_int(value, default=0):
  number = audit_number(value)
  if number is None:
    return default
  return int(number)


def audit_normalized(value):
  return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("ё", "е"))


def audit_tokens(value):
  return [
    token
    for token in re.split(r"[^0-9a-zа-я]+", audit_normalized(value))
    if len(token) > 2
  ]


AUDIT_CHARACTERISTIC_NAME_STOPWORDS = {
  "для",
  "вид",
  "тип",
  "товар",
  "товара",
  "изделие",
  "изделия",
  "модель",
  "модели",
  "модел",
  "материал",
  "материала",
  "характеристика",
  "значение",
  "значения",
  "на",
}

AUDIT_AMBIGUOUS_SINGLE_CHARACTERISTIC_TOKENS = {
  "длин",
  "ширин",
  "высот",
  "размер",
  "объем",
  "вес",
  "ростовк",
}

AUDIT_CHARACTERISTIC_ALIAS_GROUPS = (
  ("тип рукавов", "тип рукава", "длина рукава", "длина рукавов", "длина рукава изделия", "длина рукавов изделия", "рукав", "рукава", "рукава модель"),
  ("тип карманов", "карманы", "вид кармана", "карман"),
  ("фактура материала", "фактура", "структура материала", "текстура материала"),
  ("особенности модели", "особенности", "особенности товара"),
  ("декоративные элементы", "декор", "элементы декора"),
  ("конструктивные элементы", "конструктивные особенности", "элементы конструкции"),
  ("назначение", "назначение товара", "назначение модели"),
  ("покрой", "силуэт", "крой"),
  ("тип застежки", "застежка", "вид застежки"),
  ("вырез горловины", "горловина", "тип горловины"),
  ("рисунок", "принт", "узор"),
)


def audit_normalized_characteristic_name(value):
  return re.sub(r"\s+", " ", re.sub(r"[^0-9a-zа-я]+", " ", audit_normalized(value))).strip()


def audit_stem_characteristic_token(token):
  output = str(token or "")
  if len(output) > 5:
    output = re.sub(r"(ыми|ими|ого|его|ому|ему|ами|ями|ах|ях|ов|ев|ей|ом|ем)$", "", output)
  if len(output) > 4:
    output = re.sub(r"(ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|а|я|ы|и|у|ю|е)$", "", output)
  return output


def audit_characteristic_name_tokens(value):
  return [
    token
    for token in (
      audit_stem_characteristic_token(token)
      for token in audit_normalized_characteristic_name(value).split(" ")
    )
    if len(token) > 1 and token not in AUDIT_CHARACTERISTIC_NAME_STOPWORDS
  ]


def audit_characteristic_alias_matches(left, right):
  left_name = audit_normalized_characteristic_name(left)
  right_name = audit_normalized_characteristic_name(right)
  for group in AUDIT_CHARACTERISTIC_ALIAS_GROUPS:
    names = {audit_normalized_characteristic_name(name) for name in group}
    if left_name in names and right_name in names:
      return True
  return False


def audit_contains_phrase(text, phrase):
  text_tokens = set(audit_tokens(text))
  phrase_tokens = [token for token in audit_tokens(phrase) if len(token) > 3]
  if not phrase_tokens:
    return True
  return sum(1 for token in phrase_tokens if token in text_tokens) >= max(1, min(len(phrase_tokens), 2))


def audit_contains_semantic_query(text, query):
  text_tokens = set(audit_tokens(text))
  query_tokens = [token for token in audit_tokens(query) if len(token) > 3]
  if not text_tokens or not query_tokens:
    return False
  return all(token in text_tokens for token in query_tokens)


def semantic_frequency_priority(value):
  wb_count = audit_int(value, 0)
  if wb_count >= MPSTATS_SEMANTIC_HIGH_FREQUENCY:
    return "high"
  if wb_count >= MPSTATS_SEMANTIC_MEDIUM_FREQUENCY:
    return "medium"
  return "low"


def audit_contains_semantic_content_query(text, query):
  text_tokens = [token for token in audit_tokens(text) if len(token) > 3]
  query_tokens = [token for token in audit_tokens(query) if len(token) > 3]
  if not text_tokens or not query_tokens:
    return False
  text_phrase = f" {' '.join(text_tokens)} "
  query_phrase = " ".join(query_tokens)
  if f" {query_phrase} " in text_phrase:
    return True
  if len(query_tokens) == 2:
    text_token_set = set(text_tokens)
    return all(token in text_token_set for token in query_tokens)
  return False


def audit_unique(values, limit=12):
  output = []
  seen = set()
  for value in values:
    text = audit_str(value)
    key = audit_normalized(text)
    if text and key not in seen:
      seen.add(key)
      output.append(text)
    if len(output) >= limit:
      break
  return output


def audit_extract_list(payload):
  if isinstance(payload, list):
    return payload
  if not isinstance(payload, dict):
    return []
  candidates = [
    payload.get("data"),
    payload.get("items"),
    payload.get("rows"),
    payload.get("result"),
  ]
  output = payload.get("output")
  if isinstance(output, dict):
    candidates.extend([output.get("data"), output.get("items"), output.get("rows")])
  data = payload.get("data")
  if isinstance(data, dict):
    candidates.extend([data.get("items"), data.get("rows"), data.get("words"), data.get("data")])
  for candidate in candidates:
    if isinstance(candidate, list):
      return candidate
  return []


def mpstats_media_url(value):
  text = audit_str(value)
  if text.startswith("//"):
    return f"https:{text}"
  if text.startswith("https://") or text.startswith("http://"):
    return text
  return ""


def mpstats_storefront_label(value):
  text = unquote(audit_str(value))
  text = re.sub(r"[_-]+", " ", text)
  text = re.sub(r"\s+", " ", text).strip(" /")
  if not text:
    return ""
  return " ".join(part.capitalize() if part.islower() else part for part in text.split(" "))


def mpstats_manual_source_text(name, store_url, manual_source):
  return "\n".join(audit_str(value) for value in (name, store_url, manual_source) if audit_str(value))


def mpstats_nm_ids_from_manual_source(name, store_url, manual_source, limit=100):
  text = mpstats_manual_source_text(name, store_url, manual_source)
  output = []
  seen = set()
  patterns = (
    r"(?:catalog|item)/(\d{6,12})",
    r"(?:nm|nmID|nmId|sku|артикул)\D{0,12}(\d{6,12})",
    r"\b(\d{7,12})\b",
  )
  for pattern in patterns:
    for match in re.findall(pattern, text, flags=re.IGNORECASE):
      nm_id = parse_competitor_nm_id(match)
      if nm_id and nm_id not in seen:
        seen.add(nm_id)
        output.append(nm_id)
        if len(output) >= limit:
          return output
  return output


def mpstats_bootstrap_add_candidate(candidates, seen, kind, path, source):
  kind = audit_str(kind)
  path = audit_str(path, 180)
  normalized = audit_normalized(path)
  if kind not in {"brand", "seller"} or not path or normalized in {"wb", "wildberries", "кабинет wb"}:
    return
  key = f"{kind}:{normalized}"
  if key in seen:
    return
  seen.add(key)
  candidates.append({"kind": kind, "path": path, "source": source})


def mpstats_storefront_candidates(name, store_url, manual_source, seed_cards=None):
  candidates = []
  seen = set()
  seed_cards = seed_cards if isinstance(seed_cards, list) else []
  source_text = mpstats_manual_source_text(name, store_url, manual_source)
  generic_names = {"", "кабинет wb", "wildberries", "wb"}
  portal_name = audit_str(name)
  if audit_normalized(portal_name) not in generic_names:
    mpstats_bootstrap_add_candidate(candidates, seen, "seller", portal_name, "portal-name")
    mpstats_bootstrap_add_candidate(candidates, seen, "brand", portal_name, "portal-name")

  for raw_url in re.findall(r"https?://[^\s,;]+", source_text):
    parsed = urlparse(raw_url)
    path_parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(path_parts):
      normalized_part = audit_normalized(part)
      next_part = path_parts[index + 1] if index + 1 < len(path_parts) else ""
      if normalized_part in {"brands", "brand"} and next_part:
        mpstats_bootstrap_add_candidate(candidates, seen, "brand", mpstats_storefront_label(next_part), "brand-url")
      if normalized_part in {"seller", "sellers", "supplier", "suppliers"} and next_part:
        mpstats_bootstrap_add_candidate(candidates, seen, "seller", mpstats_storefront_label(next_part), "seller-url")
    query = parse_qs(parsed.query)
    for key in ("brand", "brandName"):
      for value in query.get(key, []):
        mpstats_bootstrap_add_candidate(candidates, seen, "brand", mpstats_storefront_label(value), "query")
    for key in ("seller", "sellerName", "supplier", "supplier_id", "supplierId"):
      for value in query.get(key, []):
        mpstats_bootstrap_add_candidate(candidates, seen, "seller", mpstats_storefront_label(value), "query")

  for pattern, kind in (
    (r"(?:бренд|brand)\s*[:=]\s*([^\n;,]+)", "brand"),
    (r"(?:продавец|seller|поставщик|supplier)\s*[:=]\s*([^\n;,]+)", "seller"),
  ):
    for match in re.findall(pattern, source_text, flags=re.IGNORECASE):
      mpstats_bootstrap_add_candidate(candidates, seen, kind, mpstats_storefront_label(match), "manual-source")

  for card in seed_cards:
    if not isinstance(card, dict):
      continue
    mpstats_bootstrap_add_candidate(candidates, seen, "seller", card.get("sellerName") or card.get("seller"), "seed-card")
    mpstats_bootstrap_add_candidate(candidates, seen, "brand", card.get("brand"), "seed-card")

  return candidates


def ozon_mpstats_add_candidate(candidates, seen, kind, path, source):
  kind = audit_str(kind)
  path = audit_str(path, 180)
  normalized = audit_normalized(path)
  if kind not in {"seller", "brand", "category", "item"} or not path or normalized in {"ozon", "озон", "кабинет ozon", "ozon beta"}:
    return
  key = f"{kind}:{normalized}"
  if key in seen:
    return
  seen.add(key)
  candidates.append({"kind": kind, "path": path, "source": source})


def ozon_mpstats_candidates(name, store_url, manual_source, limit=12):
  candidates = []
  seen = set()
  source_text = mpstats_manual_source_text(name, store_url, manual_source)

  def prioritized():
    item_candidates = [candidate for candidate in candidates if candidate.get("kind") == "item"]
    other_candidates = [candidate for candidate in candidates if candidate.get("kind") != "item"]
    return (item_candidates + other_candidates)[:limit] if item_candidates else candidates[:limit]

  for raw_url in re.findall(r"https?://[^\s,;]+", source_text):
    parsed = urlparse(raw_url)
    host = (parsed.netloc or "").lower()
    if "ozon" not in host:
      continue
    path_parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(path_parts):
      normalized_part = audit_normalized(part)
      next_part = path_parts[index + 1] if index + 1 < len(path_parts) else ""
      if normalized_part in {"seller", "sellers", "shop", "shops"} and next_part:
        ozon_mpstats_add_candidate(candidates, seen, "seller", mpstats_storefront_label(next_part), "seller-url")
        numeric_tail = re.search(r"(\d{4,12})$", next_part)
        if numeric_tail:
          ozon_mpstats_add_candidate(candidates, seen, "seller", numeric_tail.group(1), "seller-url")
      if normalized_part in {"brand", "brands"} and next_part:
        ozon_mpstats_add_candidate(candidates, seen, "brand", mpstats_storefront_label(next_part), "brand-url")
      if normalized_part in {"category", "categories", "catalog"} and next_part:
        ozon_mpstats_add_candidate(candidates, seen, "category", mpstats_storefront_label(next_part), "category-url")
      if normalized_part in {"product", "products"} and next_part:
        for match in re.findall(r"\d{6,14}", next_part):
          ozon_mpstats_add_candidate(candidates, seen, "item", match, "product-url")
    query = parse_qs(parsed.query)
    for key in ("seller", "sellerId", "seller_id", "shop", "shopId"):
      for value in query.get(key, []):
        ozon_mpstats_add_candidate(candidates, seen, "seller", mpstats_storefront_label(value), "query")
    for key in ("brand", "brandName"):
      for value in query.get(key, []):
        ozon_mpstats_add_candidate(candidates, seen, "brand", mpstats_storefront_label(value), "query")
    for key in ("sku", "id", "product_id", "productId"):
      for value in query.get(key, []):
        for match in re.findall(r"\d{6,14}", value):
          ozon_mpstats_add_candidate(candidates, seen, "item", match, "query")

  for pattern, kind in (
    (r"(?:seller\s*id|seller|продавец|магазин|shop)\s*[:=]\s*([^\n;,]+)", "seller"),
    (r"(?:бренд|brand)\s*[:=]\s*([^\n;,]+)", "brand"),
    (r"(?:категория|category)\s*[:=]\s*([^\n;,]+)", "category"),
  ):
    for match in re.findall(pattern, source_text, flags=re.IGNORECASE):
      value = mpstats_storefront_label(match)
      ozon_mpstats_add_candidate(candidates, seen, kind, value, "manual-source")
      if kind == "seller":
        numeric_tail = re.search(r"(\d{4,12})$", value)
        if numeric_tail:
          ozon_mpstats_add_candidate(candidates, seen, kind, numeric_tail.group(1), "manual-source")

  for match in re.findall(r"(?:артикул(?:ы)?|sku|offer\s*id|offer|vendor\s*code)[^:\n]*[:=]\s*([^\n]+)", source_text, flags=re.IGNORECASE):
    for token in re.split(r"[\s,;]+", match):
      token = audit_str(token.strip(" .:;|/\\()[]{}"), 80)
      if re.search(r"[A-Za-zА-Яа-я0-9]", token) and len(token) >= 3:
        ozon_mpstats_add_candidate(candidates, seen, "item", token, "manual-source")
        if len(candidates) >= limit:
          return prioritized()

  for pattern in (
    r"(?:sku|ozon\s*id|product\s*id|product_id|товар|артикул)\D{0,16}(\d{6,14})",
    r"\b(\d{8,14})\b",
  ):
    for match in re.findall(pattern, source_text, flags=re.IGNORECASE):
      ozon_mpstats_add_candidate(candidates, seen, "item", match, "manual-source")
      if len(candidates) >= limit:
        return prioritized()

  return prioritized()


def mpstats_storefront_params(path_value, period):
  return {
    "path": path_value,
    "d1": period["d1"],
    "d2": period["d2"],
  }


def mpstats_storefront_body(limit, start_row=0):
  start_row = max(0, int(start_row or 0))
  limit = max(1, int(limit or 1))
  return {
    "startRow": start_row,
    "endRow": start_row + limit,
    "filterModel": {},
    "sortModel": [{"colId": "revenue", "sort": "desc"}],
  }


def mpstats_storefront_item_characteristics(item):
  if not isinstance(item, dict):
    return []
  if isinstance(item.get("characteristics"), list):
    return item.get("characteristics")
  rows = []
  for label, keys in (
    ("Цвет", ("color", "colors")),
    ("Страна производства", ("country", "countryName")),
    ("Пол", ("gender",)),
  ):
    value = first_nonempty(*(item.get(key) for key in keys))
    if value:
      rows.append({"name": label, "value": value})
  return rows


def first_nonempty(*values):
  for value in values:
    text = audit_str(value)
    if text:
      return text
  return ""


def mpstats_storefront_photo_rows(item):
  urls = []
  for key in ("thumb_middle", "thumb", "photo", "image", "url_photo"):
    url = mpstats_media_url(item.get(key) if isinstance(item, dict) else "")
    if url:
      urls.append(url)
  if isinstance(item, dict) and isinstance(item.get("photos"), list):
    for photo in item.get("photos"):
      if isinstance(photo, dict):
        for value in photo.values():
          url = mpstats_media_url(value)
          if url:
            urls.append(url)
      else:
        url = mpstats_media_url(photo)
        if url:
          urls.append(url)
  output = []
  seen = set()
  for url in urls:
    if url in seen:
      continue
    seen.add(url)
    output.append({"big": url, "c516x688": url, "c246x328": url})
  return output


def mpstats_storefront_raw_card(item, source="mpstats-storefront"):
  if not isinstance(item, dict):
    return None
  nm_id = item.get("nmID") or item.get("nmId") or item.get("nm_id") or item.get("id") or item.get("itemid")
  nm_id = parse_competitor_nm_id(nm_id)
  if not nm_id:
    return None
  price_metrics = mpstats_price_metrics(item)
  price = audit_positive_number(
    item.get("start_price"),
    item.get("basic_price"),
    item.get("price"),
    price_metrics.get("price"),
  )
  discounted_price = audit_positive_number(
    item.get("client_price"),
    item.get("final_price"),
    item.get("finalPrice"),
    item.get("discountedPrice"),
    price_metrics.get("discountedPrice"),
    price_metrics.get("walletPrice"),
    price,
  )
  category = audit_str(item.get("category") or item.get("categoryName") or "")
  subject = audit_str(item.get("subject") or item.get("subjectName") or item.get("entity") or "")
  if not subject and category:
    subject = category.split("/")[-1].strip()
  photos = mpstats_storefront_photo_rows(item)
  stock = audit_number(item.get("balance") or item.get("stock"), None)
  seller_stock = audit_number(item.get("balance_fbs"), None)
  wb_stock = audit_number(stock, None)
  if seller_stock is not None and stock is not None:
    wb_stock = max(0, stock - seller_stock)
  sizes = []
  if price is not None or discounted_price is not None or stock is not None:
    sizes.append({
      "techSize": "единый",
      "price": price,
      "discountedPrice": discounted_price,
      "stock": stock,
      "sellerStock": seller_stock,
      "wbStock": wb_stock,
      "skus": [],
    })
  return {
    "nmID": nm_id,
    "imtID": item.get("imtID") or item.get("imtId") or "",
    "vendorCode": item.get("vendorCode") or item.get("vendor_code") or "",
    "title": audit_str(item.get("title") or item.get("name") or item.get("full_name") or f"WB {nm_id}"),
    "description": audit_str(item.get("description") or item.get("descriptionPreview") or "", 7000),
    "brand": audit_named_value(item.get("brand") or ""),
    "sellerName": audit_named_value(item.get("sellerName") or item.get("seller") or item.get("supplier") or ""),
    "subjectID": item.get("subjectID") or item.get("subjectId") or item.get("subject_id"),
    "subjectName": subject or "категория не указана",
    "photos": photos,
    "photoUrl": first_photo_url({"photos": photos}),
    "characteristics": mpstats_storefront_item_characteristics(item),
    "sizes": sizes,
    "price": price,
    "discountedPrice": discounted_price,
    "discount": item.get("basic_sale") or item.get("discount"),
    "stock": stock,
    "sellerStock": seller_stock,
    "wbStock": wb_stock,
    "rating": audit_number(item.get("rating") or item.get("commentsvaluation"), None),
    "feedbacks": audit_int(item.get("comments") or item.get("feedbacks"), 0),
    "createdAt": audit_str(item.get("sku_first_date") or item.get("createdAt") or ""),
    "updatedAt": utc_now().isoformat(),
    "mpstats": {
      "source": source,
      "sales": audit_int(item.get("sales"), 0),
      "revenue": audit_number(item.get("revenue"), 0),
      "salesPerDay": audit_number(item.get("sales_per_day_average") or item.get("salesPerDay"), 0),
      "supplierId": item.get("supplier_id") or item.get("supplierId"),
      "url": item.get("url") or wb_public_card_url(nm_id),
    },
  }


def enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings):
  if not isinstance(raw_card, dict):
    return raw_card
  nm_id = parse_competitor_nm_id(raw_card.get("nmID") or raw_card.get("nmId") or raw_card.get("id"))
  if not nm_id:
    return raw_card
  characteristics = raw_card.get("characteristics") if isinstance(raw_card.get("characteristics"), list) else []
  needs_details = (
    not audit_str(raw_card.get("description"))
    or len(characteristics) <= 2
    or not audit_str(raw_card.get("subjectName"))
  )
  if not needs_details:
    return raw_card
  cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
  if not cdn_card:
    return raw_card
  merged = audit_merge_card_content(raw_card, cdn_card)
  source = raw_card.get("mpstats", {}).get("source") if isinstance(raw_card.get("mpstats"), dict) else ""
  photo_count = audit_int(raw_card.get("photosCount") or len(raw_card.get("photos") or []), 0)
  if source == "wb-public-seller" and photo_count > 0:
    photos = wb_public_photo_rows(nm_id, photo_count)
    if photos:
      merged["photos"] = photos
      merged["photoUrl"] = first_photo_url({"photos": photos})
      merged["photosCount"] = photo_count
  return merged


def mpstats_normalized_bootstrap_card(raw_card):
  normalized = normalize_wb_card(raw_card)
  for key in ("price", "discountedPrice", "discount", "stock", "sellerStock", "wbStock", "rating", "feedbacks"):
    if raw_card.get(key) not in (None, ""):
      normalized[key] = raw_card.get(key)
  normalized["rawFields"] = public_wb_value(raw_card)
  return normalized


def mpstats_seed_card_from_nm_id(nm_id):
  snapshot = competitor_snapshot_from_sources(nm_id)
  raw_card = mpstats_storefront_raw_card({
    "id": snapshot.get("nmID") or snapshot.get("nmId") or nm_id,
    "name": snapshot.get("title"),
    "brand": snapshot.get("brand"),
    "seller": snapshot.get("seller"),
    "subjectName": snapshot.get("subjectName"),
    "price": snapshot.get("price"),
    "discountedPrice": snapshot.get("discountedPrice"),
    "rating": snapshot.get("rating"),
    "comments": snapshot.get("feedbacks"),
    "descriptionPreview": snapshot.get("descriptionPreview"),
    "characteristics": snapshot.get("characteristics"),
    "thumb": snapshot.get("photoUrl"),
    "sales": snapshot.get("sales"),
    "revenue": snapshot.get("revenue"),
  }, source="mpstats-item")
  return raw_card


def fetch_mpstats_storefront_listing(token, candidate, period, limit, start_row=0):
  payload = mpstats_post_body_json(
    token,
    f"/wb/get/{candidate['kind']}",
    body=mpstats_storefront_body(limit, start_row=start_row),
    params=mpstats_storefront_params(candidate["path"], period),
    attempts=2,
  )
  rows = audit_extract_list(payload)
  raw_cards = []
  for row in rows:
    raw_card = mpstats_storefront_raw_card(row, source=f"mpstats-{candidate['kind']}")
    if raw_card:
      raw_cards.append(raw_card)
  return raw_cards, payload


def ozon_mpstats_candidate_endpoints(candidate, period):
  kind = candidate.get("kind")
  path = candidate.get("path")
  if kind in {"seller", "brand", "category"}:
    params = mpstats_storefront_params(path, period)
    body = mpstats_storefront_body(20, start_row=0)
    return [
      {"method": "POST", "path": f"/oz/get/{kind}", "params": params, "body": body},
      {"method": "POST", "path": f"/ozon/get/{kind}", "params": params, "body": body},
    ]
  if kind == "item":
    query = urlencode({"d1": period["d1"], "d2": period["d2"]})
    safe_path = quote(str(path or ""), safe="")
    return [
      {"method": "GET", "path": f"/analytics/v1/oz/items/{safe_path}"},
      {"method": "GET", "path": f"/analytics/v1/oz/items/{safe_path}/full?{query}"},
      {"method": "GET", "path": f"/analytics/v1/ozon/items/{safe_path}"},
    ]
  return []


def ozon_mpstats_payload_rows(payload):
  rows = audit_extract_list(payload)
  if rows:
    return rows
  if isinstance(payload, dict) and any(payload.get(key) for key in ("sku", "id", "product_id", "productId", "name", "title")):
    return [payload]
  return []


def ozon_mpstats_card_sample(item):
  if not isinstance(item, dict):
    return None
  product_id = first_nonempty(
    item.get("sku"),
    item.get("skuId"),
    item.get("id"),
    item.get("product_id"),
    item.get("productId"),
    item.get("fbo_sku"),
    item.get("fbs_sku"),
  )
  title = audit_str(item.get("title") or item.get("name") or item.get("full_name") or item.get("productName") or "")
  if not product_id and not title:
    return None
  return {
    "id": product_id,
    "offerId": first_nonempty(item.get("offer_id"), item.get("offerId"), item.get("vendorCode"), item.get("vendor_code")),
    "title": title or f"Ozon {product_id}",
    "brand": audit_named_value(item.get("brand") or item.get("brandName") or ""),
    "sellerName": audit_named_value(item.get("sellerName") or item.get("seller") or item.get("shopName") or ""),
    "category": audit_str(item.get("category") or item.get("categoryName") or item.get("subject") or item.get("subjectName") or ""),
    "price": audit_positive_number(item.get("price"), item.get("final_price"), item.get("finalPrice"), item.get("client_price")),
    "stock": audit_number(item.get("stock") or item.get("balance") or item.get("available_stock"), None),
    "sales": audit_int(item.get("sales"), 0),
    "revenue": audit_number(item.get("revenue"), 0),
    "rating": audit_number(item.get("rating") or item.get("commentsvaluation"), None),
    "feedbacks": audit_int(item.get("feedbacks") or item.get("comments") or item.get("reviews"), 0),
    "photoUrl": first_nonempty(item.get("thumb_middle"), item.get("thumb"), item.get("photo"), item.get("image"), item.get("url_photo")),
    "fieldKeys": list(item.keys())[:18],
  }


def ozon_snapshot_card_from_sample(item):
  if not isinstance(item, dict):
    return None
  raw_fields = public_wb_value(item)
  sku = audit_str(first_nonempty(item.get("id"), item.get("sku"), item.get("skuId"), item.get("productId"), item.get("product_id")), 120)
  offer_id = audit_str(first_nonempty(item.get("offerId"), item.get("offer_id"), item.get("vendorCode"), item.get("vendor_code")), 120)
  card_key = draft_card_key(sku or offer_id or item.get("title"))
  title = audit_str(item.get("title") or item.get("name") or (f"Ozon {sku}" if sku else "Ozon карточка"), 300)
  if not card_key or not title:
    return None
  photo_url = mpstats_media_url(first_nonempty(item.get("photoUrl"), item.get("photo"), item.get("image"), item.get("thumb"), item.get("thumb_middle")))
  photos = [{"big": photo_url, "c516x688": photo_url, "c246x328": photo_url}] if photo_url else []
  category = audit_str(item.get("category") or item.get("categoryName") or item.get("subjectName") or item.get("subject") or "", 240)
  price = audit_positive_number(item.get("price"), item.get("finalPrice"), item.get("final_price"), item.get("client_price"))
  stock = audit_number(item.get("stock") or item.get("balance") or item.get("available_stock"), None)
  size_row = {
    "techSize": "единый",
    "price": price,
    "discountedPrice": price,
    "stock": stock,
    "sellerStock": stock,
    "wbStock": stock,
    "skus": [sku] if sku else [],
  }
  issues = []
  if not photos:
    issues.append("Нет фото")
  if not category:
    issues.append("Категория не указана")
  return {
    "marketplace": "ozon",
    "cardKey": card_key,
    "id": sku,
    "sku": sku,
    "offerId": offer_id,
    "vendorCode": offer_id,
    "title": title,
    "description": audit_str(item.get("description") or "", 7000),
    "brand": audit_named_value(item.get("brand") or item.get("brandName") or ""),
    "sellerName": audit_named_value(item.get("sellerName") or item.get("seller") or item.get("shopName") or ""),
    "subjectName": category or "категория не указана",
    "category": category,
    "photoUrl": photo_url,
    "photos": photos,
    "characteristics": public_wb_value(item.get("characteristics") or []),
    "sizes": [size_row] if price is not None or stock is not None or sku else [],
    "price": price,
    "stock": stock,
    "sales": audit_int(item.get("sales"), 0),
    "revenue": audit_number(item.get("revenue"), 0),
    "rating": audit_number(item.get("rating"), None),
    "feedbacks": audit_int(item.get("feedbacks") or item.get("reviews"), 0),
    "quality": "Требует проверки" if issues else "Данные получены",
    "qualityClass": "amber" if issues else "green",
    "issue": issues[0] if issues else "Нет критичных",
    "issueCount": len(issues),
    "status": "MPStats",
    "statusClass": "green" if not issues else "amber",
    "updatedAt": utc_now().isoformat(),
    "rawFields": raw_fields,
    "mpstats": {
      "source": "ozon-mpstats-probe",
      "sales": audit_int(item.get("sales"), 0),
      "revenue": audit_number(item.get("revenue"), 0),
    },
  }


def save_ozon_mpstats_cards(portal_id, user, cards):
  row = get_portal_row(portal_id, user)
  if not row:
    raise ValueError("portal_not_found")
  if audit_normalized(row["marketplace"]) != "ozon":
    raise ValueError("ozon_portal_required")
  if not user_can_edit_portal(user, portal_id):
    raise PermissionError("forbidden")
  if not isinstance(cards, list) or not cards:
    raise ValueError("ozon_cards_missing")

  existing_cards = wb_snapshot_cards_from_row(row)
  merged = []
  key_to_index = {}
  for existing in existing_cards:
    if not isinstance(existing, dict):
      continue
    key = card_key_from_snapshot_card(existing) or draft_card_key(existing.get("cardKey"))
    if not key or key in key_to_index:
      continue
    key_to_index[key] = len(merged)
    merged.append(existing)

  added = 0
  updated = 0
  for item in cards[:50]:
    card = ozon_snapshot_card_from_sample(item)
    if not card:
      continue
    key = card_key_from_snapshot_card(card) or draft_card_key(card.get("cardKey"))
    if not key:
      continue
    if key in key_to_index:
      merged[key_to_index[key]] = card
      updated += 1
    else:
      key_to_index[key] = len(merged)
      merged.append(card)
      added += 1

  if not added and not updated:
    raise ValueError("ozon_cards_unrecognized")

  loaded_at = utc_now().isoformat()
  snapshot = {
    "cards": merged,
    "stats": {
      "cardCount": len(merged),
      "workCount": 0,
      "problemCount": sum(1 for card in merged if int(card.get("issueCount") or 0) > 0),
      "loadedAt": loaded_at,
      "portalName": "",
      "source": "ozon-mpstats-probe",
      "sourceLabel": "Ozon MPStats probe",
    },
  }
  update_portal_manual_snapshot(portal_id, snapshot, status="Ozon MPStats карточки")
  updated_row = get_portal_row(portal_id, user)
  return {
    "portal": public_portal_from_row(updated_row),
    "saved": {
      "added": added,
      "updated": updated,
      "total": len(merged),
      "loadedAt": loaded_at,
    },
  }


def build_ozon_mpstats_probe(portal_id, user, limit=20):
  row = get_portal_row(portal_id, user)
  if not row:
    raise ValueError("portal_not_found")
  if audit_normalized(row["marketplace"]) != "ozon":
    raise ValueError("ozon_portal_required")
  if not (row["store_url"] or row["manual_source"]):
    raise ValueError("manual_source_missing")
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)

  period = audit_period_default()
  limit = max(1, min(int(limit or 20), 50))
  candidates = ozon_mpstats_candidates(row["name"], row["store_url"], row["manual_source"], limit=max(limit, 50))
  if not candidates:
    raise ValueError("ozon_source_unrecognized")
  attempts = []
  samples = []
  seen_samples = set()
  last_total_estimate = 0

  def add_samples(rows):
    added = 0
    for row_item in rows:
      sample = ozon_mpstats_card_sample(row_item)
      if not sample:
        continue
      key = audit_normalized(sample.get("id") or sample.get("offerId") or sample.get("title"))
      if key in seen_samples:
        continue
      seen_samples.add(key)
      samples.append(sample)
      added += 1
      if len(samples) >= limit:
        break
    return added

  def check_endpoint(candidate, endpoint):
    nonlocal last_total_estimate
    request_path = endpoint["path"]
    if endpoint["method"] == "POST":
      request_path = f"{request_path}?{urlencode(endpoint.get('params') or {}, doseq=True)}"
    attempt = {
      "candidate": candidate,
      "method": endpoint["method"],
      "path": endpoint["path"],
      "status": "pending",
    }
    try:
      if endpoint["method"] == "POST":
        payload = mpstats_post_body_json(
          token,
          endpoint["path"],
          body=endpoint.get("body"),
          params=endpoint.get("params"),
          attempts=1,
        )
      else:
        payload = mpstats_get_json(token, endpoint["path"], attempts=1)
      rows = ozon_mpstats_payload_rows(payload)
      added = add_samples(rows)
      total_estimate = mpstats_payload_total_count(payload) or len(rows)
      last_total_estimate = max(last_total_estimate, total_estimate)
      attempt.update({
        "status": "loaded" if added else "empty",
        "rowCount": len(rows),
        "sampleCount": added,
        "totalEstimate": total_estimate,
        "requestPath": request_path,
      })
      attempts.append(attempt)
      return added
    except MpstatsApiError as exc:
      attempt.update({
        "status": "error",
        "message": exc.message,
        "httpStatus": exc.status,
        "retryable": exc.retryable,
        "requestPath": request_path,
      })
      attempts.append(attempt)
      return 0

  item_candidates = [candidate for candidate in candidates if candidate.get("kind") == "item"]
  fallback_candidates = [candidate for candidate in candidates if candidate.get("kind") != "item"]

  checked = 0
  max_item_attempts = 80
  for candidate in item_candidates:
    if len(samples) >= limit or checked >= max_item_attempts:
      break
    for endpoint in ozon_mpstats_candidate_endpoints(candidate, period):
      if checked >= max_item_attempts:
        break
      checked += 1
      if check_endpoint(candidate, endpoint):
        break

  if samples:
    return {
      "status": "loaded",
      "source": {
        "kind": "SKU",
        "path": f"{len(samples)} из {len(item_candidates)}",
        "source": "manual-source",
      },
      "period": period,
      "cardCount": len(samples),
      "totalEstimate": len(samples),
      "cards": samples,
      "attempts": attempts,
      "checkedAt": utc_now().isoformat(),
    }

  checked = 0
  max_attempts = 10
  for candidate in fallback_candidates:
    for endpoint in ozon_mpstats_candidate_endpoints(candidate, period):
      if checked >= max_attempts:
        break
      checked += 1
      if check_endpoint(candidate, endpoint):
        return {
          "status": "loaded",
          "source": candidate,
          "period": period,
          "cardCount": last_total_estimate or len(samples),
          "totalEstimate": last_total_estimate or len(samples),
          "cards": samples,
          "attempts": attempts,
          "checkedAt": utc_now().isoformat(),
        }
    if checked >= max_attempts:
      break

  return {
    "status": "empty",
    "source": candidates[0],
    "period": period,
    "cardCount": 0,
    "totalEstimate": 0,
    "cards": [],
    "attempts": attempts,
    "checkedAt": utc_now().isoformat(),
  }


def mpstats_payload_total_count(payload):
  candidates = []
  if isinstance(payload, dict):
    candidates.extend([
      payload.get("total"),
      payload.get("totalCount"),
      payload.get("recordsTotal"),
      payload.get("recordsFiltered"),
      payload.get("count"),
    ])
    data = payload.get("data")
    if isinstance(data, dict):
      candidates.extend([
        data.get("total"),
        data.get("totalCount"),
        data.get("recordsTotal"),
        data.get("recordsFiltered"),
        data.get("count"),
      ])
  for value in candidates:
    number = audit_int(value, 0)
    if number > 0:
      return number
  return 0


def mpstats_store_import_update(job_id, **changes):
  if not job_id:
    return
  with MPSTATS_STORE_IMPORT_LOCK:
    job = MPSTATS_STORE_IMPORT_JOBS.get(job_id)
    if not job:
      return
    job.update(changes)
    job["updatedAt"] = utc_now().isoformat()


def public_mpstats_store_import_job(job):
  if not isinstance(job, dict):
    return None
  output = {
    key: job.get(key)
    for key in (
      "id",
      "portalId",
      "status",
      "phase",
      "message",
      "loadedCount",
      "totalEstimate",
      "limit",
      "sourceLabel",
      "error",
      "startedAt",
      "updatedAt",
      "finishedAt",
    )
    if key in job
  }
  output["loadedCount"] = int(output.get("loadedCount") or 0)
  output["totalEstimate"] = int(output.get("totalEstimate") or 0)
  output["limit"] = int(output.get("limit") or 0)
  return output


def build_mpstats_storefront_snapshot(name, store_url, manual_source, limit=MPSTATS_STORE_BOOTSTRAP_MAX_CARDS):
  limit = max(1, min(int(limit or MPSTATS_STORE_BOOTSTRAP_MAX_CARDS), 500))
  period = audit_period_default()
  warnings = []
  seller_ids = wb_public_seller_ids_from_manual_source(name, store_url, manual_source)
  if seller_ids:
    selected_candidate = None
    raw_cards = []
    for seller_id in seller_ids:
      raw_cards = fetch_wb_public_seller_catalog(seller_id, limit=limit, warnings=warnings)
      if raw_cards:
        selected_candidate = {"kind": "seller", "path": seller_id, "source": "wb-public-seller"}
        break
    if not raw_cards:
      loaded_at = utc_now().isoformat()
      return {
        "cards": [],
        "raw_count": 0,
        "cursor": {},
        "tokenMeta": {},
        "stats": {
          "cardCount": 0,
          "workCount": 0,
          "problemCount": 0,
          "sampleLimit": limit,
          "loadedAt": loaded_at,
          "portalName": "",
          "source": "wb-public-seller",
          "sourceLabel": f"seller: {seller_ids[0]}",
        },
        "manualBootstrap": {
          "status": "empty",
          "cardCount": 0,
          "source": {"kind": "seller", "path": seller_ids[0], "source": "wb-public-seller"},
          "period": period,
          "warnings": audit_public_warnings(warnings),
          "loadedAt": loaded_at,
          "strictSellerSource": True,
        },
      }

    deduped = []
    seen = set()
    for raw_card in raw_cards:
      key = raw_storefront_card_key(raw_card)
      if not key or key in seen:
        continue
      seen.add(key)
      deduped.append(enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings))
      if len(deduped) >= limit:
        break
    cards = [mpstats_normalized_bootstrap_card(card) for card in deduped]
    portal_name = derive_wb_portal_name(cards)
    loaded_at = utc_now().isoformat()
    return {
      "cards": cards,
      "raw_count": len(cards),
      "cursor": {},
      "tokenMeta": {},
      "stats": {
        "cardCount": len(cards),
        "workCount": 0,
        "problemCount": sum(1 for card in cards if int(card.get("issueCount") or 0) > 0),
        "sampleLimit": limit,
        "loadedAt": loaded_at,
        "portalName": portal_name,
        "source": "wb-public-seller",
        "sourceLabel": f"seller: {selected_candidate.get('path')}",
      },
      "manualBootstrap": {
        "status": "loaded" if cards else "empty",
        "cardCount": len(cards),
        "source": selected_candidate or {},
        "period": period,
        "warnings": audit_public_warnings(warnings),
        "loadedAt": loaded_at,
        "strictSellerSource": True,
      },
    }

  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)
  nm_ids = mpstats_nm_ids_from_manual_source(name, store_url, manual_source, limit=limit)
  seed_cards = []
  for nm_id in nm_ids[:min(limit, 20)]:
    try:
      raw_card = mpstats_seed_card_from_nm_id(nm_id)
    except (RuntimeError, MpstatsApiError, ValueError):
      raw_card = None
    if raw_card:
      seed_cards.append(raw_card)

  candidates = mpstats_storefront_candidates(name, store_url, manual_source, seed_cards)
  selected_candidate = None
  raw_cards = []
  for candidate in candidates:
    try:
      raw_cards, _ = fetch_mpstats_storefront_listing(token, candidate, period, limit)
    except MpstatsApiError as exc:
      warnings.append(f"MPStats /wb/get/{candidate['kind']} {candidate['path']}: {exc.message}")
      raw_cards = []
    if raw_cards:
      selected_candidate = candidate
      break

  if not raw_cards and seed_cards:
    raw_cards = seed_cards
    selected_candidate = {"kind": "items", "path": ", ".join(nm_ids[:5]), "source": "nm-id"}

  if not raw_cards:
    seller_ids = wb_public_seller_ids_from_manual_source(name, store_url, manual_source)
    for seller_id in seller_ids:
      raw_cards = fetch_wb_public_seller_catalog(seller_id, limit=limit, warnings=warnings)
      if raw_cards:
        selected_candidate = {"kind": "seller", "path": seller_id, "source": "wb-public-seller"}
        break

  deduped = []
  seen = set()
  for raw_card in raw_cards:
    nm_id = parse_competitor_nm_id(raw_card.get("nmID"))
    if not nm_id or nm_id in seen:
      continue
    seen.add(nm_id)
    deduped.append(enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings))
    if len(deduped) >= limit:
      break

  cards = [mpstats_normalized_bootstrap_card(card) for card in deduped]
  portal_name = ""
  if selected_candidate and selected_candidate.get("kind") == "brand":
    portal_name = selected_candidate.get("path") or ""
  portal_name = portal_name or derive_wb_portal_name(cards)
  loaded_at = utc_now().isoformat()
  snapshot = {
    "cards": cards,
    "raw_count": len(cards),
    "cursor": {},
    "tokenMeta": {},
    "stats": {
      "cardCount": len(cards),
      "workCount": 0,
      "problemCount": sum(1 for card in cards if int(card.get("issueCount") or 0) > 0),
      "sampleLimit": limit,
      "loadedAt": loaded_at,
      "portalName": portal_name,
      "source": "mpstats",
      "sourceLabel": f"{selected_candidate.get('kind')}: {selected_candidate.get('path')}" if selected_candidate else "",
    },
    "manualBootstrap": {
      "status": "loaded" if cards else "empty",
      "cardCount": len(cards),
      "source": selected_candidate or {},
      "period": period,
      "warnings": audit_public_warnings(warnings),
      "loadedAt": loaded_at,
    },
  }
  return snapshot


def build_mpstats_storefront_snapshot_paged(
  name,
  store_url,
  manual_source,
  limit=MPSTATS_STORE_FULL_IMPORT_MAX_CARDS,
  batch_size=MPSTATS_STORE_IMPORT_BATCH_SIZE,
  job_id="",
  existing_cards=None,
):
  limit = max(1, min(int(limit or MPSTATS_STORE_FULL_IMPORT_MAX_CARDS), 5000))
  batch_size = max(20, min(int(batch_size or MPSTATS_STORE_IMPORT_BATCH_SIZE), 500))
  target_limit = min(limit, WB_MAX_CARDS_PER_SYNC)
  existing_cards = existing_cards if isinstance(existing_cards, list) else []
  seller_ids = wb_public_seller_ids_from_manual_source(name, store_url, manual_source)
  replace_existing = bool(seller_ids) and not snapshot_cards_match_wb_seller(existing_cards, seller_ids)
  if replace_existing:
    existing_cards = []
  existing_keys = snapshot_card_keys(existing_cards)
  existing_count = len(existing_keys)
  remaining_needed = max(0, target_limit - existing_count)
  period = audit_period_default()
  warnings = []
  if remaining_needed <= 0:
    loaded_at = utc_now().isoformat()
    return {
      "cards": [],
      "raw_count": 0,
      "cursor": {},
      "tokenMeta": {},
      "stats": {
        "cardCount": 0,
        "workCount": 0,
        "problemCount": 0,
        "sampleLimit": target_limit,
        "loadedAt": loaded_at,
        "portalName": "",
        "source": "mpstats",
        "sourceLabel": "",
      },
      "manualBootstrap": {
        "status": "loaded",
        "cardCount": 0,
        "source": {},
        "period": period,
        "warnings": [f"Лимит кабинета уже заполнен: {existing_count} карточек."],
        "loadedAt": loaded_at,
        "totalEstimate": existing_count,
        "limit": target_limit,
        "existingCount": existing_count,
        "newCount": 0,
        "strictSellerSource": bool(seller_ids),
      },
    }

  if seller_ids:
    selected_candidate = None
    raw_cards = []
    for seller_id in seller_ids:
      mpstats_store_import_update(
        job_id,
        phase="requesting",
        sourceLabel=f"seller: {seller_id}",
        message="Пробуем публичную витрину WB",
        totalEstimate=0,
      )
      raw_cards = fetch_wb_public_seller_catalog(
        seller_id,
        limit=remaining_needed,
        warnings=warnings,
        skip_keys=existing_keys,
        start_page=1,
      )
      if raw_cards:
        selected_candidate = {"kind": "seller", "path": seller_id, "source": "wb-public-seller"}
        break
    total_estimate = existing_count + len(raw_cards)
    deduped = []
    seen = set()
    mpstats_store_import_update(
      job_id,
      phase="normalizing",
      message="Обогащаем карточки данными WB",
      totalEstimate=total_estimate or target_limit,
    )
    for raw_card in raw_cards:
      key = raw_storefront_card_key(raw_card)
      if not key or key in seen or key in existing_keys:
        continue
      seen.add(key)
      deduped.append(enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings))
      mpstats_store_import_update(job_id, loadedCount=existing_count + len(deduped))
      if len(deduped) >= remaining_needed:
        break
    cards = [mpstats_normalized_bootstrap_card(card) for card in deduped]
    portal_name = derive_wb_portal_name(cards)
    loaded_at = utc_now().isoformat()
    return {
      "cards": cards,
      "raw_count": len(cards),
      "cursor": {},
      "tokenMeta": {},
      "stats": {
        "cardCount": len(cards),
        "workCount": 0,
        "problemCount": sum(1 for card in cards if int(card.get("issueCount") or 0) > 0),
        "sampleLimit": target_limit,
        "loadedAt": loaded_at,
        "portalName": portal_name,
        "source": "wb-public-seller",
        "sourceLabel": f"seller: {selected_candidate.get('path')}" if selected_candidate else f"seller: {seller_ids[0]}",
      },
      "manualBootstrap": {
        "status": "loaded" if cards else "empty",
        "cardCount": len(cards),
        "source": selected_candidate or {"kind": "seller", "path": seller_ids[0], "source": "wb-public-seller"},
        "period": period,
        "warnings": audit_public_warnings(warnings),
        "loadedAt": loaded_at,
        "totalEstimate": total_estimate,
        "limit": target_limit,
        "existingCount": existing_count,
        "newCount": len(cards),
        "strictSellerSource": True,
        "replaceExisting": replace_existing,
      },
    }

  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)
  nm_ids = mpstats_nm_ids_from_manual_source(name, store_url, manual_source, limit=limit)
  seed_cards = []
  for nm_id in nm_ids[:min(limit, 20)]:
    try:
      raw_card = mpstats_seed_card_from_nm_id(nm_id)
    except (RuntimeError, MpstatsApiError, ValueError):
      raw_card = None
    if raw_card:
      seed_cards.append(raw_card)

  candidates = mpstats_storefront_candidates(name, store_url, manual_source, seed_cards)
  selected_candidate = None
  raw_cards = []
  total_estimate = 0

  for candidate in candidates:
    candidate_rows = []
    seen_candidate_keys = set()
    offset = min(existing_count, max(0, limit - 1)) if existing_count else 0
    first_page = True
    mpstats_store_import_update(
      job_id,
      phase="requesting",
      sourceLabel=f"{candidate.get('kind')}: {candidate.get('path')}",
      message="Запрашиваем витрину MPStats",
      totalEstimate=0,
    )
    while offset < limit and len(candidate_rows) < remaining_needed:
      page_limit = min(batch_size, limit - offset)
      try:
        page_rows, payload = fetch_mpstats_storefront_listing(token, candidate, period, page_limit, start_row=offset)
      except MpstatsApiError as exc:
        warnings.append(f"MPStats /wb/get/{candidate['kind']} {candidate['path']} [{offset}]: {exc.message}")
        break
      if first_page:
        first_page = False
        total_estimate = mpstats_payload_total_count(payload)
        if total_estimate > 0:
          total_estimate = min(total_estimate, target_limit)
          mpstats_store_import_update(job_id, totalEstimate=total_estimate)
      if not page_rows:
        break
      for page_row in page_rows:
        key = raw_storefront_card_key(page_row)
        if not key or key in existing_keys or key in seen_candidate_keys:
          continue
        seen_candidate_keys.add(key)
        candidate_rows.append(page_row)
        if len(candidate_rows) >= remaining_needed:
          break
      offset += len(page_rows)
      mpstats_store_import_update(
        job_id,
        loadedCount=existing_count + len(candidate_rows),
        phase="requesting",
        message=f"MPStats нашел новых карточек: {len(candidate_rows)}",
      )
      if len(page_rows) < page_limit:
        break
      if total_estimate and offset >= total_estimate:
        break
    if candidate_rows:
      raw_cards = candidate_rows
      selected_candidate = candidate
      break

  if not raw_cards and seed_cards:
    raw_cards = [card for card in seed_cards if raw_storefront_card_key(card) not in existing_keys][:remaining_needed]
    selected_candidate = {"kind": "items", "path": ", ".join(nm_ids[:5]), "source": "nm-id"}
    total_estimate = existing_count + len(raw_cards)

  if not raw_cards:
    seller_ids = wb_public_seller_ids_from_manual_source(name, store_url, manual_source)
    for seller_id in seller_ids:
      start_page = max(1, existing_count // 100 + 1)
      mpstats_store_import_update(
        job_id,
        phase="requesting",
        sourceLabel=f"seller: {seller_id}",
        message="Пробуем публичную витрину WB",
        totalEstimate=0,
      )
      raw_cards = fetch_wb_public_seller_catalog(
        seller_id,
        limit=remaining_needed,
        warnings=warnings,
        skip_keys=existing_keys,
        start_page=start_page,
      )
      if raw_cards:
        selected_candidate = {"kind": "seller", "path": seller_id, "source": "wb-public-seller"}
        total_estimate = existing_count + len(raw_cards)
        break

  deduped = []
  seen = set()
  total_for_progress = total_estimate if total_estimate > 0 else min(existing_count + len(raw_cards), target_limit) or target_limit
  mpstats_store_import_update(
    job_id,
    phase="normalizing",
    message="Обогащаем карточки данными WB",
    totalEstimate=total_for_progress,
  )
  for raw_card in raw_cards:
    key = raw_storefront_card_key(raw_card)
    if not key or key in seen or key in existing_keys:
      continue
    seen.add(key)
    deduped.append(enrich_storefront_raw_card_with_wb_public_details(raw_card, warnings))
    mpstats_store_import_update(job_id, loadedCount=existing_count + len(deduped))
    if len(deduped) >= remaining_needed:
      break

  cards = [mpstats_normalized_bootstrap_card(card) for card in deduped]
  portal_name = ""
  if selected_candidate and selected_candidate.get("kind") == "brand":
    portal_name = selected_candidate.get("path") or ""
  portal_name = portal_name or derive_wb_portal_name(cards)
  loaded_at = utc_now().isoformat()
  source_label = f"{selected_candidate.get('kind')}: {selected_candidate.get('path')}" if selected_candidate else ""
  return {
    "cards": cards,
    "raw_count": len(cards),
    "cursor": {},
    "tokenMeta": {},
    "stats": {
      "cardCount": len(cards),
      "workCount": 0,
      "problemCount": sum(1 for card in cards if int(card.get("issueCount") or 0) > 0),
      "sampleLimit": limit,
      "loadedAt": loaded_at,
      "portalName": portal_name,
      "source": "mpstats",
      "sourceLabel": source_label,
    },
    "manualBootstrap": {
      "status": "loaded" if cards else "empty",
      "cardCount": len(cards),
      "source": selected_candidate or {},
      "period": period,
      "warnings": audit_public_warnings(warnings),
      "loadedAt": loaded_at,
      "totalEstimate": total_estimate,
      "limit": target_limit,
      "existingCount": existing_count,
      "newCount": len(cards),
    },
  }


def mpstats_post_body_json(token, path, body=None, params=None, attempts=3):
  token = str(token or "").strip()
  if not token:
    raise MpstatsApiError(HTTPStatus.UNAUTHORIZED, "mpstats_token_missing", retryable=False)
  query = urlencode(params or {}, doseq=True)
  url = f"{MPSTATS_API_BASE.rstrip('/')}{path}{'?' + query if query else ''}"
  headers = {
    "X-Mpstats-TOKEN": token,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "OptiCards/0.1 audit",
  }
  data = json.dumps(body if isinstance(body, dict) else {}, ensure_ascii=False).encode("utf-8")

  for attempt in range(attempts):
    request = urlrequest.Request(url, data=data, headers=headers, method="POST")
    request_path = f"{path}{'?' + query if query else ''}"
    try:
      with urlrequest.urlopen(request, timeout=MPSTATS_CONNECT_TIMEOUT + MPSTATS_READ_TIMEOUT) as response:
        response_body = response.read().decode("utf-8")
        mpstats_usage_record("POST", request_path, status=f"ok-attempt-{attempt + 1}", http_status=response.getcode(), balance_remaining=mpstats_balance_from_headers(response.headers))
        return json.loads(response_body) if response_body else {}
    except urlerror.HTTPError as exc:
      response_body = exc.read().decode("utf-8", errors="replace")
      retry_after = parse_retry_after(exc.headers.get("Retry-After"))
      retryable = exc.code == 202 or exc.code == 429 or 500 <= exc.code < 600
      mpstats_usage_record("POST", request_path, status=f"error-attempt-{attempt + 1}", http_status=exc.code, balance_remaining=mpstats_balance_from_headers(exc.headers))
      if retryable and attempt < attempts - 1:
        time.sleep(retry_after if retry_after is not None else 0.75 * (2 ** attempt))
        continue
      raise MpstatsApiError(
        exc.code,
        mpstats_error_message(response_body, HTTPStatus(exc.code).phrase),
        retryable=retryable,
      ) from exc
    except (TimeoutError, urlerror.URLError) as exc:
      mpstats_usage_record("POST", request_path, status=f"timeout-attempt-{attempt + 1}", http_status=HTTPStatus.GATEWAY_TIMEOUT)
      if attempt < attempts - 1:
        time.sleep(0.75 * (2 ** attempt))
        continue
      raise MpstatsApiError(HTTPStatus.GATEWAY_TIMEOUT, "mpstats_request_timeout", retryable=True) from exc
    except json.JSONDecodeError as exc:
      raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_invalid_json", retryable=False) from exc

  raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_request_failed", retryable=True)


def audit_cache_get(key):
  cached = AUDIT_MARKET_CACHE.get(key)
  if not cached:
    return None
  if time.time() >= cached["expires"]:
    AUDIT_MARKET_CACHE.pop(key, None)
    return None
  return cached["payload"]


def audit_cache_set(key, payload, ttl=AUDIT_MARKET_CACHE_TTL_SECONDS):
  AUDIT_MARKET_CACHE[key] = {"payload": payload, "expires": time.time() + ttl}
  return payload


def audit_mpstats_get(token, path, warnings, cache_ttl=AUDIT_MARKET_CACHE_TTL_SECONDS):
  cache_key = f"GET:{path}"
  cached = audit_cache_get(cache_key)
  if cached is not None:
    mpstats_usage_record("GET", path, source="cache", status="hit")
    return cached
  try:
    return audit_cache_set(cache_key, mpstats_get_json(token, path, attempts=2), cache_ttl)
  except MpstatsApiError as exc:
    warnings.append(f"MPStats {path}: {exc.message}")
    return {}


def audit_mpstats_post(token, path, params, body, warnings, cache_ttl=AUDIT_MARKET_CACHE_TTL_SECONDS):
  cache_key = f"POST:{path}:{json.dumps(params or {}, sort_keys=True, ensure_ascii=False)}:{json.dumps(body or {}, sort_keys=True, ensure_ascii=False)}"
  cached = audit_cache_get(cache_key)
  if cached is not None:
    mpstats_usage_record("POST", path, source="cache", status="hit")
    return cached
  try:
    return audit_cache_set(cache_key, mpstats_post_body_json(token, path, body=body, params=params, attempts=2), cache_ttl)
  except MpstatsApiError as exc:
    warnings.append(f"MPStats {path}: {exc.message}")
    return {}


def audit_subject_path_from_info(*sources, fallback_subject_id=None):
  candidates = [fallback_subject_id]
  for info in sources:
    if not isinstance(info, dict):
      continue
    subject = info.get("subject") if isinstance(info.get("subject"), dict) else {}
    niche = info.get("niche") if isinstance(info.get("niche"), dict) else {}
    category = info.get("category") if isinstance(info.get("category"), dict) else {}
    candidates.extend([
      subject.get("id"),
      niche.get("id"),
      info.get("subject_id"),
      info.get("subjectId"),
      info.get("path"),
      info.get("subject_path"),
      info.get("subjectPath"),
      category.get("id"),
      category.get("path"),
    ])
  for candidate in candidates:
    text = audit_str(candidate)
    if text and text.isdigit():
      return int(text)
  return ""


def audit_public_warning_text(message):
  text = audit_str(message)
  if not text:
    return ""
  if (
    text.startswith("MPStats /analytics/v1/wb/subject/")
    or "MPStats niche path missing" in text
    or "Не удалось выбрать конкурентов из MPStats subject/items" in text
  ):
    return "Рыночный контекст MPStats по нише не загрузился: не удалось определить путь категории. Конкуренты, ценовые зоны и выводы по нише рассчитаны только по доступным данным карточки."
  if "Доли значений характеристик рассчитаны по MPStats/выборке" in text:
    return "MPStats-значения характеристик — статистическая подсказка по выборке ниши, не официальный справочник WB; перед публикацией специалист должен подтвердить релевантность."
  if "items/" in text and "/keywords" in text:
    return "SEO-запросы MPStats по карточке не загрузились. Рекомендации по заголовку и описанию нужно дополнительно сверить вручную."
  if "items/" in text and "/full" in text:
    return "Метрики продаж MPStats по карточке не загрузились. Выводы по динамике продаж и выкупу не использовались."
  if text.startswith("MPStats ") and "items/" in text:
    return "Данные MPStats по карточке загрузились не полностью. Аудит использовал доступные WB-данные и локальные правила."
  if text == "MPStats key missing" or "MPStats ключ не настроен" in text:
    return "MPStats не подключен или временно недоступен: аудит выполнен по WB snapshot и локальным правилам."
  if "characteristics-analysis" in text or "MPStats characteristics-analysis" in text:
    return "MPStats-подсказки характеристик не загрузились. Значения характеристик нужно сверить по WB и вручную."
  if text.startswith("WB CDN"):
    return "Публичный снимок карточки WB CDN не загрузился; использован сохраненный WB snapshot."
  if "WB справочник характеристик" in text:
    return "Справочник характеристик WB не загрузился. Лимиты и обязательность некоторых полей нужно проверить вручную."
  if "LLM refinement" in text or "LLM вернул" in text:
    return "LLM-переформулировка недоступна; показан базовый аудит по фактам без дополнительной текстовой обработки."
  return text


def audit_public_warnings(warnings, limit=8):
  return audit_unique((audit_public_warning_text(item) for item in warnings), limit=limit)


def audit_card_values_from_characteristic(item):
  if not isinstance(item, dict):
    return audit_unique([item])
  value = item.get("value")
  if value is None:
    value = item.get("values")
  if value is None:
    value = item.get("name") if not (item.get("charcID") or item.get("charcId") or item.get("charcName")) else ""
  if isinstance(value, list):
    raw_values = []
    for entry in value:
      if isinstance(entry, dict):
        raw_values.append(entry.get("value") or entry.get("name") or entry.get("charcName") or "")
      else:
        raw_values.append(entry)
    return audit_unique(raw_values)
  if isinstance(value, dict):
    return audit_card_values_from_characteristic(value)
  return audit_unique(re.split(r"[,;]+", str(value or "")))


def audit_card_characteristics(card):
  rows = []
  items = card.get("characteristics") if isinstance(card, dict) else []
  if not isinstance(items, list):
    return rows
  for index, item in enumerate(items):
    if isinstance(item, dict):
      name = audit_str(item.get("name") or item.get("charcName") or item.get("id") or item.get("charcID") or f"Характеристика {index + 1}")
      charc_id = item.get("charcID") or item.get("charcId") or item.get("id")
      unit_name = audit_str(item.get("unitName") or "")
    else:
      name = f"Характеристика {index + 1}"
      charc_id = None
      unit_name = ""
    rows.append({
      "key": f"charc:{charc_id}" if charc_id else f"charc-name:{audit_normalized(name)}",
      "charcId": charc_id,
      "name": name,
      "values": audit_card_values_from_characteristic(item),
      "unitName": unit_name,
    })
  return rows


def audit_meta_by_characteristic(subject_characteristics):
  output = {}
  for item in subject_characteristics if isinstance(subject_characteristics, list) else []:
    if not isinstance(item, dict):
      continue
    charc_id = item.get("charcID") or item.get("charcId")
    name = audit_str(item.get("name") or "")
    keys = []
    if charc_id:
      keys.append(f"charc:{charc_id}")
    if name:
      keys.append(f"charc-name:{audit_normalized(name)}")
    for key in keys:
      output[key] = item
  return output


def audit_characteristic_name_score(left, right):
  left_name = audit_normalized_characteristic_name(left)
  right_name = audit_normalized_characteristic_name(right)
  if not left_name or not right_name:
    return 0
  if left_name == right_name:
    return 1
  if audit_characteristic_alias_matches(left_name, right_name):
    return 0.96
  left_tokens = list(dict.fromkeys(audit_characteristic_name_tokens(left_name)))
  right_tokens = list(dict.fromkeys(audit_characteristic_name_tokens(right_name)))
  if not left_tokens or not right_tokens:
    return 0
  overlap = len([token for token in left_tokens if token in right_tokens])
  if not overlap:
    return 0
  overlap_tokens = {token for token in left_tokens if token in right_tokens}
  if overlap_tokens and overlap_tokens.issubset(AUDIT_AMBIGUOUS_SINGLE_CHARACTERISTIC_TOKENS):
    return 0
  left_coverage = overlap / len(left_tokens)
  right_coverage = overlap / len(right_tokens)
  if "рукав" in left_tokens and "рукав" in right_tokens:
    return 0.9
  if (
    len(left_tokens) == 1
    and left_tokens[0] in right_tokens
    and left_tokens[0] not in AUDIT_AMBIGUOUS_SINGLE_CHARACTERISTIC_TOKENS
  ):
    return 0.82
  if left_coverage >= 0.66 and right_coverage >= 0.5:
    return 0.72 + min(left_coverage, right_coverage) * 0.18
  return 0


def audit_mpstats_matches(name, mpstats_characteristics):
  matches = []
  for item in mpstats_characteristics if isinstance(mpstats_characteristics, list) else []:
    score = audit_characteristic_name_score(name, item.get("name") if isinstance(item, dict) else "")
    if score >= 0.72:
      matches.append((score, item))
  return [item for _, item in sorted(matches, key=lambda pair: pair[0], reverse=True)]


def audit_mpstats_value_stats(name, mpstats_characteristics):
  by_value = {}
  for match in audit_mpstats_matches(name, mpstats_characteristics):
    for raw_value in match.get("values", []) if isinstance(match, dict) else []:
      if isinstance(raw_value, dict):
        value = audit_str(raw_value.get("value") or raw_value.get("name") or "")
        score = audit_number(raw_value.get("score"), 1)
      else:
        value = audit_str(raw_value)
        score = 1
      if not value:
        continue
      key = audit_normalized(value)
      current = by_value.get(key, {"value": value, "score": 0})
      current["score"] += max(0, score or 0)
      by_value[key] = current
  values = sorted(by_value.values(), key=lambda item: (-item["score"], item["value"].lower()))
  total = sum(item["score"] for item in values)
  for item in values:
    item["share"] = (item["score"] / total) if total > 0 else None
  return values


def audit_characteristic_limit(meta):
  if not isinstance(meta, dict):
    return None
  if audit_int(meta.get("charcType"), None) == 4:
    return 1
  max_count = audit_int(meta.get("maxCount"), 0)
  return max_count if max_count > 0 else None


def audit_promotion_relevant(meta, mpstats_matches):
  if isinstance(meta, dict) and any(bool(meta.get(key)) for key in ("required", "popular", "hasFilter", "isVariable")):
    return True
  return any(bool(item.get("promotionRelevant")) for item in mpstats_matches if isinstance(item, dict))


def audit_format_count(value):
  number = audit_number(value)
  if number is None:
    return ""
  return f"{int(number):,}".replace(",", " ")


def audit_position_value(*values):
  for value in values:
    number = audit_number(value)
    if number is not None and number > 0:
      return int(number) if float(number).is_integer() else number
  return None


def audit_keywords_from_payload(payload, limit=500):
  data = payload.get("data") if isinstance(payload, dict) else {}
  words = []
  if isinstance(data, dict) and isinstance(data.get("words"), list):
    words = data.get("words")
  elif isinstance(payload, dict) and isinstance(payload.get("words"), list):
    words = payload.get("words")
  else:
    words = audit_extract_list(payload)
  output = []
  for item in words:
    if not isinstance(item, dict):
      continue
    query = audit_str(item.get("query") or item.get("keyword") or item.get("word") or "")
    if not query:
      continue
    output.append({
      "query": query,
      "wbCount": audit_int(item.get("wb_count") or item.get("wbCount") or item.get("count"), 0),
      "orgPos": audit_position_value(
        item.get("avg_organic_position"),
        item.get("avgOrganicPosition"),
        item.get("orgPos"),
        item.get("organic_position"),
        item.get("organicPosition"),
        item.get("organic_pos"),
      ),
      "adPos": audit_position_value(
        item.get("avg_ad_position"),
        item.get("avgAdPosition"),
        item.get("adPos"),
        item.get("ad_position"),
        item.get("adPosition"),
        item.get("promo_position"),
        item.get("advert_position"),
      ),
      "avgPos": audit_position_value(
        item.get("avg_position"),
        item.get("avgPosition"),
        item.get("avgPos"),
        item.get("position"),
        item.get("rank"),
      ),
      "totalFound": audit_int(item.get("total_found") or item.get("totalFound"), 0),
    })
  output = sorted(output, key=lambda item: item["wbCount"], reverse=True)
  if limit is None:
    return output
  return output[: max(0, int(limit))]


def audit_keyword_entry(item, status, field):
  return {
    "query": item.get("query"),
    "wbCount": audit_int(item.get("wbCount"), 0),
    "orgPos": item.get("orgPos"),
    "adPos": item.get("adPos"),
    "avgPos": item.get("avgPos"),
    "totalFound": audit_int(item.get("totalFound"), 0),
    "status": status,
    "field": field,
  }


def audit_build_semantic_core(card, keywords):
  current_title = audit_str(card.get("title") or "")
  description = audit_str(card.get("description") or "", 7000)
  keywords = [item for item in keywords if isinstance(item, dict) and item.get("query")]
  current = []
  missing = []
  for item in keywords[:80]:
    in_title = audit_contains_semantic_content_query(current_title, item.get("query"))
    in_description = audit_contains_semantic_content_query(description, item.get("query"))
    if in_title or in_description:
      field = "title" if in_title else "description"
      if in_title and in_description:
        field = "title_description"
      current.append(audit_keyword_entry(item, "present", field))
    else:
      missing.append(audit_keyword_entry(item, "missing", ""))
  recommended = []
  for item in missing:
    wb_count = audit_int(item.get("wbCount"), 0)
    priority = semantic_frequency_priority(wb_count)
    recommended.append({
      **item,
      "priority": priority,
      "reason": (
        f"Частотный запрос {audit_format_count(wb_count)} показов/мес не найден в текущем контенте."
        if wb_count else "Запрос есть в MPStats, но не найден в текущем контенте."
      ),
    })
    if len(recommended) >= 40:
      break
  total_top = min(len(keywords), 12)
  present_top = sum(
    1 for item in keywords[:12]
    if audit_contains_semantic_content_query(current_title, item.get("query")) or audit_contains_semantic_content_query(description, item.get("query"))
  )
  coverage = round((present_top / total_top) * 100) if total_top else None
  reason = "MPStats SEO-запросы не получены; СЯ нужно собрать вручную."
  if total_top:
    reason = f"В текущем контенте найдено {present_top} из {total_top} топ-запросов MPStats."
    if recommended:
      reason += f" В работу стоит взять: {', '.join(item['query'] for item in recommended[:3])}."
  return {
    "coveragePercent": coverage,
    "current": current[:40],
    "missing": missing[:60],
    "recommended": recommended,
    "totalKeywords": len(keywords),
    "workKeywords": len(recommended),
    "reason": reason,
  }


def fetch_mpstats_keywords_core(card, force_refresh=False):
  nm_id = audit_str(card.get("nmID") or card.get("nmId") or card.get("id") or "")
  if not nm_id:
    raise ValueError("missing_nm_id")
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)

  period = mpstats_semantic_period_default()
  path = f"/analytics/v1/wb/items/{nm_id}/keywords"
  params = {"d1": period["d1"], "d2": period["d2"]}
  body = {"startRow": 0, "endRow": 500, "filterModel": {}, "sortModel": []}
  cache_key = f"POST:{path}:{json.dumps(params, sort_keys=True, ensure_ascii=False)}:{json.dumps(body, sort_keys=True, ensure_ascii=False)}"
  cached = None if force_refresh else audit_cache_get(cache_key)
  if cached is not None:
    mpstats_usage_record("POST", path, source="cache", status="hit")
    payload = cached
    cached_flag = True
  else:
    payload = mpstats_post_body_json(token, path, body=body, params=params, attempts=2)
    audit_cache_set(cache_key, payload, AUDIT_MARKET_CACHE_TTL_SECONDS)
    cached_flag = False

  keywords = audit_keywords_from_payload(payload, limit=500)
  semantic_core = audit_build_semantic_core(card, keywords)
  return {
    "source": "mpstats",
    "status": "loaded" if keywords else "empty",
    "nmID": nm_id,
    "period": period,
    "keywords": keywords,
    "semanticCore": semantic_core,
    "cached": cached_flag,
  }


def mpstats_expanding_seed_query(card, query):
  query = audit_str(query or "")
  if query:
    return query[:250]
  title = audit_str(card.get("title") or "")
  title_words = [word for word in re.split(r"\s+", title) if word]
  if title_words:
    return " ".join(title_words[:3])[:250]
  subject = audit_str(card.get("subjectName") or card.get("subject") or "")
  if "/" in subject:
    subject = subject.split("/")[-1].strip()
  return subject[:250]


def mpstats_expanding_add_seed(seeds, seen, value):
  seed = audit_str(value or "")
  key = audit_normalized(seed)
  if not seed or key in seen:
    return
  seen.add(key)
  seeds.append(seed[:250])


def mpstats_expanding_seed_queries(card, query):
  primary = mpstats_expanding_seed_query(card, query)
  if not primary:
    return []
  manual_query = audit_str(query or "")
  seeds = []
  seen = set()
  mpstats_expanding_add_seed(seeds, seen, primary)
  content_parts = [
    primary,
    card.get("title") or "",
    card.get("description") or "",
    card.get("subjectName") or card.get("subject") or "",
  ]
  for characteristic in card.get("characteristics") if isinstance(card.get("characteristics"), list) else []:
    if not isinstance(characteristic, dict):
      continue
    content_parts.append(characteristic.get("name") or "")
    values = characteristic.get("value")
    if isinstance(values, list):
      content_parts.extend(str(value) for value in values[:5])
    else:
      content_parts.append(str(values or ""))
  content = audit_normalized(" ".join(str(part or "") for part in content_parts))
  primary_is_sunglasses = "солнцезащит" in content or "солнечн" in content
  base = "солнцезащитные очки" if primary_is_sunglasses else "очки"
  card_is_glasses = "очк" in audit_normalized(" ".join(str(part or "") for part in content_parts[1:]))
  primary_normalized = audit_normalized(primary)
  if manual_query and card_is_glasses and "очк" not in primary_normalized:
    mpstats_expanding_add_seed(seeds, seen, f"{base} {primary}")
  if re.search(r"\bкошк|\bкошач|cat\s*eye", content):
    mpstats_expanding_add_seed(seeds, seen, "очки кошачий глаз")
    if primary_is_sunglasses:
      mpstats_expanding_add_seed(seeds, seen, "солнцезащитные очки кошачий глаз")
  if "квадрат" in content:
    mpstats_expanding_add_seed(seeds, seen, f"{base} квадратные")
  if "поляризац" in content or "поляризацион" in content:
    mpstats_expanding_add_seed(seeds, seen, f"{base} поляризационные")
  if "авиатор" in content:
    mpstats_expanding_add_seed(seeds, seen, f"{base} авиаторы")
  return seeds[:6]


def mpstats_expanding_query_relevant(card, query, seed_queries):
  content = audit_normalized(" ".join([
    " ".join(seed_queries or []),
    card.get("title") or "",
    card.get("description") or "",
    card.get("subjectName") or card.get("subject") or "",
  ]))
  normalized_query = audit_normalized(query)
  if "очк" in content:
    return "очк" in normalized_query
  return True


def normalize_mpstats_expanding_query(item):
  if not isinstance(item, dict):
    return None
  query = audit_str(item.get("word") or item.get("query") or "")
  if not query:
    return None
  priority_subject = item.get("prioritySubject") if isinstance(item.get("prioritySubject"), dict) else {}
  return {
    "query": query,
    "cluster": audit_str(item.get("norm_query") or item.get("query_cluster") or ""),
    "prioritySubject": audit_str(priority_subject.get("name") or item.get("prioritySubject") or ""),
    "prioritySubjectId": priority_subject.get("id") or item.get("prioritySubjectId") or "",
    "wbCount": audit_int(item.get("wbcount") or item.get("wb_count"), 0),
    "ozonCount": audit_int(item.get("count"), 0),
    "results": audit_int(item.get("total") or item.get("items_count"), 0),
    "orgPos": audit_position_value(
      item.get("avg_organic_position"),
      item.get("avgOrganicPosition"),
      item.get("orgPos"),
      item.get("organic_position"),
      item.get("organicPosition"),
      item.get("organic_pos"),
    ),
    "adPos": audit_position_value(
      item.get("avg_ad_position"),
      item.get("avgAdPosition"),
      item.get("adPos"),
      item.get("ad_position"),
      item.get("adPosition"),
      item.get("promo_position"),
      item.get("advert_position"),
    ),
    "avgPos": audit_position_value(
      item.get("avg_position"),
      item.get("avgPosition"),
      item.get("avgPos"),
      item.get("rank"),
    ),
    "totalFound": audit_int(item.get("total_found") or item.get("totalFound"), 0),
    "frequency365": item.get("freq_365") or item.get("freq365") or "",
    "uniqueDays": audit_int(item.get("unique_days"), 0),
    "source": "mpstats-expanding",
  }


def fetch_mpstats_semantic_expansion(card, query="", force_refresh=False):
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    raise MpstatsApiError(HTTPStatus.CONFLICT, "mpstats_key_missing", retryable=False)
  seed_queries = mpstats_expanding_seed_queries(card, query)
  if not seed_queries:
    raise ValueError("missing_semantic_query")
  seed_query = seed_queries[0]

  period = mpstats_semantic_period_default()
  body = {
    "type": "keyword",
    "mp": 0,
    "queryData": seed_queries,
    "d1": period["d1"],
    "d2": period["d2"],
    "stopWords": [],
    "searchFullWord": False,
    "similar": False,
  }
  cache_key = f"POST:/seo/keywords/expanding/create-report:{json.dumps(body, sort_keys=True, ensure_ascii=False)}"
  cached = None if force_refresh else audit_cache_get(cache_key)
  if cached is not None:
    mpstats_usage_record("POST", "/seo/keywords/expanding/create-report", source="cache", status="hit")
    payload = cached
    cached_flag = True
  else:
    create_payload = mpstats_post_body_json(token, "/seo/keywords/expanding/create-report", body=body, attempts=2)
    report_hash = audit_str(create_payload.get("reportHash") or create_payload.get("result") or create_payload.get("hash") or "")
    if not report_hash:
      raise MpstatsApiError(HTTPStatus.BAD_GATEWAY, "mpstats_expanding_hash_missing", retryable=True)
    payload = None
    for attempt in range(18):
      poll_payload = mpstats_get_json(token, f"/seo/keywords/expanding/{report_hash}", attempts=1)
      if isinstance(poll_payload, dict) and isinstance(poll_payload.get("words"), list):
        payload = poll_payload
        break
      if attempt < 17:
        time.sleep(1.5 if attempt < 3 else 3)
    if payload is None:
      raise MpstatsApiError(HTTPStatus.ACCEPTED, "mpstats_expanding_report_not_ready", retryable=True)
    audit_cache_set(cache_key, payload, AUDIT_MARKET_CACHE_TTL_SECONDS)
    cached_flag = False

  rows = []
  seen = set()
  for item in payload.get("words") if isinstance(payload.get("words"), list) else []:
    normalized = normalize_mpstats_expanding_query(item)
    if not normalized:
      continue
    if not mpstats_expanding_query_relevant(card, normalized["query"], seed_queries):
      continue
    key = normalized["query"].lower()
    if key in seen:
      continue
    seen.add(key)
    rows.append(normalized)
  rows.sort(key=lambda item: (audit_int(item.get("wbCount"), 0), audit_int(item.get("ozonCount"), 0)), reverse=True)

  content = f"{audit_str(card.get('title') or '')} {audit_str(card.get('description') or '')}".strip()
  current = []
  recommended = []
  all_keywords = []
  for row in rows:
    target = {
      **row,
      "priority": semantic_frequency_priority(row.get("wbCount")),
    }
    all_keywords.append(target)
    if content and audit_contains_semantic_content_query(content, row.get("query")):
      current.append({**target, "field": "title_description", "status": "current"})
    else:
      recommended.append({**target, "reason": "найдено MPStats в расширении запросов"})

  subject_counts = {}
  for row in rows:
    subject = row.get("prioritySubject") or "Без предмета"
    item = subject_counts.setdefault(subject, {"name": subject, "count": 0, "wbCount": 0})
    item["count"] += 1
    item["wbCount"] += audit_int(row.get("wbCount"), 0)
  subject_options = sorted(subject_counts.values(), key=lambda item: (item["count"], item["wbCount"]), reverse=True)

  return {
    "source": "mpstats-expanding",
    "status": "loaded" if rows else "empty",
    "seedQuery": seed_query,
    "seedQueries": seed_queries,
    "period": period,
    "cached": cached_flag,
    "semanticCore": {
      "source": "mpstats-expanding",
      "seedQuery": seed_query,
      "seedQueries": seed_queries,
      "period": period,
      "current": current[:1000],
      "recommended": recommended[:5000],
      "missing": recommended[:5000],
      "allKeywords": all_keywords[:5000],
      "subjectOptions": subject_options[:200],
      "totalKeywords": len(rows),
      "coveragePercent": round((len(current) / len(rows)) * 100) if rows else None,
      "reason": "MPStats SEO расширение запросов собрано отдельным отчетом по стартовой фразе.",
    },
  }


def audit_normalize_subject_item(item):
  if not isinstance(item, dict):
    return None
  nm_id = item.get("id") or item.get("itemid") or item.get("nmId") or item.get("nmID")
  if not nm_id:
    return None
  price_metrics = mpstats_price_metrics(item)
  price = audit_positive_number(price_metrics.get("price"), default=0)
  discounted_price = audit_positive_number(
    price_metrics.get("discountedPrice"),
    price_metrics.get("walletPrice"),
    price_metrics.get("avgSalePrice"),
    price,
    default=0,
  )
  return {
    "nmId": nm_id,
    "title": audit_str(item.get("name") or item.get("title") or ""),
    "brand": audit_str(item.get("brand") or ""),
    "seller": audit_str(item.get("seller") or ""),
    "supplierId": item.get("supplier_id") or item.get("supplierId"),
    "price": price or discounted_price,
    "discountedPrice": discounted_price,
    "walletPrice": price_metrics.get("walletPrice"),
    "avgSalePrice": price_metrics.get("avgSalePrice"),
    "sales": audit_int(item.get("sales"), 0),
    "revenue": audit_number(item.get("revenue"), 0),
    "comments": audit_int(item.get("comments") or item.get("feedbacks"), 0),
    "rating": audit_number(item.get("rating"), None),
    "position": item.get("category_position") or item.get("position"),
    "balance": audit_number(item.get("balance"), 0),
    "salesPerDay": audit_number(item.get("sales_per_day") or item.get("salesPerDay"), 0),
    "lostProfit": audit_number(item.get("lost_profit") or item.get("lostProfit"), None),
  }


def audit_is_fake_market_item(item):
  sales = audit_number(item.get("sales"), 0) or 0
  balance = audit_number(item.get("balance"), 0) or 0
  sales_per_day = audit_number(item.get("salesPerDay"), 0) or 0
  comments = audit_number(item.get("comments"), 0) or 0
  price = audit_number(item.get("price"), 0) or 0
  revenue = audit_number(item.get("revenue"), 0) or 0
  if sales >= 999990 or balance >= 999990 or abs(sales_per_day - 32258) < 2:
    return True
  if sales >= 2000 and comments <= 0:
    return True
  if sales >= 1000 and comments <= sales * 0.005:
    return True
  if sales >= 1000 and price > 0 and revenue > 0:
    expected = price * sales
    if abs(revenue - expected) > expected * 0.75:
      return True
  return False


def audit_fetch_wb_cdn_card(nm_id, warnings):
  try:
    nm_int = int(nm_id)
  except (TypeError, ValueError):
    return {}
  vol = nm_int // 100000
  part = nm_int // 1000
  for basket in wb_public_basket_candidates(nm_int):
    url = f"https://basket-{basket:02d}.wbbasket.ru/vol{vol}/part{part}/{nm_int}/info/ru/card.json"
    try:
      request = urlrequest.Request(url, headers={"Accept": "application/json", "User-Agent": "OptiCards/0.1 audit-wb-cdn"})
      with urlrequest.urlopen(request, timeout=WB_CONNECT_TIMEOUT + WB_READ_TIMEOUT) as response:
        WB_PUBLIC_BASKET_CACHE[str(nm_int)] = basket
        return json.loads(response.read().decode("utf-8"))
    except (urlerror.HTTPError, urlerror.URLError, TimeoutError, json.JSONDecodeError):
      continue
  warnings.append(f"WB CDN card.json недоступен для {nm_id}")
  return {}


def audit_wb_cdn_characteristic_options(cdn_card):
  if not isinstance(cdn_card, dict):
    return []
  options = cdn_card.get("options")
  if isinstance(options, list) and options:
    return [item for item in options if isinstance(item, dict)]
  flattened = []
  grouped_options = cdn_card.get("grouped_options")
  if isinstance(grouped_options, list):
    for group in grouped_options:
      if not isinstance(group, dict):
        continue
      group_options = group.get("options")
      if isinstance(group_options, list):
        flattened.extend(item for item in group_options if isinstance(item, dict))
  return flattened


def audit_public_characteristic_rows(items):
  rows = []
  seen = set()
  for index, item in enumerate(items if isinstance(items, list) else []):
    if isinstance(item, dict):
      name = audit_str(item.get("name") or item.get("charcName") or item.get("id") or item.get("charcID") or f"Характеристика {index + 1}")
      value = "; ".join(audit_card_values_from_characteristic(item))
      charc_id = item.get("charcID") or item.get("charcId") or item.get("id")
      unit_name = audit_str(item.get("unitName") or item.get("unit_name") or "")
    else:
      name = f"Характеристика {index + 1}"
      value = audit_str(item)
      charc_id = None
      unit_name = ""
    key = audit_normalized(name)
    if not key or key in seen or not value:
      continue
    seen.add(key)
    row = {"name": name, "value": value}
    if charc_id:
      row["charcID"] = charc_id
    if unit_name:
      row["unitName"] = unit_name
    rows.append(row)
  return rows


def audit_merge_public_characteristics(card_characteristics, cdn_card):
  rows = []
  seen = set()

  def add_row(row):
    if not isinstance(row, dict):
      return
    name = audit_str(row.get("name") or row.get("charcName") or "")
    value = row.get("value") if "value" in row else row.get("values")
    values = audit_card_values_from_characteristic({"value": value})
    text = "; ".join(values)
    key = audit_normalized(name)
    if not key or key in seen or not text:
      return
    seen.add(key)
    output = {**row, "name": name, "value": text}
    output.pop("values", None)
    rows.append(output)

  for row in audit_public_characteristic_rows(card_characteristics):
    add_row(row)
  for row in audit_public_characteristic_rows(audit_wb_cdn_characteristic_options(cdn_card)):
    add_row(row)

  contents = audit_str(cdn_card.get("contents") if isinstance(cdn_card, dict) else "")
  if contents and "комплектация" not in seen:
    add_row({"name": "Комплектация", "value": contents})
  return rows


def audit_merge_card_content(card, cdn_card):
  if not isinstance(card, dict):
    card = {}
  if not isinstance(cdn_card, dict):
    cdn_card = {}
  selling = cdn_card.get("selling") if isinstance(cdn_card.get("selling"), dict) else {}
  title = audit_str(card.get("title") or cdn_card.get("imt_name") or cdn_card.get("imtName") or cdn_card.get("name") or "")
  description = audit_str(card.get("description") or cdn_card.get("description") or "", 7000)
  characteristics = audit_merge_public_characteristics(
    card.get("characteristics") if isinstance(card.get("characteristics"), list) else [],
    cdn_card,
  )
  return {
    **card,
    "title": title,
    "description": description,
    "brand": audit_str(card.get("brand") or selling.get("brand_name") or ""),
    "subjectID": card.get("subjectID") or card.get("subjectId"),
    "subjectName": audit_str(card.get("subjectName") or cdn_card.get("subj_name") or cdn_card.get("subject_name") or ""),
    "characteristics": characteristics,
  }


def audit_market_data(nm_id, subject_id, period, warnings):
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  if not token:
    warnings.append("MPStats ключ не настроен: аудит выполнен по WB snapshot и локальным правилам")
    return {"keywords": [], "stats": {}, "nicheItems": [], "brands": [], "priceSegmentation": {}, "season": {}, "info": {}}

  d1 = period.get("d1")
  d2 = period.get("d2")
  info = audit_mpstats_get(token, f"/analytics/v1/wb/items/{nm_id}", warnings, cache_ttl=86400)
  stats_payload = audit_mpstats_get(token, f"/analytics/v1/wb/items/{nm_id}/full?{urlencode({'d1': d1, 'd2': d2})}", warnings, cache_ttl=86400)
  keywords_payload = audit_mpstats_post(
    token,
    f"/analytics/v1/wb/items/{nm_id}/keywords",
    {"d1": d1, "d2": d2},
    {"startRow": 0, "endRow": 500, "filterModel": {}, "sortModel": []},
    warnings,
    cache_ttl=86400,
  )
  subject_params = {"d1": d1, "d2": d2}
  if subject_id:
    subject_params["subject_id"] = subject_id
  subject_path = audit_subject_path_from_info(info, stats_payload, fallback_subject_id=subject_id)
  niche_path_missing = not bool(subject_path)
  subject_body = {"startRow": 0, "endRow": 300, "filterModel": {}, "sortModel": [{"colId": "revenue", "sort": "desc"}]}
  if subject_path:
    subject_params["path"] = subject_path
    subject_items_payload = audit_mpstats_post(token, "/analytics/v1/wb/subject/items", subject_params, subject_body, warnings)
    brands_payload = audit_mpstats_post(token, "/analytics/v1/wb/subject/brands", subject_params, subject_body, warnings)
    price_payload = audit_mpstats_post(token, "/analytics/v1/wb/subject/price_segmentation", subject_params, subject_body, warnings)
  else:
    warnings.append("MPStats niche path missing")
    subject_items_payload = {}
    brands_payload = {}
    price_payload = {}
  season_payload = audit_mpstats_get(token, f"/analytics/v1/wb/subject/season_effects/annual?{urlencode({'path': subject_path})}", warnings, cache_ttl=30 * 86400) if subject_path else {}

  stats = stats_payload.get("period_stats") if isinstance(stats_payload, dict) else {}
  if not isinstance(stats, dict):
    stats = stats_payload if isinstance(stats_payload, dict) else {}
  niche_items = [
    item for item in (audit_normalize_subject_item(row) for row in audit_extract_list(subject_items_payload))
    if item and not audit_is_fake_market_item(item)
  ]
  return {
    "info": info if isinstance(info, dict) else {},
    "stats": stats,
    "keywords": audit_keywords_from_payload(keywords_payload),
    "nicheItems": sorted(niche_items, key=lambda item: audit_number(item.get("revenue"), 0) or 0, reverse=True)[:80],
    "nichePathMissing": niche_path_missing,
    "subjectPath": subject_path,
    "brands": audit_extract_list(brands_payload)[:30],
    "priceSegmentation": price_payload if isinstance(price_payload, dict) else audit_extract_list(price_payload),
    "season": season_payload if isinstance(season_payload, dict) else audit_extract_list(season_payload),
  }


def audit_competitor_ids_from_payload(value, limit=3):
  raw_items = value if isinstance(value, list) else re.split(r"[\s,;]+", str(value or ""))
  output = []
  seen = set()
  for item in raw_items:
    raw_value = (item.get("url") or item.get("competitorNmID") or item.get("nmID") or item.get("nmId")) if isinstance(item, dict) else item
    competitor_nm_id = parse_competitor_nm_id(raw_value)
    if not competitor_nm_id or competitor_nm_id in seen:
      continue
    seen.add(competitor_nm_id)
    output.append(competitor_nm_id)
    if len(output) >= limit:
      break
  return output


def audit_subject_name_from_payload(payload):
  if not isinstance(payload, dict):
    return ""
  for key in ("subjectName", "subject_name", "entity", "categoryName", "category"):
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
      return audit_str(value)
  for key in ("subject", "niche", "category"):
    value = payload.get(key)
    if isinstance(value, dict):
      name = audit_str(value.get("name") or value.get("title") or value.get("item") or "")
      if name:
        return name
  return ""


def audit_named_value(value):
  if isinstance(value, dict):
    return audit_str(value.get("name") or value.get("title") or value.get("item") or value.get("value") or "")
  return audit_str(value)


def audit_card_price(card, market_data):
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  for value in (
    card.get("discountedPrice"),
    card.get("price"),
    raw_fields.get("discountedPrice"),
    raw_fields.get("price"),
    market_data.get("info", {}).get("final_price") if isinstance(market_data.get("info"), dict) else None,
    market_data.get("info", {}).get("price") if isinstance(market_data.get("info"), dict) else None,
    market_data.get("stats", {}).get("final_price") if isinstance(market_data.get("stats"), dict) else None,
    market_data.get("stats", {}).get("price") if isinstance(market_data.get("stats"), dict) else None,
  ):
    price = audit_number(value, None)
    if price and price > 0:
      return price
  return None


def audit_token_overlap_score(left, right):
  left_tokens = set(audit_tokens(left))
  right_tokens = set(audit_tokens(right))
  if not left_tokens or not right_tokens:
    return 0
  overlap = len(left_tokens & right_tokens)
  return overlap / max(1, min(len(left_tokens), len(right_tokens)))


def audit_tokens_with_stems(text, stems):
  tokens = set(audit_tokens(text))
  output = set()
  for token in tokens:
    for stem in stems:
      if token.startswith(stem):
        output.add(stem)
  return output


def audit_characteristics_text(characteristics):
  parts = []
  rows = characteristics if isinstance(characteristics, list) else []
  for row in rows[:80]:
    if not isinstance(row, dict):
      parts.append(audit_str(row))
      continue
    parts.append(audit_str(row.get("name") or row.get("label") or ""))
    values = row.get("values")
    if values is None:
      values = row.get("value")
    if isinstance(values, list):
      parts.extend(audit_str(value) for value in values)
    else:
      parts.append(audit_str(values))
  return " ".join(part for part in parts if part)


def audit_commercial_text(item):
  if not isinstance(item, dict):
    return ""
  raw_fields = item.get("rawFields") if isinstance(item.get("rawFields"), dict) else {}
  characteristics = item.get("characteristics") if isinstance(item.get("characteristics"), list) else raw_fields.get("characteristics")
  return " ".join(
    audit_str(part)
    for part in (
      item.get("title"),
      item.get("name"),
      item.get("brand"),
      item.get("subjectName"),
      item.get("subject"),
      item.get("seller"),
      raw_fields.get("title"),
      raw_fields.get("subjectName"),
      audit_characteristics_text(characteristics),
    )
    if audit_str(part)
  )


def audit_commercial_traits(item):
  text = audit_commercial_text(item)
  normalized = audit_normalized(text)
  gender = set()
  if re.search(r"\b(жен|женск|женщин|девуш)", normalized):
    gender.add("женский")
  if re.search(r"\b(муж|мужск)", normalized):
    gender.add("мужской")
  if re.search(r"\b(унисекс)", normalized):
    gender.add("унисекс")
  age = set()
  if re.search(r"\b(дет|детск|ребен|малыш|девоч|мальч)", normalized):
    age.add("детский")
  elif gender:
    age.add("взрослый")
  product = audit_tokens_with_stems(
    normalized,
    {
      "пижам",
      "халат",
      "сороч",
      "комплект",
      "костюм",
      "брюк",
      "шорт",
      "футбол",
      "лонгслив",
      "рубаш",
      "плать",
      "топ",
      "майк",
      "боди",
      "свитшот",
      "толстов",
    },
  )
  materials = audit_tokens_with_stems(
    normalized,
    {
      "хлоп",
      "трикот",
      "рибана",
      "кулир",
      "футер",
      "вискоз",
      "полиэстер",
      "сатин",
      "шелк",
      "шёлк",
      "флис",
      "велюр",
      "муслин",
      "лен",
      "лён",
    },
  )
  return {
    "gender": gender,
    "age": age,
    "product": product,
    "materials": materials,
  }


def audit_trait_overlap(left, right, key):
  left_values = left.get(key) or set()
  right_values = right.get(key) or set()
  if not left_values or not right_values:
    return set()
  if "унисекс" in left_values or "унисекс" in right_values:
    return {"унисекс"}
  return left_values & right_values


def audit_trait_conflict(left, right, key):
  left_values = left.get(key) or set()
  right_values = right.get(key) or set()
  if not left_values or not right_values:
    return False
  if key == "gender" and ("унисекс" in left_values or "унисекс" in right_values):
    return False
  return not bool(left_values & right_values)


def audit_manual_competitor_candidate(competitor_nm_id, period, warnings):
  competitor_nm_id = parse_competitor_nm_id(competitor_nm_id)
  snapshot = competitor_snapshot_from_sources(competitor_nm_id)
  token = get_service_integration_secret(MPSTATS_PROVIDER)
  info = {}
  full_payload = {}
  legacy_item_payload = {}
  legacy_item = {}
  legacy_full_payload = {}
  version_snapshot = {}
  version_rows = []
  if token:
    d1 = period.get("d1")
    d2 = period.get("d2")
    info = audit_mpstats_get(token, f"/analytics/v1/wb/items/{competitor_nm_id}", warnings, cache_ttl=86400)
    full_payload = audit_mpstats_get(token, f"/analytics/v1/wb/items/{competitor_nm_id}/full?{urlencode({'d1': d1, 'd2': d2})}", warnings, cache_ttl=86400)
    legacy_item_payload = audit_mpstats_get(token, f"/wb/get/item/{competitor_nm_id}", warnings, cache_ttl=86400)
    legacy_item = legacy_item_payload.get("item") if isinstance(legacy_item_payload.get("item"), dict) else {}
    legacy_full_payload = audit_mpstats_get(token, f"/wb/get/item/{competitor_nm_id}/full?{urlencode({'d1': d1, 'd2': d2})}", warnings, cache_ttl=86400)
    version_snapshot, version_rows = audit_mpstats_latest_full_page_snapshot(token, competitor_nm_id, warnings, cache_ttl=86400)
    photo_history = audit_mpstats_photo_history(token, competitor_nm_id, [], cache_ttl=86400)
  else:
    photo_history = []
  stats = full_payload.get("period_stats") if isinstance(full_payload, dict) else {}
  if not isinstance(stats, dict):
    stats = {}
  mpstats_prices = mpstats_price_metrics(info, full_payload, stats, legacy_item_payload, legacy_item, legacy_full_payload)
  photo_block = full_payload.get("photo") if isinstance(full_payload.get("photo"), dict) else {}
  subject_name = audit_subject_name_from_payload(legacy_full_payload) or audit_subject_name_from_payload(full_payload) or audit_subject_name_from_payload(info) or snapshot.get("subjectName") or ""
  description_length = version_snapshot.get("descriptionLength") or snapshot.get("descriptionLength") or 0
  description_preview = version_snapshot.get("descriptionPreview") or snapshot.get("descriptionPreview") or ""
  description_hash = version_snapshot.get("descriptionHash") or snapshot.get("descriptionHash") or ""
  characteristics = version_snapshot.get("characteristics") or snapshot.get("characteristics") or []
  candidate = {
    "nmId": competitor_nm_id,
    "title": snapshot.get("title") or version_snapshot.get("title") or audit_str(legacy_item.get("full_name") or legacy_item.get("name") or (info.get("name") if isinstance(info, dict) else "")),
    "brand": snapshot.get("brand") or audit_named_value(version_snapshot.get("brand") or legacy_item.get("brand") or legacy_full_payload.get("brand") or (info.get("brand") if isinstance(info, dict) else "")),
    "seller": audit_named_value(legacy_item.get("seller") or legacy_full_payload.get("seller") or (info.get("seller") if isinstance(info, dict) else "")),
    "price": audit_positive_number(
      snapshot.get("price"),
      mpstats_prices.get("price"),
      snapshot.get("discountedPrice"),
      mpstats_prices.get("discountedPrice"),
      default=0,
    ),
    "discountedPrice": audit_positive_number(
      snapshot.get("discountedPrice"),
      mpstats_prices.get("discountedPrice"),
      mpstats_prices.get("walletPrice"),
      mpstats_prices.get("avgSalePrice"),
      snapshot.get("price"),
      mpstats_prices.get("price"),
      default=0,
    ),
    "walletPrice": mpstats_prices.get("walletPrice"),
    "avgSalePrice": mpstats_prices.get("avgSalePrice"),
    "sales": audit_int(stats.get("sales"), 0),
    "revenue": audit_number(stats.get("revenue"), 0),
    "comments": snapshot.get("feedbacks") or audit_int(legacy_item.get("comments") or legacy_full_payload.get("comments") or (info.get("comments") if isinstance(info, dict) else None), 0),
    "rating": snapshot.get("rating") or audit_number(legacy_item.get("rating") or legacy_full_payload.get("rating") or (info.get("rating") if isinstance(info, dict) else None), None),
    "position": None,
    "balance": audit_number(stats.get("balance"), 0),
    "salesPerDay": audit_number(stats.get("sales_per_day") or stats.get("salesPerDay"), 0),
    "photosCount": snapshot.get("photosCount") or audit_int(photo_block.get("count"), 0),
    "photoChangedByMpstats": bool(photo_block.get("is_changed")),
    "photoHistory": photo_history,
    "lastPhotoChangedAt": photo_history[0].get("changedAt") if photo_history else "",
    "mpstatsVersion": version_snapshot.get("version") or snapshot.get("mpstatsVersion") or "",
    "mpstatsVersionAt": version_snapshot.get("changedAt") or snapshot.get("mpstatsVersionAt") or "",
    "mpstatsVersions": version_rows[:8] or snapshot.get("mpstatsVersions") or [],
    "mpstatsUpdatedAt": mpstats_date_iso(legacy_item.get("updated") or legacy_full_payload.get("updated") or snapshot.get("mpstatsUpdatedAt")),
    "descriptionLength": description_length,
    "descriptionPreview": description_preview,
    "descriptionHash": description_hash,
    "characteristics": audit_card_characteristics({"characteristics": characteristics}),
    "subjectName": subject_name,
    "subjectPath": audit_subject_path_from_info(info, full_payload, legacy_full_payload),
    "selectionSource": "manual",
    "source": "manual",
  }
  return candidate


def audit_competitor_selection_item(candidate, source, status="selected", reason="", reasons=None):
  nm_id = audit_str(candidate.get("nmId") or candidate.get("nmID") or "")
  return {
    "nmId": nm_id,
    "url": wb_public_card_url(nm_id),
    "title": audit_str(candidate.get("title") or ""),
    "brand": audit_str(candidate.get("brand") or ""),
    "subjectName": audit_str(candidate.get("subjectName") or ""),
    "price": audit_number(candidate.get("price"), None),
    "discountedPrice": audit_number(candidate.get("discountedPrice"), None),
    "sales": audit_int(candidate.get("sales"), 0),
    "revenue": audit_number(candidate.get("revenue"), 0),
    "rating": audit_number(candidate.get("rating"), None),
    "source": source,
    "status": status,
    "similarityScore": audit_int(candidate.get("similarityScore"), 0),
    "reason": audit_str(reason or candidate.get("whyRelevant") or ""),
    "reasons": audit_unique(reasons or candidate.get("similarityReasons") or [], limit=5),
  }


def audit_competitor_similarity(card, market_data, candidate):
  current_subject = audit_str(card.get("subjectName") or "")
  candidate_subject = audit_str(candidate.get("subjectName") or "")
  current_path = audit_str(market_data.get("subjectPath") or "")
  candidate_path = audit_str(candidate.get("subjectPath") or "")
  current_text = audit_commercial_text(card) or f"{card.get('title') or ''} {current_subject}"
  candidate_text = audit_commercial_text(candidate) or f"{candidate.get('title') or ''} {candidate_subject}"
  current_traits = audit_commercial_traits(card)
  candidate_traits = audit_commercial_traits(candidate)
  title_overlap = audit_token_overlap_score(current_text, candidate_text)
  score = 0
  reasons = []
  conflicts = []
  if current_path and candidate_path and current_path == candidate_path:
    score += 40
    reasons.append("тот же предмет MPStats")
  elif current_subject and candidate_subject and audit_normalized(current_subject) == audit_normalized(candidate_subject):
    score += 32
    reasons.append("та же категория WB")
  elif current_subject and candidate_subject and audit_token_overlap_score(current_subject, candidate_subject) >= 0.45:
    score += 22
    reasons.append("похожая категория")
  if title_overlap >= 0.45:
    score += 25
    reasons.append("похожее название")
  elif title_overlap >= 0.25:
    score += 15
    reasons.append("частично похожее название")

  product_overlap = audit_trait_overlap(current_traits, candidate_traits, "product")
  if product_overlap:
    score += 22
    reasons.append(f"тот же тип товара: {', '.join(sorted(product_overlap))}")
  elif audit_trait_conflict(current_traits, candidate_traits, "product"):
    score -= 18
    conflicts.append("другой тип товара")

  gender_overlap = audit_trait_overlap(current_traits, candidate_traits, "gender")
  if gender_overlap:
    score += 12
    reasons.append(f"тот же пол/сегмент: {', '.join(sorted(gender_overlap))}")
  elif audit_trait_conflict(current_traits, candidate_traits, "gender"):
    score -= 35
    conflicts.append("другой пол/сегмент")

  age_overlap = audit_trait_overlap(current_traits, candidate_traits, "age")
  if age_overlap:
    score += 10
    reasons.append(f"тот же возрастной сегмент: {', '.join(sorted(age_overlap))}")
  elif audit_trait_conflict(current_traits, candidate_traits, "age"):
    score -= 30
    conflicts.append("другой возрастной сегмент")

  material_overlap = audit_trait_overlap(current_traits, candidate_traits, "materials")
  if material_overlap:
    score += 8
    reasons.append(f"похожий материал: {', '.join(sorted(material_overlap)[:2])}")

  keyword_text = " ".join(item.get("query") or "" for item in market_data.get("keywords", [])[:6] if isinstance(item, dict))
  if keyword_text:
    keyword_overlap = audit_token_overlap_score(keyword_text, candidate_text)
    if keyword_overlap >= 0.35:
      score += 10
      reasons.append("попадает в поисковый спрос карточки")

  current_price = audit_card_price(card, market_data)
  candidate_price = audit_positive_number(candidate.get("discountedPrice"), candidate.get("price"), default=None)
  if current_price and candidate_price:
    ratio = min(current_price, candidate_price) / max(current_price, candidate_price)
    if ratio >= 0.75:
      score += 15
      reasons.append("близкая цена")
    elif ratio >= 0.45:
      score += 8
      reasons.append("смежный ценовой сегмент")
    else:
      score -= 12
      conflicts.append("сильно другой ценовой сегмент")
  if candidate.get("sales") or candidate.get("revenue") or candidate.get("comments"):
    score += 10
    reasons.append("есть рыночные метрики")
  reasons.extend(conflicts)
  return max(0, score), reasons


def audit_pick_competitors(nm_id, card, market_data, warnings, manual_competitors=None, period=None, manual_limit=3):
  competitors = []
  selection = {
    "manualRequested": audit_competitor_ids_from_payload(manual_competitors, limit=manual_limit),
    "manualAccepted": [],
    "manualRejected": [],
    "autoSelected": [],
    "finalCompetitors": [],
    "autoSkippedReason": "Автодобор отключен: используются только конкуренты, добавленные специалистом.",
    "method": "manual-only-specialist-v1",
  }
  seen = {str(nm_id)}
  period = period if isinstance(period, dict) else audit_period_default()
  for competitor_nm_id in selection["manualRequested"]:
    if competitor_nm_id in seen:
      reason = "Это текущая карточка или дубль в списке."
      selection["manualRejected"].append({
        "nmId": competitor_nm_id,
        "url": wb_public_card_url(competitor_nm_id),
        "source": "manual",
        "status": "rejected",
        "reason": reason,
        "reasons": [reason],
      })
      warnings.append(f"Конкурент WB {competitor_nm_id} не включен: {reason}")
      continue
    candidate = audit_manual_competitor_candidate(competitor_nm_id, period, warnings)
    score, reasons = audit_competitor_similarity(card, market_data, candidate)
    candidate["similarityScore"] = score
    candidate["similarityReasons"] = reasons
    conflicts = [item for item in reasons if item.startswith("друг") or item.startswith("сильно")]
    if score < 40 and conflicts:
      candidate["whyRelevant"] = f"Добавлен специалистом; есть риск нерелевантности: {', '.join(conflicts[:3])}."
    else:
      candidate["whyRelevant"] = f"Добавлен специалистом; проверка схожести: {', '.join(reasons[:3]) or 'данные сверены через MPStats'}."
    seen.add(competitor_nm_id)
    selection["manualAccepted"].append(audit_competitor_selection_item(candidate, "manual", "accepted", candidate["whyRelevant"], reasons))
    competitors.append(candidate)
    if len(competitors) >= manual_limit:
      break

  for competitor in competitors:
    if not competitor.get("descriptionLength") or not competitor.get("characteristics"):
      cdn_warnings = []
      cdn_card = audit_fetch_wb_cdn_card(competitor.get("nmId"), cdn_warnings)
      competitor["descriptionLength"] = len(audit_str(cdn_card.get("description") if isinstance(cdn_card, dict) else ""))
      competitor["characteristics"] = audit_card_characteristics(audit_merge_card_content({}, cdn_card))
  selection["finalCompetitors"] = [
    audit_competitor_selection_item(
      item,
      item.get("selectionSource") or item.get("source") or "manual",
      "selected",
      item.get("whyRelevant") or "",
      item.get("similarityReasons"),
    )
    for item in competitors[:manual_limit]
  ]
  selection["summary"] = {
    "requestedManual": len(selection["manualRequested"]),
    "acceptedManual": len(selection["manualAccepted"]),
    "rejectedManual": len(selection["manualRejected"]),
    "autoSelected": len(selection["autoSelected"]),
    "finalCount": len(selection["finalCompetitors"]),
  }
  return competitors, selection


AUDIT_TITLE_STOPWORDS = {
  "для",
  "без",
  "под",
  "над",
  "при",
  "или",
  "это",
  "как",
  "что",
  "женская",
  "женские",
  "женский",
  "мужская",
  "мужские",
  "мужской",
}


def audit_title_token_key(token):
  token = audit_normalized(token)
  if token.startswith("пижам"):
    return "пижам"
  if token.startswith("штан") or token.startswith("брюк"):
    return "брюк"
  if token.startswith("хлоп"):
    return "хлоп"
  if token.startswith("полоск"):
    return "полоск"
  if token.startswith("костюм"):
    return "костюм"
  return audit_stem_characteristic_token(token)


def audit_title_add_token(candidate, token, used_keys):
  token = audit_str(token)
  key = audit_title_token_key(token)
  if len(token) < 4 or token in AUDIT_TITLE_STOPWORDS or not key or key in used_keys:
    return candidate, False
  next_candidate = f"{candidate} {token}".strip()
  if len(next_candidate) > 60:
    return candidate, False
  used_keys.add(key)
  return next_candidate, True


def audit_title_candidate(card, keywords, competitors=None):
  current = audit_str(card.get("title") or "")
  subject = audit_str(card.get("subjectName") or "")
  brand = audit_str(card.get("brand") or "")
  base = current or subject or "Карточка WB"
  candidate_parts = audit_unique(re.split(r"\s+", base), limit=10)
  candidate = " ".join(candidate_parts)
  used_keys = {audit_title_token_key(token) for token in audit_tokens(candidate)}
  current_traits = audit_commercial_traits(card)
  current_text = audit_commercial_text(card)
  competitor_titles = [
    audit_str(item.get("title") or item.get("name") or "")
    for item in (competitors or [])[:5]
    if isinstance(item, dict)
  ]
  competitor_text = " ".join(competitor_titles)

  relevant_keywords = []
  for item in keywords[:20]:
    query = audit_str(item.get("query") if isinstance(item, dict) else "")
    if not query or audit_contains_phrase(candidate, query):
      continue
    query_traits = audit_commercial_traits({"title": query})
    if audit_trait_conflict(current_traits, query_traits, "gender") or audit_trait_conflict(current_traits, query_traits, "age"):
      continue
    if current_traits.get("product") and query_traits.get("product") and not audit_trait_overlap(current_traits, query_traits, "product"):
      continue
    overlap = audit_token_overlap_score(current_text, query)
    if overlap < 0.25 and not audit_trait_overlap(current_traits, query_traits, "product"):
      continue
    competitor_overlap = audit_token_overlap_score(competitor_text, query) if competitor_text else 0
    demand = audit_int(item.get("wbCount"), 0) if isinstance(item, dict) else 0
    relevant_keywords.append((competitor_overlap, overlap, demand, query))

  relevant_keywords.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
  for _, _, _, query in relevant_keywords:
    for token in audit_tokens(query):
      candidate, _ = audit_title_add_token(candidate, token, used_keys)
    if len(candidate) >= 52:
      break

  if brand and len(candidate) + len(brand) + 1 <= 60 and not audit_contains_phrase(candidate, brand):
    candidate = f"{candidate} {brand}".strip()
  if len(candidate) > 60:
    candidate = candidate[:60].rsplit(" ", 1)[0].strip() or candidate[:60].strip()
  return candidate or current[:60]


def audit_title_change_reason(card, current_title, recommended_title, keywords, competitors):
  competitor_titles = [audit_str(item.get("title") or item.get("name") or "") for item in (competitors or [])[:5] if item.get("title") or item.get("name")]
  competitor_overlap = sum(1 for title in competitor_titles if audit_token_overlap_score(recommended_title, title) >= 0.35)
  if audit_normalized(current_title) == audit_normalized(recommended_title):
    competitor_part = f", сверив ее с {competitor_overlap} заголовками конкурентов" if competitor_overlap else ""
    return f"Заголовок оставлен без изменений: аудит проверил текущую формулировку{competitor_part} и не нашел релевантного усиления без потери смысла товара."
  current_keys = {audit_title_token_key(token) for token in audit_tokens(current_title)}
  used_tokens = [
    token
    for token in audit_tokens(recommended_title)
    if audit_title_token_key(token) not in current_keys
  ]
  keyword = next((item for item in keywords[:10] if isinstance(item, dict) and audit_contains_phrase(recommended_title, item.get("query"))), None)
  parts = []
  if used_tokens:
    parts.append(f"добавлены релевантные слова: {', '.join(audit_unique(used_tokens, limit=4))}")
  if keyword:
    parts.append(f"учтен поисковый запрос «{keyword.get('query')}»")
  if competitor_overlap:
    parts.append(f"сверено с {competitor_overlap} заголовками конкурентов")
  return "Аудит переписал заголовок: " + "; ".join(parts or ["сохранил товарную суть и усилил формулировку"]) + "."


AUDIT_DESCRIPTION_ADVICE_PATTERNS = (
  "добавьте",
  "раскройте",
  "опишите",
  "проверьте",
  "у ближайших конкурентов",
  "у текущей карточки",
)


def audit_description_contains_advice(text):
  normalized = audit_normalized(text)
  return any(pattern in normalized for pattern in AUDIT_DESCRIPTION_ADVICE_PATTERNS)


def audit_clean_description_text(text):
  paragraphs = [part.strip() for part in re.split(r"\n{2,}", audit_str(text, 7000)) if part.strip()]
  output = []
  for paragraph in paragraphs:
    normalized = audit_normalized(paragraph)
    if any(normalized.startswith(pattern) for pattern in AUDIT_DESCRIPTION_ADVICE_PATTERNS):
      continue
    output.append(paragraph)
  return "\n\n".join(output).strip()


def audit_current_characteristic_values(characteristic_recommendations):
  values = []
  for item in characteristic_recommendations if isinstance(characteristic_recommendations, list) else []:
    if not isinstance(item, dict):
      continue
    values.extend(item.get("currentValues") or [])
  return audit_unique(values, limit=8)


def audit_description_keyword_sentence(keyword_phrases):
  phrases = audit_unique(keyword_phrases, limit=3)
  if not phrases:
    return ""
  if len(phrases) == 1:
    return f"Модель также подходит покупателям, которые ищут {phrases[0]}."
  return f"Модель также подходит покупателям, которые ищут: {', '.join(phrases)}."


def audit_description_candidate(card, keywords, competitors, characteristic_recommendations):
  current = audit_clean_description_text(card.get("description") or "")
  title = audit_str(card.get("title") or card.get("subjectName") or "Товар")
  subject = audit_str(card.get("subjectName") or "")
  brand = audit_str(card.get("brand") or "")
  keyword_phrases = [item["query"] for item in keywords[:5] if item.get("query") and not audit_contains_phrase(current, item["query"])]
  details = audit_current_characteristic_values(characteristic_recommendations)
  keyword_sentence = audit_description_keyword_sentence(keyword_phrases)
  if current and len(current) >= 350:
    if keyword_sentence and not audit_contains_phrase(current, keyword_sentence):
      return f"{current}\n\n{keyword_sentence}".strip()
    return current

  intro_parts = audit_unique([title, brand, subject], limit=3)
  intro = ". ".join(intro_parts)
  paragraphs = []
  if intro:
    paragraphs.append(f"{intro}.")
  if details:
    paragraphs.append(f"В карточке выделены ключевые свойства товара: {', '.join(details[:6])}.")
  paragraphs.append("Товар подходит для ежедневного использования, сна, отдыха дома и спокойных повседневных сценариев.")
  if keyword_sentence:
    paragraphs.append(keyword_sentence)
  generated = "\n\n".join(part for part in paragraphs if part)
  if current:
    return f"{current}\n\n{generated}".strip()
  return generated.strip()


def audit_description_change_reason(description, recommended_description, missing_keywords, competitor_lengths):
  if not description:
    return "Аудит написал описание заново по фактам карточки, категории и доступным поисковым запросам MPStats."
  changes = []
  if len(description) < 350:
    changes.append(f"расширил короткое описание с {len(description)} знаков")
  if missing_keywords:
    changes.append(f"добавил релевантные поисковые формулировки: {', '.join(item['query'] for item in missing_keywords[:3])}")
  if competitor_lengths:
    changes.append(f"учел глубину описаний конкурентов: до {max(competitor_lengths)} знаков")
  if audit_normalized(description) == audit_normalized(recommended_description):
    return "Описание оставлено без переписывания: критичных подтвержденных причин менять текст не найдено."
  return "Аудит переписал описание: " + "; ".join(changes or ["сделал текст более полным и структурированным"]) + "."


def audit_build_characteristics(card, subject_characteristics, mpstats_characteristics):
  rows = audit_card_characteristics(card)
  meta_by_key = audit_meta_by_characteristic(subject_characteristics)
  output = []
  draft = {}
  seen_keys = set()
  for row in rows:
    meta = meta_by_key.get(row["key"]) or meta_by_key.get(f"charc-name:{audit_normalized(row['name'])}") or {}
    stats = audit_mpstats_value_stats(row["name"], mpstats_characteristics)
    matches = audit_mpstats_matches(row["name"], mpstats_characteristics)
    current_values = row["values"]
    current_set = {audit_normalized(value) for value in current_values}
    limit = audit_characteristic_limit(meta)
    recommended = []
    for item in stats:
      if audit_normalized(item["value"]) not in current_set:
        recommended.append(item["value"])
      if limit and len(current_values) + len(recommended) >= limit:
        break
      if not limit and len(recommended) >= 3:
        break
    is_relevant = audit_promotion_relevant(meta, matches)
    priority = "high" if recommended and is_relevant else "medium" if recommended else "low"
    top_values = [
      {"value": item["value"], "share": item["share"], "source": "mpstats"}
      for item in stats[:5]
    ]
    reason = ""
    if recommended and top_values:
      formatted = ", ".join(
        f"{item['value']} ({round((item['share'] or 0) * 100)}%)" if item.get("share") is not None else item["value"]
        for item in top_values[:3]
      )
      reason = f"MPStats по нише чаще показывает: {formatted}. У текущей карточки этих значений нет."
    elif not current_values:
      reason = "Характеристика пустая в WB snapshot; перед публикацией ее нужно проверить."
    else:
      reason = "Текущее значение заполнено; аудит оставил его как базу для ручной проверки."
    result_item = {
      "name": row["name"],
      "charcId": row["charcId"],
      "currentValues": current_values,
      "recommendedValues": recommended,
      "topCategoryValues": top_values,
      "isPromotionRelevant": is_relevant,
      "limit": limit,
      "reason": reason,
      "priority": priority,
    }
    output.append(result_item)
    next_values = audit_unique([*recommended, *current_values], limit=limit or 8)
    draft[row["key"]] = {
      "charcID": row["charcId"],
      "label": row["name"],
      "value": ", ".join(next_values),
      "values": next_values,
      "source": "audit",
      "reason": reason,
      "unitName": row.get("unitName") or (meta.get("unitName") if isinstance(meta, dict) else ""),
      "maxCount": meta.get("maxCount") if isinstance(meta, dict) else None,
      "charcType": meta.get("charcType") if isinstance(meta, dict) else None,
    }
    seen_keys.add(row["key"])

  for meta in subject_characteristics if isinstance(subject_characteristics, list) else []:
    if not isinstance(meta, dict):
      continue
    key = f"charc:{meta.get('charcID') or meta.get('charcId')}" if (meta.get("charcID") or meta.get("charcId")) else f"charc-name:{audit_normalized(meta.get('name'))}"
    if key in seen_keys or not (meta.get("required") or meta.get("popular") or meta.get("hasFilter")):
      continue
    stats = audit_mpstats_value_stats(meta.get("name"), mpstats_characteristics)
    if not stats and not meta.get("required"):
      continue
    limit = audit_characteristic_limit(meta)
    recommended = [item["value"] for item in stats[:limit or 3]]
    reason = "Поле есть в справочнике WB как важное/фильтруемое; аудит предлагает проверить заполнение."
    if stats:
      reason = f"Поле важно для категории; MPStats часто показывает значения: {', '.join(recommended[:3])}."
    result_item = {
      "name": audit_str(meta.get("name") or "Характеристика"),
      "charcId": meta.get("charcID") or meta.get("charcId"),
      "currentValues": [],
      "recommendedValues": recommended,
      "topCategoryValues": [{"value": item["value"], "share": item["share"], "source": "mpstats"} for item in stats[:5]],
      "isPromotionRelevant": True,
      "limit": limit,
      "reason": reason,
      "priority": "high" if meta.get("required") else "medium",
    }
    output.append(result_item)
    if recommended:
      draft[key] = {
        "charcID": result_item["charcId"],
        "label": result_item["name"],
        "value": ", ".join(recommended),
        "values": recommended,
        "source": "audit",
        "reason": reason,
        "unitName": meta.get("unitName") or "",
        "maxCount": meta.get("maxCount"),
        "charcType": meta.get("charcType"),
      }
  output.sort(key=lambda item: {"high": 0, "medium": 1, "low": 2}.get(item.get("priority"), 3))
  return output[:40], draft


def audit_build_result(card, market_data, competitors, characteristics, warnings, period):
  keywords = market_data.get("keywords", [])
  current_title = audit_str(card.get("title") or "")
  recommended_title = audit_title_candidate(card, keywords, competitors)
  missing_keywords = [item for item in keywords[:8] if not audit_contains_phrase(current_title, item.get("query"))]
  title_reason = audit_title_change_reason(card, current_title, recommended_title, keywords, competitors)
  title_priority = "low"
  if len(current_title) > 60:
    title_reason = "Название длиннее лимита WB 60 символов; аудит предлагает укоротить без потери предмета."
    title_priority = "high"
  elif audit_normalized(recommended_title) != audit_normalized(current_title):
    title_priority = "medium"

  description = audit_str(card.get("description") or "", 7000)
  recommended_description = audit_description_candidate(card, keywords, competitors, characteristics)
  competitor_lengths = [item.get("descriptionLength") for item in competitors if item.get("descriptionLength")]
  description_reason = audit_description_change_reason(description, recommended_description, missing_keywords, competitor_lengths)
  description_priority = "low"
  if not description:
    description_priority = "high"
  elif len(description) < 350:
    description_priority = "medium"
  elif missing_keywords:
    description_priority = "medium"

  current_subject = audit_str(card.get("subjectName") or market_data.get("info", {}).get("subject") or "")
  category_reason = "Предмет карточки совпадает с WB snapshot; смена категории не предлагается без подтверждения данными."
  confidence = 0.75
  if market_data.get("nicheItems"):
    category_reason = f"Ниша проверена по MPStats subject/items: найдено {len(market_data['nicheItems'])} карточек после фильтра аномалий."
    confidence = 0.9

  competitors_result = []
  for item in competitors[:CARD_COMPETITOR_LIMIT]:
    why = item.get("whyRelevant") or "Добавлен специалистом для ручного конкурентного сравнения."
    if item.get("sales") and "Продажи" not in why:
      why += f" Продажи: {audit_format_count(item.get('sales'))}."
    competitors_result.append({
      "nmId": item.get("nmId"),
      "url": f"https://www.wildberries.ru/catalog/{item.get('nmId')}/detail.aspx",
      "position": item.get("position"),
      "source": item.get("selectionSource") or item.get("source") or "manual",
      "similarityScore": item.get("similarityScore"),
      "whyRelevant": why,
    })

  high_characteristics = [item for item in characteristics if item.get("priority") == "high"]
  quick_wins = []
  if title_priority in {"high", "medium"} and recommended_title != current_title:
    quick_wins.append(f"Переписать заголовок по аудиту: {recommended_title}.")
  quick_wins.extend(
    f"Заполнить «{item['name']}»: {', '.join(item.get('recommendedValues') or [])}."
    for item in high_characteristics[:3]
    if item.get("recommendedValues")
  )
  main_problems = []
  if title_priority == "high":
    main_problems.append(title_reason)
  if high_characteristics:
    main_problems.append(f"{len(high_characteristics)} промо-значимых характеристик требуют проверки по MPStats/WB.")
  if description_priority in {"high", "medium"}:
    main_problems.append(description_reason)
  risk_notes = audit_public_warnings(warnings)
  if not market_data.get("keywords"):
    risk_notes.append("SEO-запросы MPStats не получены: заголовок и описание оценены по WB snapshot и локальным правилам.")
  if characteristics and any(item.get("topCategoryValues") for item in characteristics):
    risk_notes.append("MPStats-значения характеристик — статистическая подсказка по выборке ниши, не официальный справочник WB; перед публикацией специалист должен подтвердить релевантность.")
  risk_notes = audit_unique(risk_notes, limit=8)

  return {
    "category": {
      "current": current_subject or "Категория не указана",
      "recommended": current_subject or "Категория не указана",
      "confidence": confidence,
      "reason": category_reason,
    },
    "competitors": competitors_result,
    "title": {
      "current": current_title,
      "recommended": recommended_title,
      "reason": title_reason,
      "priority": title_priority,
    },
    "description": {
      "currentSummary": f"{len(description)} знаков" if description else "Описание пустое",
      "recommended": recommended_description,
      "reason": description_reason,
      "priority": description_priority,
    },
    "characteristics": characteristics,
    "summary": {
      "mainProblems": main_problems[:3] or ["Критичные проблемы не подтверждены данными; нужна ручная проверка специалиста."],
      "quickWins": quick_wins[:5] or ["Проверить черновик характеристик и сохранить подтвержденные значения."],
      "strategicRecommendations": [
        "Сравнить карточку с топом ниши по выручке и проверить цену, отзывы, фото и рекламные позиции отдельным этапом.",
        "Накопить историю аудитов по предмету, чтобы переиспользовать рабочие формулировки и значения характеристик.",
      ],
      "riskNotes": risk_notes,
    },
    "_meta": {
      "engine": "opticards-deterministic-sergey-v1",
      "period": period,
      "generatedAt": utc_now().isoformat(),
    },
  }


def audit_result_valid(payload):
  if not isinstance(payload, dict) or not all(key in payload for key in AUDIT_REQUIRED_KEYS):
    return False
  return (
    isinstance(payload.get("category"), dict)
    and isinstance(payload.get("title"), dict)
    and isinstance(payload.get("description"), dict)
    and isinstance(payload.get("summary"), dict)
    and isinstance(payload.get("competitors"), list)
    and isinstance(payload.get("characteristics"), list)
  )


def parse_llm_json_content(content):
  text = audit_str(content)
  if text.startswith("```"):
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
  try:
    return json.loads(text)
  except json.JSONDecodeError:
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
      return json.loads(text[start:end + 1])
    raise


def gigachat_urlopen(request, timeout):
  context = None if GIGACHAT_VERIFY_SSL else ssl._create_unverified_context()
  return urlrequest.urlopen(request, timeout=timeout, context=context)


def gigachat_access_token():
  now = time.time()
  cached_token = GIGACHAT_TOKEN_CACHE.get("accessToken")
  if cached_token and now < float(GIGACHAT_TOKEN_CACHE.get("expiresAt") or 0) - 60:
    return cached_token
  if not GIGACHAT_AUTH_KEY:
    raise RuntimeError("gigachat_auth_key_missing")
  data = urlencode({"scope": GIGACHAT_SCOPE}).encode("utf-8")
  request = urlrequest.Request(
    GIGACHAT_OAUTH_URL,
    data=data,
    headers={
      "Authorization": f"Basic {GIGACHAT_AUTH_KEY}",
      "RqUID": str(uuid.uuid4()),
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "OptiCards/0.1 gigachat-oauth",
    },
    method="POST",
  )
  with gigachat_urlopen(request, timeout=45) as response:
    payload = json.loads(response.read().decode("utf-8"))
  access_token = audit_str(payload.get("access_token") or payload.get("accessToken") or "")
  if not access_token:
    raise RuntimeError("gigachat_access_token_missing")
  expires_at = audit_number(payload.get("expires_at") or payload.get("expiresAt"), None)
  if expires_at and expires_at > 10_000_000_000:
    expires_at = expires_at / 1000
  if not expires_at:
    expires_at = now + 29 * 60
  GIGACHAT_TOKEN_CACHE["accessToken"] = access_token
  GIGACHAT_TOKEN_CACHE["expiresAt"] = expires_at
  return access_token


def audit_llm_chat_completion(messages):
  provider = OPTICARDS_LLM_PROVIDER
  if provider == "gigachat":
    access_token = gigachat_access_token()
    url = f"{GIGACHAT_API_BASE.rstrip('/')}/chat/completions"
    body = {
      "model": GIGACHAT_MODEL,
      "temperature": 0.2,
      "messages": messages,
    }
    request = urlrequest.Request(
      url,
      data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
      headers={
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "OptiCards/0.1 audit-gigachat",
      },
      method="POST",
    )
    with gigachat_urlopen(request, timeout=60) as response:
      return json.loads(response.read().decode("utf-8")), GIGACHAT_MODEL, "gigachat"

  token = audit_str(OPTICARDS_LLM_API_KEY)
  if not token:
    return None, "", provider or "openai"
  url = f"{OPTICARDS_LLM_API_BASE.rstrip('/')}/chat/completions"
  body = {
    "model": OPTICARDS_LLM_MODEL,
    "temperature": 0.2,
    "response_format": {"type": "json_object"},
    "messages": messages,
  }
  request = urlrequest.Request(
    url,
    data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    headers={
      "Authorization": f"Bearer {token}",
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "OptiCards/0.1 audit-llm",
    },
    method="POST",
  )
  with urlrequest.urlopen(request, timeout=45) as response:
    return json.loads(response.read().decode("utf-8")), OPTICARDS_LLM_MODEL, provider or "openai"


def audit_llm_refine(evidence, base_result, warnings):
  if OPTICARDS_LLM_PROVIDER == "gigachat" and not GIGACHAT_AUTH_KEY:
    return base_result
  if OPTICARDS_LLM_PROVIDER != "gigachat" and not audit_str(OPTICARDS_LLM_API_KEY):
    return base_result
  messages = [
    {"role": "system", "content": AUDIT_LLM_SYSTEM_PROMPT},
    {"role": "user", "content": json.dumps({"evidenceBundle": evidence, "baseResult": base_result}, ensure_ascii=False)},
  ]
  try:
    payload, model, provider = audit_llm_chat_completion(messages)
    if not payload:
      return base_result
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    refined = parse_llm_json_content(content)
    if not audit_result_valid(refined):
      warnings.append("LLM вернул неполный JSON: использован deterministic audit")
      return base_result
    refined_description = refined.get("description") if isinstance(refined.get("description"), dict) else {}
    refined_recommended = audit_str(refined_description.get("recommended") or "")
    if refined_recommended and audit_description_contains_advice(refined_recommended):
      warnings.append("LLM вернул совет вместо готового описания: использован deterministic description")
      refined["description"] = {
        **refined_description,
        "recommended": base_result.get("description", {}).get("recommended", ""),
        "reason": base_result.get("description", {}).get("reason", refined_description.get("reason", "")),
      }
    refined["_meta"] = {
      **(refined.get("_meta") if isinstance(refined.get("_meta"), dict) else {}),
      "engine": "opticards-llm-sergey-v1",
      "provider": provider,
      "model": model,
      "baseEngine": base_result.get("_meta", {}).get("engine"),
      "generatedAt": utc_now().isoformat(),
    }
    return refined
  except (RuntimeError, urlerror.HTTPError, urlerror.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as exc:
    warnings.append(f"LLM refinement недоступен: {type(exc).__name__}")
    return base_result


def content_keywords_from_payload(items, limit=80):
  output = []
  seen = set()
  for item in items if isinstance(items, list) else []:
    if isinstance(item, str):
      query = audit_str(item, 120)
      source = {}
    elif isinstance(item, dict):
      query = audit_str(item.get("query") or item.get("keyword") or item.get("text") or "", 120)
      source = item
    else:
      continue
    key = audit_normalized(query)
    if not query or key in seen:
      continue
    seen.add(key)
    output.append({
      "query": query,
      "cluster": audit_str(source.get("cluster") or "", 120) if isinstance(source, dict) else "",
      "prioritySubject": audit_str(source.get("prioritySubject") or "", 120) if isinstance(source, dict) else "",
      "wbCount": audit_int(source.get("wbCount"), 0) if isinstance(source, dict) else 0,
      "priority": audit_str(source.get("priority") or "", 20) if isinstance(source, dict) else "",
      "reason": audit_str(source.get("removalReason") or source.get("reason") or "", 160) if isinstance(source, dict) else "",
    })
    if len(output) >= limit:
      break
  return output


def content_reoptimization_configured():
  if OPTICARDS_LLM_PROVIDER == "gigachat":
    return bool(GIGACHAT_AUTH_KEY)
  return bool(audit_str(OPTICARDS_LLM_API_KEY))


def content_card_for_portal(portal_id, card_key, raw_card):
  card = raw_card if isinstance(raw_card, dict) else {}
  if portal_id and str(portal_id) != "demo-wb":
    init_db()
    with connect_db() as db:
      row = db.execute("SELECT cards_snapshot_json FROM portals WHERE id = ?", (int(portal_id),)).fetchone()
    snapshot_card = snapshot_card_lookup(row["cards_snapshot_json"] if row else "").get(card_key)
    if snapshot_card:
      card = snapshot_card
  return card


def build_card_content_reoptimization(portal_id, card_key, raw_card, selected_keywords=None, current_keywords=None, remove_keywords=None, draft=None):
  selected = content_keywords_from_payload(selected_keywords, limit=120)
  current = content_keywords_from_payload(current_keywords, limit=80)
  remove = content_keywords_from_payload(remove_keywords, limit=80)
  if not selected and not remove:
    raise ValueError("missing_semantic_keywords")
  if not content_reoptimization_configured():
    raise ValueError("llm_key_missing")

  card = content_card_for_portal(portal_id, card_key, raw_card)
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  draft = draft if isinstance(draft, dict) else {}
  draft_title = audit_str(draft.get("title") or draft.get("titleValue") or "", 200)
  draft_description = audit_str(draft.get("description") or draft.get("descriptionValue") or "", 7000)
  title = audit_str(card.get("title") or raw_fields.get("title") or "")
  description = audit_str(card.get("description") or raw_fields.get("description") or "", 7000)
  characteristics = audit_card_characteristics(card)[:80]
  evidence = {
    "card": {
      "nmId": audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or ""),
      "vendorCode": audit_str(card.get("vendorCode") or raw_fields.get("vendorCode") or ""),
      "brand": audit_str(card.get("brand") or raw_fields.get("brand") or ""),
      "subject": audit_str(card.get("subjectName") or raw_fields.get("subjectName") or ""),
      "title": title,
      "description": description,
      "characteristics": characteristics,
    },
    "draft": {
      "title": draft_title,
      "description": draft_description,
    },
    "semanticCore": {
      "selectedKeywords": selected,
      "currentKeywords": current,
      "removeKeywords": remove,
    },
    "constraints": {
      "titleMaxChars": 60,
      "descriptionMaxChars": 5000,
      "language": "ru",
    },
  }
  messages = [
    {"role": "system", "content": CONTENT_REOPTIMIZE_SYSTEM_PROMPT},
    {"role": "user", "content": json.dumps({"evidenceBundle": evidence}, ensure_ascii=False)},
  ]
  try:
    payload, model, provider = audit_llm_chat_completion(messages)
    if not payload:
      raise ValueError("llm_key_missing")
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = parse_llm_json_content(content)
    if not isinstance(parsed, dict):
      raise RuntimeError("llm_content_reoptimization_invalid_json")
  except (RuntimeError, urlerror.HTTPError, urlerror.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as exc:
    raise RuntimeError(f"llm_content_reoptimization_failed:{type(exc).__name__}") from exc

  title_block = parsed.get("title") if isinstance(parsed.get("title"), dict) else {}
  description_block = parsed.get("description") if isinstance(parsed.get("description"), dict) else {}
  next_title = content_title_limit(title_block.get("value") or title_block.get("recommended") or draft_title or title)
  next_description = audit_str(description_block.get("value") or description_block.get("recommended") or draft_description or description, 5000)
  if not next_title or not next_description:
    raise RuntimeError("llm_content_reoptimization_empty")

  combined_text = f"{next_title} {next_description}"
  used_keywords = [
    item["query"]
    for item in selected
    if audit_contains_phrase(combined_text, item["query"])
  ][:80]
  remove_keywords_still_present = [
    item["query"]
    for item in remove
    if audit_contains_phrase(combined_text, item["query"])
  ][:80]
  title_reason = audit_str(title_block.get("reason") or "Заголовок переписан с учетом выбранных запросов СЯ.", 500)
  description_reason = audit_str(description_block.get("reason") or "Описание переписано с учетом выбранных запросов СЯ.", 700)
  return {
    "draftContent": {
      "title": {
        "value": next_title,
        "source": "semantic",
        "reason": title_reason,
      },
      "description": {
        "value": next_description,
        "source": "semantic",
        "reason": description_reason,
      },
    },
    "contentOptimization": {
      "id": f"semantic-content-{int(time.time() * 1000)}",
      "createdAt": utc_now().isoformat(),
      "engine": "opticards-semantic-content-v1",
      "provider": provider,
      "model": model,
      "selectedKeywords": len(selected),
      "currentKeywords": len(current),
      "removeKeywords": len(remove),
      "usedKeywords": used_keywords,
      "unusedKeywords": [item["query"] for item in selected if item["query"] not in used_keywords][:80],
      "removeKeywordsStillPresent": remove_keywords_still_present,
      "titleLength": len(next_title),
      "descriptionLength": len(next_description),
      "warnings": parsed.get("_meta", {}).get("warnings", []) if isinstance(parsed.get("_meta"), dict) and isinstance(parsed.get("_meta", {}).get("warnings"), list) else [],
    },
  }


def competitor_for_reoptimization(portal_id, card_key, competitor_nm_id, user=None):
  try:
    numeric_portal_id = int(portal_id)
  except (TypeError, ValueError) as exc:
    raise ValueError("invalid_portal_id") from exc
  card_key = draft_card_key(card_key)
  competitor_nm_id = parse_competitor_nm_id(competitor_nm_id)
  if not card_key:
    raise ValueError("invalid_card_key")
  if not competitor_nm_id:
    raise ValueError("invalid_competitor")
  if user is not None and not user_can_access_portal(user, numeric_portal_id):
    raise PermissionError("forbidden")
  init_db()
  with connect_db() as db:
    row = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE portal_id = ? AND card_key = ? AND competitor_nm_id = ?
      """,
      (numeric_portal_id, card_key, competitor_nm_id),
    ).fetchone()
  if not row:
    raise ValueError("competitor_not_found")
  return numeric_portal_id, card_key, row


def build_card_competitor_reoptimization(portal_id, card_key, raw_card, competitor_nm_id, draft=None, user=None):
  numeric_portal_id, card_key, row = competitor_for_reoptimization(portal_id, card_key, competitor_nm_id, user=user)
  if not content_reoptimization_configured():
    raise ValueError("llm_key_missing")
  snapshot = safe_json_object(row["snapshot_json"])
  previous_snapshot = safe_json_object(row["previous_snapshot_json"])
  changes = safe_json_list(row["changed_fields_json"])
  review = safe_json_object(row["review_json"] if "review_json" in row.keys() else "{}")
  if not changes and isinstance(review.get("changes"), list):
    changes = review.get("changes")
  actionable = competitor_actionable_changes(changes)
  if not actionable:
    raise ValueError("missing_competitor_changes")

  card = content_card_for_portal(numeric_portal_id, card_key, raw_card)
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  draft = draft if isinstance(draft, dict) else {}
  draft_title = audit_str(draft.get("title") or draft.get("titleValue") or "", 200)
  draft_description = audit_str(draft.get("description") or draft.get("descriptionValue") or "", 7000)
  title = audit_str(card.get("title") or raw_fields.get("title") or "")
  description = audit_str(card.get("description") or raw_fields.get("description") or "", 7000)
  characteristics = audit_card_characteristics(card)[:80]
  evidence = {
    "card": {
      "nmId": audit_str(card.get("nmID") or card.get("nmId") or raw_fields.get("nmID") or ""),
      "vendorCode": audit_str(card.get("vendorCode") or raw_fields.get("vendorCode") or ""),
      "brand": audit_str(card.get("brand") or raw_fields.get("brand") or ""),
      "subject": audit_str(card.get("subjectName") or raw_fields.get("subjectName") or ""),
      "title": title,
      "description": description,
      "characteristics": characteristics,
    },
    "draft": {
      "title": draft_title,
      "description": draft_description,
    },
    "competitor": {
      "nmId": row["competitor_nm_id"],
      "title": snapshot.get("title") or "",
      "subject": snapshot.get("subjectName") or "",
      "price": snapshot.get("discountedPrice") or snapshot.get("price") or "",
      "previousSnapshot": {
        "title": previous_snapshot.get("title") or "",
        "price": previous_snapshot.get("discountedPrice") or previous_snapshot.get("price") or "",
        "descriptionLength": previous_snapshot.get("descriptionLength") or 0,
      },
      "changes": actionable,
      "summary": review.get("summary") or competitor_change_summary(actionable),
      "detectedAt": review.get("detectedAt") or competitor_change_detected_at(actionable, snapshot, row["last_checked_at"] or ""),
    },
    "constraints": {
      "titleMaxChars": 60,
      "descriptionMaxChars": 5000,
      "language": "ru",
    },
  }
  messages = [
    {"role": "system", "content": COMPETITOR_CHANGE_REOPTIMIZE_SYSTEM_PROMPT},
    {"role": "user", "content": json.dumps({"evidenceBundle": evidence}, ensure_ascii=False)},
  ]
  try:
    payload, model, provider = audit_llm_chat_completion(messages)
    if not payload:
      raise ValueError("llm_key_missing")
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = parse_llm_json_content(content)
    if not isinstance(parsed, dict):
      raise RuntimeError("llm_competitor_reoptimization_invalid_json")
  except (RuntimeError, urlerror.HTTPError, urlerror.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as exc:
    raise RuntimeError(f"llm_competitor_reoptimization_failed:{type(exc).__name__}") from exc

  title_block = parsed.get("title") if isinstance(parsed.get("title"), dict) else {}
  description_block = parsed.get("description") if isinstance(parsed.get("description"), dict) else {}
  next_title = content_title_limit(title_block.get("value") or title_block.get("recommended") or draft_title or title)
  next_description = audit_str(description_block.get("value") or description_block.get("recommended") or draft_description or description, 5000)
  if not next_title or not next_description:
    raise RuntimeError("llm_competitor_reoptimization_empty")
  return {
    "draftContent": {
      "title": {
        "value": next_title,
        "source": "competitor",
        "reason": audit_str(title_block.get("reason") or "Заголовок подготовлен с учетом изменений у конкурента.", 500),
      },
      "description": {
        "value": next_description,
        "source": "competitor",
        "reason": audit_str(description_block.get("reason") or "Описание подготовлено с учетом изменений у конкурента.", 700),
      },
    },
    "competitorChange": {
      "competitorNmID": row["competitor_nm_id"],
      "changeHash": review.get("changeHash") or competitor_change_hash(actionable),
      "detectedAt": review.get("detectedAt") or competitor_change_detected_at(actionable, snapshot, row["last_checked_at"] or ""),
      "summary": review.get("summary") or competitor_change_summary(actionable),
      "changes": actionable[:8],
    },
    "contentOptimization": {
      "id": f"competitor-content-{int(time.time() * 1000)}",
      "createdAt": utc_now().isoformat(),
      "engine": "opticards-competitor-content-v1",
      "provider": provider,
      "model": model,
      "changeFields": [item.get("field") for item in actionable if isinstance(item, dict)],
      "warnings": parsed.get("_meta", {}).get("warnings", []) if isinstance(parsed.get("_meta"), dict) and isinstance(parsed.get("_meta", {}).get("warnings"), list) else [],
    },
  }


def update_competitor_change_action(portal_id, card_key, competitor_nm_id, action, user):
  numeric_portal_id, card_key, row = competitor_for_reoptimization(portal_id, card_key, competitor_nm_id, user=user)
  action = audit_str(action)
  if action not in {"skip", "apply"}:
    raise ValueError("invalid_competitor_change_action")
  now_text = utc_now().isoformat()
  with connect_db() as db:
    current_row = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE id = ?
      """,
      (row["id"],),
    ).fetchone()
    if not current_row:
      raise ValueError("competitor_not_found")
    snapshot = safe_json_object(current_row["snapshot_json"])
    changes = safe_json_list(current_row["changed_fields_json"])
    review = safe_json_object(current_row["review_json"] if "review_json" in current_row.keys() else "{}")
    if not changes and isinstance(review.get("changes"), list):
      changes = review.get("changes")
    if not review.get("changeHash"):
      assignee = competitor_review_assignee(db, numeric_portal_id, current_row, user)
      review, _created = competitor_review_payload(review, changes, snapshot, current_row["last_checked_at"] or "", assignee)
    if not review.get("changeHash"):
      raise ValueError("missing_competitor_changes")
    status = "skipped" if action == "skip" else "applied"
    action_name = "competitor_change_skipped" if action == "skip" else "competitor_change_applied"
    summary = review.get("summary") or competitor_change_summary(changes)
    history = review.get("history") if isinstance(review.get("history"), list) else []
    review = {
      **review,
      "status": status,
      f"{status}At": now_text,
      f"{status}By": user["login"],
      "history": [
        {
          "action": status,
          "at": now_text,
          "userLogin": user["login"],
          "changeHash": review.get("changeHash"),
          "summary": summary,
        },
        *history[:19],
      ],
    }
    db.execute(
      """
      UPDATE card_competitors
      SET review_json = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      """,
      (
        json.dumps(review, ensure_ascii=False, separators=(",", ":")),
        user["login"],
        current_row["id"],
      ),
    )
    draft_row = db.execute(
      """
      SELECT payload_json
      FROM card_drafts
      WHERE portal_id = ? AND card_key = ?
      """,
      (numeric_portal_id, card_key),
    ).fetchone()
    if draft_row:
      try:
        payload = json.loads(draft_row["payload_json"])
      except (TypeError, json.JSONDecodeError):
        payload = normalize_card_draft_payload({})
      payload = normalize_card_draft_payload(payload)
      meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
      monitoring = meta.get("competitorMonitoring") if isinstance(meta.get("competitorMonitoring"), dict) else {}
      if monitoring.get("changeHash") == review.get("changeHash"):
        monitoring_history = monitoring.get("history") if isinstance(monitoring.get("history"), list) else []
        meta["competitorMonitoring"] = {
          **monitoring,
          "status": status,
          f"{status}At": now_text,
          f"{status}By": user["login"],
          "history": [
            {
              "action": status,
              "at": now_text,
              "userLogin": user["login"],
              "changeHash": review.get("changeHash"),
              "summary": summary,
            },
            *monitoring_history[:19],
          ],
        }
        payload["meta"] = meta
        db.execute(
          """
          UPDATE card_drafts
          SET payload_json = ?,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE portal_id = ? AND card_key = ?
          """,
          (
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            user["login"],
            numeric_portal_id,
            card_key,
          ),
        )
    insert_card_approval_event(
      db,
      numeric_portal_id,
      card_key,
      {
        "nmID": current_row["nm_id"],
        "vendorCode": current_row["vendor_code"],
        "status": "draft",
        "action": action_name,
        "actorLogin": user["login"],
        "assigneeLogin": review.get("assigneeLogin") or "",
        "reason": summary,
        "eventAt": now_text,
      },
    )
  return list_card_competitors(numeric_portal_id, card_key, user)


def audit_draft_from_result(result, characteristic_draft):
  title_result = result.get("title") if isinstance(result.get("title"), dict) else {}
  description_result = result.get("description") if isinstance(result.get("description"), dict) else {}
  characteristics = {key: {**value} for key, value in (characteristic_draft or {}).items()}
  for item in result.get("characteristics", []) if isinstance(result.get("characteristics"), list) else []:
    if not isinstance(item, dict):
      continue
    charc_id = item.get("charcId") or item.get("charcID")
    name = audit_str(item.get("name") or "Характеристика")
    key = f"charc:{charc_id}" if charc_id else f"charc-name:{audit_normalized(name)}"
    current_values = item.get("currentValues") if isinstance(item.get("currentValues"), list) else []
    recommended_values = item.get("recommendedValues") if isinstance(item.get("recommendedValues"), list) else []
    values = audit_unique([*recommended_values, *current_values], limit=audit_int(item.get("limit"), 0) or 8)
    if not values and key not in characteristics:
      continue
    existing = characteristics.get(key, {})
    characteristics[key] = {
      **existing,
      "charcID": charc_id or existing.get("charcID"),
      "label": name or existing.get("label"),
      "value": ", ".join(values) if values else existing.get("value", ""),
      "values": values or existing.get("values", []),
      "source": "audit",
      "reason": audit_str(item.get("reason") or existing.get("reason") or ""),
    }
  return {
    "title": {
      "value": audit_str(title_result.get("recommended") or title_result.get("current") or ""),
      "source": "audit",
      "reason": audit_str(title_result.get("reason") or ""),
    },
    "description": {
      "value": audit_str(description_result.get("recommended") or "", 7000),
      "source": "audit",
      "reason": audit_str(description_result.get("reason") or ""),
    },
    "characteristics": characteristics,
  }


def build_card_audit(portal_id, card_key, raw_card, subject_characteristics=None, mpstats_characteristics=None, period=None, audit_competitors=None):
  period = period if isinstance(period, dict) and period.get("d1") and period.get("d2") else audit_period_default()
  warnings = []
  _, mpstats_usage = mpstats_usage_start()
  card = raw_card if isinstance(raw_card, dict) else {}
  if portal_id and str(portal_id) != "demo-wb":
    init_db()
    with connect_db() as db:
      row = db.execute("SELECT cards_snapshot_json FROM portals WHERE id = ?", (int(portal_id),)).fetchone()
    snapshot_card = snapshot_card_lookup(row["cards_snapshot_json"] if row else "").get(card_key)
    if snapshot_card:
      card = snapshot_card
  raw_fields = card.get("rawFields") if isinstance(card.get("rawFields"), dict) else {}
  nm_id = card.get("nmID") or card.get("nmId") or card.get("nm_id") or raw_fields.get("nmID") or raw_fields.get("nmId")
  nm_id = audit_str(nm_id)
  if not nm_id:
    raise ValueError("missing_nm_id")
  cdn_card = audit_fetch_wb_cdn_card(nm_id, warnings)
  card = audit_merge_card_content(card, cdn_card)
  subject_id = card.get("subjectID") or card.get("subjectId")
  subject_characteristics = subject_characteristics if isinstance(subject_characteristics, list) else []
  if not subject_characteristics and portal_id and subject_id:
    try:
      wb_token, _ = get_wb_token_for_portal(portal_id)
      if wb_token:
        subject_characteristics = fetch_wb_subject_characteristics(wb_token, subject_id).get("characteristics", [])
    except (WbApiError, ValueError):
      warnings.append("WB справочник характеристик не получен")
  if not isinstance(mpstats_characteristics, list) or not mpstats_characteristics:
    try:
      mpstats_payload = fetch_mpstats_characteristics("subject", subject_id, num_top=300, min_cats=0, force_refresh=False, cache_only=False) if subject_id else {}
      mpstats_characteristics = mpstats_payload.get("characteristics", []) if isinstance(mpstats_payload, dict) else []
    except (MpstatsApiError, ValueError, RuntimeError):
      mpstats_characteristics = []
      warnings.append("MPStats characteristics-analysis не получен")

  market_data = audit_market_data(nm_id, subject_id, period, warnings)
  competitors, competitor_selection = audit_pick_competitors(
    nm_id,
    card,
    market_data,
    warnings,
    manual_competitors=audit_competitors,
    period=period,
  )
  characteristics, characteristic_draft = audit_build_characteristics(card, subject_characteristics, mpstats_characteristics)
  base_result = audit_build_result(card, market_data, competitors, characteristics, warnings, period)
  evidence = {
    "input": {
      "nmId": nm_id,
      "subjectId": subject_id,
      "period": period,
      "manualCompetitors": audit_competitor_ids_from_payload(audit_competitors),
    },
    "card": {
      "nmId": nm_id,
      "title": card.get("title"),
      "brand": card.get("brand"),
      "subject": card.get("subjectName"),
      "subjectId": subject_id,
      "descriptionLength": len(card.get("description") or ""),
      "characteristics": audit_card_characteristics(card),
    },
    "stats": market_data.get("stats"),
    "keywords": market_data.get("keywords"),
    "niche": {
      "topByRevenue": market_data.get("nicheItems", [])[:10],
      "brandsTop": market_data.get("brands", [])[:10],
      "priceSegmentation": market_data.get("priceSegmentation"),
    },
    "competitorSelection": competitor_selection,
    "competitors": competitors,
    "mpstatsCharacteristics": mpstats_characteristics[:80],
    "warnings": warnings,
  }
  result = audit_llm_refine(evidence, base_result, warnings)
  if result is not base_result:
    result["summary"]["riskNotes"] = audit_unique([*(result.get("summary", {}).get("riskNotes") or []), *audit_public_warnings(warnings)], limit=8)
  draft_content = audit_draft_from_result(result, characteristic_draft)
  changed_characteristics = sum(1 for item in draft_content.get("characteristics", {}).values() if item.get("source") == "audit")
  result_title = result.get("title") if isinstance(result.get("title"), dict) else {}
  mpstats_usage_summary = mpstats_usage_public(mpstats_usage)
  return {
    "auditResult": result,
    "draftContent": draft_content,
    "auditEntry": {
      "id": f"audit-{int(time.time() * 1000)}",
      "createdAt": utc_now().isoformat(),
      "engine": result.get("_meta", {}).get("engine", "opticards-audit"),
      "sourceInputs": ["wb_snapshot", "wb_cdn", "wb_subject_characteristics", "mpstats_market", "mpstats_characteristics", "llm_optional"],
      "mpstatsGroups": len(mpstats_characteristics),
      "mpstatsMatches": sum(1 for item in characteristics if item.get("topCategoryValues")),
      "mpstatsCredits": mpstats_usage_summary["creditsEstimate"],
      "mpstatsCacheHits": mpstats_usage_summary["cacheHits"],
      "competitors": len(competitors),
      "manualCompetitors": sum(1 for item in competitors if item.get("selectionSource") == "manual"),
      "competitorSelection": competitor_selection,
      "promotionRelevantCount": sum(1 for item in characteristics if item.get("isPromotionRelevant")),
      "changedCharacteristics": changed_characteristics,
      "content": {
        "titleChanged": audit_normalized(draft_content["title"]["value"]) != audit_normalized(result_title.get("current")),
        "descriptionChanged": True,
        "titleReason": draft_content["title"]["reason"],
        "descriptionReason": draft_content["description"]["reason"],
      },
      "summary": result.get("summary", {}),
      "status": "done" if not warnings else "partial",
    },
    "evidenceSummary": {
      "period": period,
      "keywords": len(market_data.get("keywords", [])),
      "competitors": len(competitors),
      "manualCompetitors": sum(1 for item in competitors if item.get("selectionSource") == "manual"),
      "competitorSelection": competitor_selection,
      "mpstatsCharacteristics": len(mpstats_characteristics),
      "mpstatsUsage": mpstats_usage_summary,
      "warnings": audit_public_warnings(warnings),
    },
    "mpstatsCharacteristics": mpstats_characteristics,
  }


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
  quality = "Достаточная"
  quality_class = "green"
  if len(issues) == 1:
    quality = "Есть пробел"
    quality_class = "amber"
  elif len(issues) > 1:
    quality = "Есть пробелы"
    quality_class = "red"

  status = "Без сигналов" if not issues else "Автосигнал"
  status_class = "green" if not issues else "amber"
  title = str(card.get("title") or "").strip() or str(card.get("vendorCode") or "Карточка WB")
  selling = card.get("selling") if isinstance(card.get("selling"), dict) else {}
  brand = (
    card.get("brand")
    or card.get("brandName")
    or card.get("brand_name")
    or selling.get("brand")
    or selling.get("brandName")
    or ""
  )
  seller_name = (
    card.get("seller")
    or card.get("sellerName")
    or card.get("supplier")
    or card.get("supplierName")
    or card.get("shopName")
    or card.get("storeName")
    or card.get("legalName")
    or ""
  )
  return {
    "nmID": card.get("nmID"),
    "imtID": card.get("imtID"),
    "nmUUID": card.get("nmUUID") or "",
    "vendorCode": card.get("vendorCode") or "",
    "title": title,
    "description": card.get("description") or "",
    "brand": brand or "",
    "sellerName": seller_name or "",
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


def wb_clean_portal_name(value):
  return str(value or "").strip()[:120]


def wb_seller_info_name(info):
  if not isinstance(info, dict):
    return ""
  for key in ("tradeMark", "trademark", "tradeName", "sellerName", "name"):
    name = wb_clean_portal_name(info.get(key))
    if name and name.lower() not in ("wildberries", "wb", "не указано"):
      return name
  return ""


def should_replace_portal_name(current_name, next_name):
  current = wb_clean_portal_name(current_name)
  next_value = wb_clean_portal_name(next_name)
  if not next_value:
    return False
  if not current:
    return True
  normalized = current.lower()
  return normalized in ("кабинет wb", "wildberries", "wb") or normalized.endswith(" wb")


def fetch_wb_seller_info(token):
  payload = wb_get_json(token, "/api/v1/seller-info", locale=None, attempts=1, base_url=WB_COMMON_API_BASE)
  return payload if isinstance(payload, dict) else {}


def derive_wb_portal_name(cards):
  seller = most_common_nonempty(
    card.get("sellerName")
    or card.get("seller")
    or card.get("supplier")
    or card.get("supplierName")
    or card.get("shopName")
    or card.get("storeName")
    for card in cards
  )
  if seller:
    return seller
  brand = most_common_nonempty(card.get("brand") or card.get("brandName") for card in cards)
  if brand:
    return brand
  subject = most_common_nonempty(card.get("subjectName") for card in cards)
  if subject:
    return f"{subject} WB"
  vendor_prefix = most_common_nonempty(str(card.get("vendorCode") or "").split("-", 1)[0] for card in cards)
  if vendor_prefix:
    return f"{vendor_prefix} WB"
  return "Wildberries"


def wb_int(value):
  try:
    if value is None or value == "":
      return None
    return int(value)
  except (TypeError, ValueError):
    return None


def wb_chunks(items, size):
  for index in range(0, len(items), size):
    yield items[index:index + size]


def wb_unique_ints(values):
  output = []
  seen = set()
  for value in values:
    number = wb_int(value)
    if number is None or number in seen:
      continue
    seen.add(number)
    output.append(number)
  return output


def wb_cards_nm_ids(cards):
  return wb_unique_ints(card.get("nmID") for card in cards)


def wb_cards_chrt_ids(cards):
  values = []
  for card in cards:
    for size in card.get("sizes") or []:
      if isinstance(size, dict):
        values.append(size.get("chrtID") or size.get("chrtId") or size.get("sizeID"))
  return wb_unique_ints(values)


def wb_warning(source, exc):
  status = exc.status if isinstance(exc.status, int) else HTTPStatus.BAD_GATEWAY
  return {
    "source": source,
    "status": int(status),
    "message": exc.message,
    "retryable": bool(exc.retryable),
  }


def fetch_wb_prices(token, nm_ids):
  prices = {}
  for nm_chunk in wb_chunks(wb_unique_ints(nm_ids), 1000):
    response = wb_request_json(
      token,
      "/api/v2/list/goods/filter",
      {"nmList": nm_chunk},
      locale=None,
      base_url=WB_PRICES_API_BASE,
    )
    for item in ((response.get("data") or {}).get("listGoods") or []):
      nm_id = wb_int(item.get("nmID") or item.get("nmId"))
      if nm_id is not None:
        prices[str(nm_id)] = public_wb_value(item)
  return prices


def fetch_wb_seller_warehouses(token):
  response = wb_get_json(token, "/api/v3/warehouses", locale=None, base_url=WB_MARKETPLACE_API_BASE)
  return response if isinstance(response, list) else []


def fetch_wb_marketplace_stocks(token, chrt_ids):
  stock_rows = []
  warehouses = fetch_wb_seller_warehouses(token)
  for warehouse in warehouses:
    if not isinstance(warehouse, dict):
      continue
    warehouse_id = wb_int(warehouse.get("id"))
    if warehouse_id is None:
      continue
    for chrt_chunk in wb_chunks(wb_unique_ints(chrt_ids), 1000):
      response = wb_request_json(
        token,
        f"/api/v3/stocks/{warehouse_id}",
        {"chrtIds": chrt_chunk},
        locale=None,
        base_url=WB_MARKETPLACE_API_BASE,
      )
      for row in response.get("stocks") or []:
        if not isinstance(row, dict):
          continue
        stock_rows.append({
          **public_wb_value(row),
          "warehouseId": warehouse_id,
          "warehouseName": warehouse.get("name") or "",
          "source": "seller_warehouse",
        })
  return stock_rows


def fetch_wb_analytics_wb_stocks(token, nm_ids, chrt_ids):
  rows = []
  nm_ids = wb_unique_ints(nm_ids)[:1000]
  if not nm_ids:
    return rows
  response = wb_request_json(
    token,
    "/api/analytics/v1/stocks-report/wb-warehouses",
    {
      "nmIds": nm_ids,
      "limit": 250000,
      "offset": 0,
    },
    locale=None,
    base_url=WB_ANALYTICS_API_BASE,
    attempts=2,
  )
  data = response.get("data") if isinstance(response, dict) else {}
  for row in (data or {}).get("items") or []:
    if isinstance(row, dict):
      rows.append({**public_wb_value(row), "source": "wb_warehouse"})
  return rows


def first_present(*values):
  for value in values:
    if value is not None and value != "":
      return value
  return ""


def wb_price_size_index(price_item):
  output = {}
  for size in price_item.get("sizes") or []:
    if not isinstance(size, dict):
      continue
    size_id = wb_int(size.get("sizeID") or size.get("chrtID") or size.get("chrtId"))
    if size_id is not None:
      output[str(size_id)] = size
  return output


def wb_stock_index(rows, amount_field):
  output = {}
  for row in rows:
    if not isinstance(row, dict):
      continue
    chrt_id = wb_int(row.get("chrtId") or row.get("chrtID"))
    if chrt_id is None:
      continue
    key = str(chrt_id)
    amount = wb_int(row.get(amount_field)) or 0
    current = output.setdefault(key, {"amount": 0, "warehouses": []})
    current["amount"] += amount
    current["warehouses"].append(row)
  return output


def enrich_wb_cards_with_commercial_data(cards, prices, seller_stock_rows, wb_stock_rows):
  seller_stocks = wb_stock_index(seller_stock_rows, "amount")
  wb_stocks = wb_stock_index(wb_stock_rows, "quantity")
  for card in cards:
    nm_key = str(card.get("nmID") or "")
    price_item = prices.get(nm_key) or {}
    price_sizes = wb_price_size_index(price_item)
    first_price_size = next((size for size in price_item.get("sizes") or [] if isinstance(size, dict)), {})
    card["price"] = first_present(card.get("price"), first_price_size.get("price"))
    card["discountedPrice"] = first_present(card.get("discountedPrice"), first_price_size.get("discountedPrice"))
    card["clubDiscountedPrice"] = first_present(card.get("clubDiscountedPrice"), first_price_size.get("clubDiscountedPrice"))
    card["discount"] = first_present(card.get("discount"), price_item.get("discount"))
    card["clubDiscount"] = first_present(card.get("clubDiscount"), price_item.get("clubDiscount"))
    card["currencyIsoCode4217"] = first_present(card.get("currencyIsoCode4217"), price_item.get("currencyIsoCode4217"))
    card["editableSizePrice"] = price_item.get("editableSizePrice")
    card["priceSizes"] = public_wb_value(price_item.get("sizes") or [])

    seller_total = 0
    wb_total = 0
    enriched_sizes = []
    for size in card.get("sizes") or []:
      if not isinstance(size, dict):
        enriched_sizes.append(size)
        continue
      chrt_id = wb_int(size.get("chrtID") or size.get("chrtId") or size.get("sizeID"))
      chrt_key = str(chrt_id) if chrt_id is not None else ""
      price_size = price_sizes.get(chrt_key) or {}
      seller_stock = seller_stocks.get(chrt_key, {"amount": 0, "warehouses": []})
      wb_stock = wb_stocks.get(chrt_key, {"amount": 0, "warehouses": []})
      seller_total += seller_stock["amount"]
      wb_total += wb_stock["amount"]
      enriched_sizes.append({
        **size,
        "price": first_present(size.get("price"), price_size.get("price")),
        "discountedPrice": first_present(size.get("discountedPrice"), price_size.get("discountedPrice")),
        "clubDiscountedPrice": first_present(size.get("clubDiscountedPrice"), price_size.get("clubDiscountedPrice")),
        "stock": seller_stock["amount"] + wb_stock["amount"],
        "sellerStock": seller_stock["amount"],
        "wbStock": wb_stock["amount"],
        "stockWarehouses": public_wb_value(seller_stock["warehouses"] + wb_stock["warehouses"]),
      })
    card["sizes"] = enriched_sizes
    card["sellerStock"] = seller_total
    card["wbStock"] = wb_total
    card["stock"] = seller_total + wb_total
  return cards


def fetch_wb_cards(token, max_cards=100):
  max_cards = max(1, min(int(max_cards), WB_MAX_CARDS_PER_SYNC))
  cards = []
  cursor = {"limit": min(100, max_cards)}
  seller_info = {}
  seller_info_warning = None

  try:
    seller_info = fetch_wb_seller_info(token)
  except WbApiError as exc:
    seller_info_warning = wb_warning("seller_info", exc)

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
  wb_warnings = []
  nm_ids = wb_cards_nm_ids(normalized_cards)
  chrt_ids = wb_cards_chrt_ids(normalized_cards)
  price_items = {}
  seller_stock_rows = []
  wb_stock_rows = []
  try:
    price_items = fetch_wb_prices(token, nm_ids)
  except WbApiError as exc:
    wb_warnings.append(wb_warning("prices", exc))
  try:
    seller_stock_rows = fetch_wb_marketplace_stocks(token, chrt_ids)
  except WbApiError as exc:
    wb_warnings.append(wb_warning("seller_stocks", exc))
  try:
    wb_stock_rows = fetch_wb_analytics_wb_stocks(token, nm_ids, chrt_ids)
  except WbApiError as exc:
    wb_warnings.append(wb_warning("wb_stocks", exc))
  if seller_info_warning:
    wb_warnings.append(seller_info_warning)
  normalized_cards = enrich_wb_cards_with_commercial_data(normalized_cards, price_items, seller_stock_rows, wb_stock_rows)
  problem_count = sum(1 for card in normalized_cards if card["issueCount"] > 0)
  work_count = problem_count
  seller_info_name = wb_seller_info_name(seller_info)
  portal_name = seller_info_name or derive_wb_portal_name(normalized_cards)
  return {
    "cards": normalized_cards,
    "raw_count": len(cards),
    "cursor": cursor,
    "tokenMeta": wb_token_meta(token),
    "commercialWarnings": wb_warnings,
    "stats": {
      "cardCount": len(normalized_cards),
      "workCount": work_count,
      "problemCount": problem_count,
      "sampleLimit": max_cards,
      "loadedAt": utc_now().isoformat(),
      "portalName": portal_name,
      "portalNameSource": "wb-seller-info" if seller_info_name else "wb-cards",
    },
  }


def wb_report_int(value, default=0):
  try:
    if value in (None, ""):
      return default
    return int(value)
  except (TypeError, ValueError):
    return default


def wb_report_number(value, default=0.0):
  try:
    if value in (None, ""):
      return default
    return float(value)
  except (TypeError, ValueError):
    return default


def wb_report_date(value):
  parsed = parse_iso_datetime(value)
  if parsed:
    return parsed.date()
  text = str(value or "").strip()
  if len(text) >= 10:
    try:
      return dt.date.fromisoformat(text[:10])
    except ValueError:
      return None
  return None


def wb_report_date_label(day):
  return day.strftime("%d.%m.%y")


def wb_report_iso(day):
  return day.isoformat()


def wb_report_parse_day(value):
  text = str(value or "").strip()
  if not text:
    return None
  try:
    return dt.date.fromisoformat(text[:10])
  except ValueError:
    return None


def wb_report_period_label(start_day, end_day):
  if start_day == end_day:
    return wb_report_date_label(end_day)
  return f"{start_day.strftime('%d.%m.%y')}-{end_day.strftime('%d.%m.%y')}"


def wb_report_range_label(start_day, end_day):
  return f"{start_day.strftime('%d.%m.%Y')} - {end_day.strftime('%d.%m.%Y')}"


def wb_report_periods(weeks=None, start=None, end=None):
  start_day = wb_report_parse_day(start)
  end_day = wb_report_parse_day(end)
  if start_day or end_day:
    if not start_day or not end_day or start_day > end_day:
      raise ValueError("invalid_report_period")
    if (end_day - start_day).days > 90:
      raise ValueError("report_period_too_long")
    return [{
      "index": 0,
      "label": wb_report_period_label(start_day, end_day),
      "start": wb_report_iso(start_day),
      "end": wb_report_iso(end_day),
      "rangeLabel": wb_report_range_label(start_day, end_day),
    }]

  try:
    weeks = int(weeks or WB_CLIENT_REPORT_WEEKS)
  except (TypeError, ValueError):
    weeks = WB_CLIENT_REPORT_WEEKS
  weeks = max(1, min(weeks, 12))
  end_day = utc_now().date() - dt.timedelta(days=1)
  periods = []
  for index in range(weeks):
    period_end = end_day - dt.timedelta(days=index * 7)
    period_start = period_end - dt.timedelta(days=6)
    periods.append({
      "index": index,
      "label": wb_report_date_label(period_end),
      "start": wb_report_iso(period_start),
      "end": wb_report_iso(period_end),
      "rangeLabel": wb_report_range_label(period_start, period_end),
    })
  return periods


def wb_report_previous_period(period):
  period_start = dt.date.fromisoformat(period["start"])
  period_end = dt.date.fromisoformat(period["end"])
  period_days = max(1, (period_end - period_start).days + 1)
  past_end = period_start - dt.timedelta(days=1)
  past_start = past_end - dt.timedelta(days=period_days - 1)
  return {
    "label": wb_report_period_label(past_start, past_end),
    "start": wb_report_iso(past_start),
    "end": wb_report_iso(past_end),
    "rangeLabel": wb_report_range_label(past_start, past_end),
  }


def wb_report_source(key, title, status, source, message="", records=None):
  payload = {
    "key": key,
    "title": title,
    "status": status,
    "source": source,
    "message": message,
  }
  if records is not None:
    payload["records"] = records
  return payload


def wb_report_source_error(key, title, source, exc):
  status = exc.status if isinstance(getattr(exc, "status", None), int) else HTTPStatus.BAD_GATEWAY
  return wb_report_source(
    key,
    title,
    "error",
    source,
    f"WB API {int(status)}: {getattr(exc, 'message', str(exc))}",
  )


def wb_report_nm_id(value):
  return wb_int(value.get("nmId") or value.get("nmID") or value.get("nm_id")) if isinstance(value, dict) else None


def wb_report_period_for_day(day, periods):
  if not day:
    return None
  for period in periods:
    start = dt.date.fromisoformat(period["start"])
    end = dt.date.fromisoformat(period["end"])
    if start <= day <= end:
      return period
  return None


def wb_report_empty_stat():
  return {
    "ordersCount": 0,
    "ordersSum": 0.0,
    "canceledCount": 0,
    "canceledSum": 0.0,
    "salesCount": 0,
    "salesSum": 0.0,
    "returnsCount": 0,
    "returnsSum": 0.0,
    "forPay": 0.0,
  }


def wb_report_stat_bucket(output, period_label, nm_id):
  return output.setdefault(period_label, {}).setdefault(str(nm_id), wb_report_empty_stat())


def wb_report_price_from_row(row, keys):
  for key in keys:
    value = row.get(key) if isinstance(row, dict) else None
    number = wb_report_number(value, None)
    if number is not None and number != 0:
      return number
  return 0.0


def wb_report_aggregate_orders(rows, periods, nm_ids):
  nm_set = {str(item) for item in wb_unique_ints(nm_ids)}
  output = {}
  matched = 0
  for row in rows if isinstance(rows, list) else []:
    if not isinstance(row, dict):
      continue
    nm_id = wb_report_nm_id(row)
    if nm_id is None or str(nm_id) not in nm_set:
      continue
    period = wb_report_period_for_day(wb_report_date(row.get("date")), periods)
    if not period:
      continue
    matched += 1
    bucket = wb_report_stat_bucket(output, period["label"], nm_id)
    amount = wb_report_price_from_row(row, ("finishedPrice", "priceWithDisc", "totalPrice"))
    if row.get("isCancel"):
      bucket["canceledCount"] += 1
      bucket["canceledSum"] += amount
    else:
      bucket["ordersCount"] += 1
      bucket["ordersSum"] += amount
  return output, matched


def wb_report_aggregate_sales(rows, periods, nm_ids):
  nm_set = {str(item) for item in wb_unique_ints(nm_ids)}
  output = {}
  matched = 0
  for row in rows if isinstance(rows, list) else []:
    if not isinstance(row, dict):
      continue
    nm_id = wb_report_nm_id(row)
    if nm_id is None or str(nm_id) not in nm_set:
      continue
    period = wb_report_period_for_day(wb_report_date(row.get("date")), periods)
    if not period:
      continue
    matched += 1
    bucket = wb_report_stat_bucket(output, period["label"], nm_id)
    amount = wb_report_price_from_row(row, ("priceWithDisc", "finishedPrice", "totalPrice"))
    for_pay = wb_report_number(row.get("forPay"), 0.0)
    sale_id = str(row.get("saleID") or row.get("saleId") or "").upper()
    if sale_id.startswith("R"):
      bucket["returnsCount"] += 1
      bucket["returnsSum"] += amount
    else:
      bucket["salesCount"] += 1
      bucket["salesSum"] += amount
      bucket["forPay"] += for_pay
  return output, matched


def fetch_wb_report_analytics(token, nm_ids, periods, sources):
  analytics = {period["label"]: {} for period in periods}
  nm_ids = wb_unique_ints(nm_ids)[:1000]
  if not nm_ids:
    sources.append(wb_report_source("analytics", "Воронка продаж", "skipped", "WB Analytics", "В кабинете нет nmID."))
    return analytics

  max_calls = max(0, min(int(WB_CLIENT_REPORT_ANALYTICS_MAX_CALLS), 6))
  calls = 0
  for index in range(0, len(periods), 2):
    if calls >= max_calls:
      break
    selected = periods[index]
    past = periods[index + 1] if index + 1 < len(periods) else wb_report_previous_period(selected)
    payload = {
      "selectedPeriod": {"start": selected["start"], "end": selected["end"]},
      "pastPeriod": {"start": past["start"], "end": past["end"]},
      "nmIds": nm_ids,
      "brandNames": [],
      "subjectIds": [],
      "tagIds": [],
      "skipDeletedNm": False,
      "orderBy": {"field": "openCard", "mode": "desc"},
      "limit": min(1000, len(nm_ids)),
      "offset": 0,
    }
    try:
      response = wb_request_json(
        token,
        "/api/analytics/v3/sales-funnel/products",
        payload,
        locale=None,
        base_url=WB_ANALYTICS_API_BASE,
        attempts=1,
      )
    except WbApiError as exc:
      sources.append(wb_report_source_error(
        f"analytics-{selected['label']}",
        f"Воронка продаж {selected['label']}",
        "WB Analytics",
        exc,
      ))
      if getattr(exc, "status", None) == 429:
        break
      calls += 1
      continue

    products = ((response.get("data") or {}).get("products") or []) if isinstance(response, dict) else []
    for item in products:
      if not isinstance(item, dict):
        continue
      product = item.get("product") if isinstance(item.get("product"), dict) else {}
      statistic = item.get("statistic") if isinstance(item.get("statistic"), dict) else {}
      nm_id = wb_report_nm_id(product)
      if nm_id is None:
        continue
      selected_stats = statistic.get("selected") if isinstance(statistic.get("selected"), dict) else {}
      past_stats = statistic.get("past") if isinstance(statistic.get("past"), dict) else {}
      comparison = statistic.get("comparison") if isinstance(statistic.get("comparison"), dict) else {}
      analytics.setdefault(selected["label"], {})[str(nm_id)] = {
        "product": public_wb_value(product),
        "selected": public_wb_value(selected_stats),
        "past": public_wb_value(past_stats),
        "comparison": public_wb_value(comparison),
        "sourceRole": "selectedPeriod",
      }
      if index + 1 < len(periods):
        analytics.setdefault(past["label"], {})[str(nm_id)] = {
          "product": public_wb_value(product),
          "selected": public_wb_value(past_stats),
          "comparison": {},
          "sourceRole": f"pastPeriod для {selected['label']}",
        }
    sources.append(wb_report_source(
      f"analytics-{selected['label']}",
      f"Воронка продаж {selected['label']} + {past['label']}",
      "ok",
      "WB Analytics",
      "Показы, переходы, корзина, заказы, локальность и доставка.",
      records=len(products),
    ))
    calls += 1

  covered = sum(1 for period in periods if analytics.get(period["label"]))
  if covered < len(periods):
    sources.append(wb_report_source(
      "analytics-limit",
      "Воронка продаж по старым неделям",
      "partial",
      "WB Analytics",
      f"Заполнено {covered} из {len(periods)} периодов. Остальные не запрошены из-за лимитов WB.",
    ))
  return analytics


def fetch_wb_report_orders(token, periods, nm_ids, sources):
  earliest = periods[-1]["start"]
  path = f"/api/v1/supplier/orders?{urlencode({'dateFrom': earliest, 'flag': 0})}"
  try:
    rows = wb_get_json(token, path, locale=None, base_url=WB_STATISTICS_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("statistics-orders", "Заказы", "WB Statistics", exc))
    return {}
  rows = rows if isinstance(rows, list) else []
  aggregated, matched = wb_report_aggregate_orders(rows, periods, nm_ids)
  sources.append(wb_report_source(
    "statistics-orders",
    "Заказы",
    "ok",
    "WB Statistics / supplier/orders",
    "Операционная выгрузка заказов, данные WB обновляет примерно раз в 30 минут.",
    records=matched,
  ))
  return aggregated


def fetch_wb_report_sales(token, periods, nm_ids, sources):
  earliest = periods[-1]["start"]
  path = f"/api/v1/supplier/sales?{urlencode({'dateFrom': earliest, 'flag': 0})}"
  try:
    rows = wb_get_json(token, path, locale=None, base_url=WB_STATISTICS_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("statistics-sales", "Продажи и возвраты", "WB Statistics", exc))
    return {}
  rows = rows if isinstance(rows, list) else []
  aggregated, matched = wb_report_aggregate_sales(rows, periods, nm_ids)
  sources.append(wb_report_source(
    "statistics-sales",
    "Продажи и возвраты",
    "ok",
    "WB Statistics / supplier/sales",
    "Операционная выгрузка продаж и возвратов; финальные сверки лучше делать по финансовому отчету WB.",
    records=matched,
  ))
  return aggregated


def wb_report_advert_ids(count_payload):
  advert_ids = []
  for group in (count_payload.get("adverts") or []) if isinstance(count_payload, dict) else []:
    if not isinstance(group, dict):
      continue
    status = wb_report_int(group.get("status"), 0)
    if status not in {7, 9, 11}:
      continue
    for item in group.get("advert_list") or []:
      advert_id = wb_int(item.get("advertId") if isinstance(item, dict) else None)
      if advert_id is not None:
        advert_ids.append(advert_id)
  return wb_unique_ints(advert_ids)


def fetch_wb_report_ads(token, periods, sources):
  result = {"campaigns": [], "stats": []}
  try:
    count_payload = wb_get_json(token, "/adv/v1/promotion/count", locale=None, base_url=WB_ADVERT_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("advert-campaigns", "Рекламные кампании", "WB Promotion", exc))
    return result
  result["campaigns"] = public_wb_value((count_payload.get("adverts") or []) if isinstance(count_payload, dict) else [])
  advert_ids = wb_report_advert_ids(count_payload)
  sources.append(wb_report_source(
    "advert-campaigns",
    "Рекламные кампании",
    "ok",
    "WB Promotion / promotion/count",
    "Список кампаний по статусам.",
    records=len(advert_ids),
  ))
  if not advert_ids or not periods:
    return result

  latest = periods[0]
  params = urlencode({
    "ids": ",".join(str(item) for item in advert_ids[:50]),
    "beginDate": latest["start"],
    "endDate": latest["end"],
  })
  try:
    stats = wb_get_json(token, f"/adv/v3/fullstats?{params}", locale=None, base_url=WB_ADVERT_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("advert-stats", f"Статистика рекламы {latest['label']}", "WB Promotion", exc))
    return result
  result["stats"] = public_wb_value(stats if isinstance(stats, list) else [])
  sources.append(wb_report_source(
    "advert-stats",
    f"Статистика рекламы {latest['label']}",
    "ok",
    "WB Promotion / fullstats",
    "Расход, показы, клики, заказы по рекламным кампаниям за последний период отчета.",
    records=len(result["stats"]),
  ))
  return result


def wb_promotion_id(item):
  if not isinstance(item, dict):
    return None
  return wb_int(item.get("id") or item.get("promotionID") or item.get("promotionId"))


def wb_promotion_details_map(details_payload):
  details = {}
  data = details_payload.get("data") if isinstance(details_payload, dict) else details_payload
  items = []
  if isinstance(data, dict):
    items = data.get("promotions") or data.get("details") or data.get("data") or []
  elif isinstance(data, list):
    items = data
  elif isinstance(details_payload, list):
    items = details_payload
  for item in items or []:
    if not isinstance(item, dict):
      continue
    promotion_id = wb_promotion_id(item)
    if promotion_id is not None:
      details[str(promotion_id)] = public_wb_value(item)
  return details


def fetch_wb_report_promotion_details(token, promotions, sources):
  promotion_ids = [item for item in (wb_promotion_id(row) for row in promotions) if item is not None]
  if not promotion_ids:
    return {}
  params = urlencode({"promotionIDs": promotion_ids[:100]}, doseq=True)
  try:
    payload = wb_get_json(token, f"/api/v1/calendar/promotions/details?{params}", locale=None, base_url=WB_PROMO_CALENDAR_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("promo-details", "Детали акций", "WB Prices and Discounts", exc))
    return {}
  details = wb_promotion_details_map(payload)
  sources.append(wb_report_source(
    "promo-details",
    "Детали акций",
    "ok" if details else "empty",
    "WB Prices and Discounts / calendar/promotions/details",
    "Периоды, типы и условия ближайших акций WB.",
    records=len(details),
  ))
  return details


def wb_report_promotion_nomenclature_items(payload):
  data = payload.get("data") if isinstance(payload, dict) else payload
  if isinstance(data, dict):
    return data.get("nomenclatures") or data.get("products") or data.get("items") or []
  if isinstance(data, list):
    return data
  return []


def fetch_wb_report_promotion_nomenclatures(token, promotion, details, nm_set, in_action, sources):
  promotion_id = wb_promotion_id(promotion)
  if promotion_id is None:
    return []
  detail = details.get(str(promotion_id), {}) if isinstance(details, dict) else {}
  params = urlencode({
    "promotionID": promotion_id,
    "inAction": "true" if in_action else "false",
    "limit": 1000,
    "offset": 0,
  })
  try:
    payload = wb_get_json(token, f"/api/v1/calendar/promotions/nomenclatures?{params}", locale=None, base_url=WB_PROMO_CALENDAR_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error(
      f"promo-nomenclatures-{promotion_id}-{'in' if in_action else 'out'}",
      f"Товары акции {promotion_id}",
      "WB Prices and Discounts",
      exc,
    ))
    return []
  rows = []
  for item in wb_report_promotion_nomenclature_items(payload):
    if not isinstance(item, dict):
      continue
    nm_id = wb_int(item.get("id") or item.get("nmID") or item.get("nmId"))
    if nm_set and nm_id not in nm_set:
      continue
    rows.append(public_wb_value({
      **item,
      "id": nm_id if nm_id is not None else item.get("id"),
      "inAction": bool(in_action),
      "promotionId": promotion_id,
      "promotionName": promotion.get("name") or detail.get("name") or "",
      "promotionType": promotion.get("type") or detail.get("type") or "",
      "promotionStart": promotion.get("startDateTime") or detail.get("startDateTime") or "",
      "promotionEnd": promotion.get("endDateTime") or detail.get("endDateTime") or "",
    }))
  return rows


def fetch_wb_report_promotions(token, periods, nm_ids, sources):
  start_day = dt.date.fromisoformat(periods[0]["end"]) if periods else utc_now().date()
  end_day = start_day + dt.timedelta(days=60)
  params = urlencode({
    "startDateTime": f"{start_day.isoformat()}T00:00:00Z",
    "endDateTime": f"{end_day.isoformat()}T23:59:59Z",
    "allPromo": "false",
    "limit": 100,
    "offset": 0,
  })
  try:
    payload = wb_get_json(token, f"/api/v1/calendar/promotions?{params}", locale=None, base_url=WB_PROMO_CALENDAR_API_BASE, attempts=1)
  except WbApiError as exc:
    sources.append(wb_report_source_error("promo-calendar", "Календарь акций", "WB Prices and Discounts", exc))
    return {"list": [], "details": {}, "nomenclatures": []}
  promotions = ((payload.get("data") or {}).get("promotions") or []) if isinstance(payload, dict) else []
  sources.append(wb_report_source(
    "promo-calendar",
    "Календарь акций",
    "ok",
    "WB Prices and Discounts / calendar/promotions",
    "Ближайшие доступные акции WB.",
    records=len(promotions),
  ))
  promotions = public_wb_value(promotions)
  details = fetch_wb_report_promotion_details(token, promotions, sources)
  max_promotions = max(0, min(WB_CLIENT_REPORT_PROMO_MAX, len(promotions)))
  nm_set = set(wb_unique_ints(nm_ids))
  nomenclatures = []
  for promotion in promotions[:max_promotions]:
    nomenclatures.extend(fetch_wb_report_promotion_nomenclatures(token, promotion, details, nm_set, True, sources))
    nomenclatures.extend(fetch_wb_report_promotion_nomenclatures(token, promotion, details, nm_set, False, sources))
  if len(promotions) > max_promotions:
    sources.append(wb_report_source(
      "promo-nomenclatures-limit",
      "Товары в акциях",
      "partial",
      "WB Prices and Discounts / calendar/promotions/nomenclatures",
      f"Проверены первые {max_promotions} из {len(promotions)} акций, чтобы не упереться в лимиты WB. Лимит меняется через WB_CLIENT_REPORT_PROMO_MAX.",
      records=len(nomenclatures),
    ))
  else:
    sources.append(wb_report_source(
      "promo-nomenclatures",
      "Товары в акциях",
      "ok" if nomenclatures else "empty",
      "WB Prices and Discounts / calendar/promotions/nomenclatures",
      "Участие и доступность товаров в ближайших акциях WB.",
      records=len(nomenclatures),
    ))
  return {
    "list": promotions,
    "details": details,
    "nomenclatures": public_wb_value(nomenclatures),
  }


def build_wb_client_report(portal_id, user, weeks=None, start=None, end=None):
  row = get_portal_row(portal_id, user)
  if not row:
    raise ValueError("portal_not_found")
  if not user_can_access_portal(user, portal_id):
    raise PermissionError("forbidden")

  cards = wb_snapshot_cards_from_row(row)
  nm_ids = wb_cards_nm_ids(cards)
  periods = wb_report_periods(weeks, start=start, end=end)
  sources = [
    wb_report_source(
      "snapshot",
      "Текущий снимок карточек",
      "ok" if cards else "empty",
      "OptiCards snapshot + WB Content/Prices/Marketplace",
      "Контент, текущие цены и остатки из последней загрузки кабинета.",
      records=len(cards),
    )
  ]

  token, token_source = get_wb_token_for_portal(portal_id)
  if not token:
    sources.append(wb_report_source("wb-token", "WB API ключ", "error", "OptiCards", "Для полного отчета нужен подключенный WB API."))
    return {
      "generatedAt": utc_now().isoformat(),
      "portal": public_portal_from_row(row),
      "tokenSource": token_source,
      "periods": periods,
      "cards": cards,
      "analyticsByPeriod": {},
      "ordersByPeriod": {},
      "salesByPeriod": {},
      "ads": {"campaigns": [], "stats": []},
      "promotions": {"list": [], "details": {}, "nomenclatures": []},
      "sources": sources,
    }

  analytics = fetch_wb_report_analytics(token, nm_ids, periods, sources)
  orders = fetch_wb_report_orders(token, periods, nm_ids, sources)
  sales = fetch_wb_report_sales(token, periods, nm_ids, sources)
  ads = fetch_wb_report_ads(token, periods, sources)
  promotions = fetch_wb_report_promotions(token, periods, nm_ids, sources)

  return {
    "generatedAt": utc_now().isoformat(),
    "portal": public_portal_from_row(row),
    "tokenSource": token_source,
    "periods": periods,
    "cards": public_wb_value(cards),
    "analyticsByPeriod": analytics,
    "ordersByPeriod": orders,
    "salesByPeriod": sales,
    "ads": ads,
    "promotions": promotions,
    "sources": sources,
  }


def clean_portal_team(raw_team):
  if not isinstance(raw_team, dict):
    return {}
  return {
    role: str(raw_team.get(role, "")).strip()
    for role in ("lead", "tech", "manager")
    if str(raw_team.get(role, "")).strip()
  }


def clean_portal_manual_text(value, max_length, error_code):
  text = str(value or "").strip()
  if len(text) > max_length:
    raise ValueError(error_code)
  return text


def clean_client_contact(raw_contact):
  contact = raw_contact if isinstance(raw_contact, dict) else {}
  return {
    "name": clean_portal_manual_text(contact.get("name"), 120, "client_contact_name_too_long"),
    "phone": clean_portal_manual_text(contact.get("phone"), 80, "client_contact_phone_too_long"),
    "email": clean_portal_manual_text(contact.get("email"), 160, "client_contact_email_too_long"),
    "comment": clean_portal_manual_text(contact.get("comment"), 1000, "client_contact_comment_too_long"),
  }


def client_contact_from_json(value):
  try:
    raw_contact = json.loads(value or "{}")
  except (TypeError, json.JSONDecodeError):
    raw_contact = {}
  if not isinstance(raw_contact, dict):
    raw_contact = {}
  return {
    "name": str(raw_contact.get("name") or "").strip()[:120],
    "phone": str(raw_contact.get("phone") or "").strip()[:80],
    "email": str(raw_contact.get("email") or "").strip()[:160],
    "comment": str(raw_contact.get("comment") or "").strip()[:1000],
  }


def public_portal_payload(portal_id, name, marketplace, mode, scope, team, snapshot=None, store_url="", manual_source="", client_name=""):
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
    "storeUrl": store_url if mode == "manual" else "",
    "manualSource": manual_source if mode == "manual" else "",
    "clientContact": client_contact_from_json("{}"),
    "clientName": client_name,
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

  def read_json(self, max_bytes=MAX_JSON_BYTES):
    try:
      length = int(self.headers.get("Content-Length", "0"))
    except ValueError:
      length = 0
    if length <= 0 or length > max_bytes:
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

    if path == "/api/admin-events":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      try:
        limit = int(query.get("limit", ["80"])[0])
      except ValueError:
        limit = 80
      try:
        self.send_json(HTTPStatus.OK, {"events": list_admin_events(user, limit=limit)})
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      return

    if path == "/api/admin-status":
      user = self.require_user()
      if not user:
        return
      try:
        self.send_json(HTTPStatus.OK, admin_system_status(user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      return

    if path == "/api/admin/mpstats-usage":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      try:
        limit = int(query.get("limit", ["1000"])[0])
      except ValueError:
        limit = 1000
      try:
        self.send_json(HTTPStatus.OK, mpstats_api_usage_report(user, limit=limit))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      return

    if path == "/api/portals":
      user = self.require_user()
      if not user:
        return
      rows = list_portals(user)
      task_summaries = portal_work_task_summaries([row["id"] for row in rows])
      self.send_json(
        HTTPStatus.OK,
        {"portals": [public_portal_from_row(row, task_summaries.get(int(row["id"]))) for row in rows]},
      )
      return

    if path.startswith("/api/portal-imports/"):
      user = self.require_user()
      if not user:
        return
      job_id = path[len("/api/portal-imports/"):].strip("/")
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not job_id or not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_import_status_request"})
        return
      try:
        result = get_mpstats_store_import_job(job_id, portal_id, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      if not result:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "import_job_not_found"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/integrations/mpstats":
      if not self.require_user():
        return
      self.send_json(HTTPStatus.OK, {"integration": get_service_integration(MPSTATS_PROVIDER)})
      return

    if path == "/api/approval-workflow":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      try:
        self.send_json(HTTPStatus.OK, approval_workflow(portal_id, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_id"})
      return

    if path == "/api/card-workset":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      try:
        self.send_json(HTTPStatus.OK, list_portal_workset(portal_id, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_id"})
      return

    if path.startswith("/api/portals/") and path.endswith("/ozon-tasks"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/ozon-tasks")].strip("/")
      try:
        self.send_json(HTTPStatus.OK, list_ozon_tasks(portal_id_text, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        error_text = str(exc) or "invalid_ozon_tasks"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
      return

    if path == "/api/portal-work-periods":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      try:
        self.send_json(HTTPStatus.OK, list_portal_work_periods(portal_id, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_id"})
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

    if path == "/api/portal-card-drafts":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      try:
        self.send_json(HTTPStatus.OK, list_portal_card_drafts(portal_id, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_id"})
      return

    if path == "/api/semantic-core-collections":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      if not portal_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      try:
        self.send_json(HTTPStatus.OK, list_semantic_core_collections(portal_id, user))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_id"})
      return

    if path == "/api/card-competitors":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      card_key = query.get("card_key", [""])[0]
      if not portal_id or not card_key:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_competitor_request"})
        return
      try:
        competitors = list_card_competitors(portal_id, card_key, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_competitor_request"})
        return
      self.send_json(HTTPStatus.OK, {"competitors": competitors})
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
        context_token = mpstats_call_context_start(user, "Карточка: подсказки характеристик MPStats", portal_id=portal_id, details={
          "reportType": report_type,
          "value": value,
          "numTop": num_top,
          "minCats": min_cats,
          "refresh": force_refresh,
          "cacheOnly": cache_only,
        })
        try:
          payload = fetch_mpstats_characteristics(report_type, value, num_top=num_top, min_cats=min_cats, force_refresh=force_refresh, cache_only=cache_only)
        finally:
          mpstats_call_context_stop(context_token)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mpstats_characteristics_request"})
        return
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      except MpstatsApiError as exc:
        if force_refresh:
          try:
            fallback_payload = fetch_mpstats_characteristics(
              report_type,
              value,
              num_top=num_top,
              min_cats=min_cats,
              force_refresh=False,
              cache_only=True,
            )
          except (ValueError, RuntimeError, MpstatsApiError):
            fallback_payload = None
          if fallback_payload and fallback_payload.get("cached") and fallback_payload.get("characteristics"):
            fallback_payload = {
              **fallback_payload,
              "status": "stale",
              "refreshError": {
                "status": exc.status,
                "message": exc.message,
                "retryable": exc.retryable,
              },
            }
            self.send_json(HTTPStatus.OK, fallback_payload)
            return
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

    if path.startswith("/api/portals/") and path.endswith("/wb-client-report"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/wb-client-report")].strip("/")
      if not user_can_access_portal(user, portal_id_text):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      query = parse_qs(parsed.query)
      try:
        weeks = int(query.get("weeks", [str(WB_CLIENT_REPORT_WEEKS)])[0])
      except ValueError:
        weeks = WB_CLIENT_REPORT_WEEKS
      start = query.get("start", [""])[0] or query.get("d1", [""])[0] or query.get("from", [""])[0]
      end = query.get("end", [""])[0] or query.get("d2", [""])[0] or query.get("to", [""])[0]
      try:
        report = build_wb_client_report(portal_id_text, user, weeks=weeks, start=start, end=end)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, {"report": report})
      return

    if path.startswith("/api/portals/") and path.endswith("/report-history"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/report-history")].strip("/")
      query = parse_qs(parsed.query)
      try:
        limit = int(query.get("limit", ["20"])[0])
      except ValueError:
        limit = 20
      try:
        history = list_report_history(portal_id_text, user, limit=limit)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, {"history": history})
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

  def do_DELETE(self):
    parsed = urlparse(self.path)
    path = parsed.path
    if path.startswith("/api/portals/"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      try:
        deleted = delete_portal(portal_id, actor=user)
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": error_text})
        return
      if not deleted:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"deleted": True, "portal": deleted})
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
      try:
        deleted = delete_card_draft(portal_id, card_key, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_draft"})
        return
      self.send_json(HTTPStatus.OK, {"deleted": deleted})
      return

    if path == "/api/semantic-core-collections":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      collection_id = query.get("collection_id", [""])[0] or query.get("id", [""])[0]
      if not portal_id or not collection_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_semantic_collection_request"})
        return
      try:
        deleted = delete_semantic_core_collection(portal_id, collection_id, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_semantic_collection"})
        return
      self.send_json(HTTPStatus.OK, {"deleted": deleted})
      return

    if path == "/api/portal-work-periods":
      user = self.require_user()
      if not user:
        return
      query = parse_qs(parsed.query)
      portal_id = query.get("portal_id", [""])[0]
      period_id = query.get("period_id", [""])[0] or query.get("id", [""])[0]
      if not portal_id or not period_id:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_work_period"})
        return
      try:
        deleted = delete_portal_work_period(portal_id, period_id, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_work_period"})
        return
      self.send_json(HTTPStatus.OK, {"deleted": deleted})
      return

    if path.startswith("/api/"):
      self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
      return

    self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"})

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

    if path.startswith("/api/portals/") and path.endswith("/wb-token"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/wb-token")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      api_key = str(payload.get("apiKey", "")).strip()
      if len(api_key) < 20:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "wb_token_required"})
        return
      existing_portal = find_portal_by_integration_token(WB_PROVIDER, api_key)
      if existing_portal and int(existing_portal["id"]) != portal_id:
        self.send_json(HTTPStatus.CONFLICT, portal_conflict_payload(existing_portal, user))
        return
      try:
        snapshot = fetch_wb_cards(api_key, max_cards=100)
        existing_portal = find_portal_by_integration_external_key(
          WB_PROVIDER,
          wb_snapshot_external_key(snapshot),
        )
        if existing_portal and int(existing_portal["id"]) != portal_id:
          self.send_json(HTTPStatus.CONFLICT, portal_conflict_payload(existing_portal, user))
          return
        row = replace_wb_token_for_portal(portal_id, api_key, snapshot)
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
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      record_admin_event(user, "wb_token_replaced", "portal", portal_id, portal_id=portal_id, details={
        "portalName": row["name"] if row else "",
        "cardCount": (snapshot.get("stats") or {}).get("cardCount", 0),
        "tokenExpiresAt": (snapshot.get("tokenMeta") or {}).get("expiresAt", ""),
      })
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
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
      try:
        store_url = clean_portal_manual_text(payload.get("storeUrl") or payload.get("store_url"), 500, "store_url_too_long")
        manual_source = clean_portal_manual_text(payload.get("manualSource") or payload.get("manual_source"), 1200, "manual_source_too_long")
        client_name = clean_portal_manual_text(payload.get("clientName") or payload.get("client_name"), 120, "client_name_too_long")
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "manual_portal_field_too_long"})
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
            client_name,
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
          {"portal": public_portal_payload(portal_id, name, marketplace, mode, scope, team, snapshot, client_name=client_name)},
        )
        return

      try:
        portal_id = create_portal(name, marketplace, scope, user["login"], team, store_url, manual_source, client_name)
      except sqlite3.IntegrityError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_team"})
        return
      bootstrap = {"status": "skipped", "cardCount": 0, "warnings": []}
      if store_url or manual_source:
        try:
          row, bootstrap = refresh_manual_portal_from_mpstats(portal_id, user)
        except RuntimeError:
          row = get_portal_row(portal_id, user)
          bootstrap = {"status": "error", "cardCount": 0, "warnings": ["Хранилище секретов недоступно: MPStats не запущен."]}
        except MpstatsApiError as exc:
          row = get_portal_row(portal_id, user)
          warning = "MPStats не подключен: кабинет создан без автозагрузки карточек." if exc.message == "mpstats_key_missing" else f"MPStats не загрузил витрину: {exc.message}"
          bootstrap = {
            "status": "missing" if exc.message == "mpstats_key_missing" else "error",
            "cardCount": 0,
            "warnings": [warning],
            "retryable": exc.retryable,
          }
        except ValueError:
          row = get_portal_row(portal_id, user)
          bootstrap = {"status": "empty", "cardCount": 0, "warnings": ["MPStats не нашел карточки по этой ссылке или описанию."]}
      else:
        row = get_portal_row(portal_id, user)
      portal_payload = public_portal_from_row(row)
      portal_payload["manualBootstrap"] = bootstrap
      self.send_json(HTTPStatus.CREATED, {"portal": portal_payload})
      return

    if path.startswith("/api/portals/") and path.endswith("/manual-source"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/manual-source")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        row = update_portal_manual_source(
          portal_id,
          payload.get("storeUrl") or payload.get("store_url"),
          payload.get("manualSource") or payload.get("manual_source"),
          actor=user,
        )
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_manual_source"})
        return
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/report-history"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/report-history")].strip("/")
      payload = self.read_json() or {}
      try:
        item = create_report_history(portal_id_text, payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_report_history"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.CREATED, {"item": item})
      return

    if path == "/api/users":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        if payload.get("action") == "reset_password":
          created_user, password = reset_user_password(payload, user)
          self.send_json(HTTPStatus.CREATED, {"user": created_user, "password": password})
          return
        if payload.get("action") == "update_user":
          updated_user = update_user_account(payload, user)
          self.send_json(HTTPStatus.OK, {"user": updated_user})
          return
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
          context_token = mpstats_call_context_start(user, "Настройки: проверка MPStats API", details={"action": "check"})
          try:
            result = check_mpstats_connection()
          finally:
            mpstats_call_context_stop(context_token)
        except RuntimeError:
          self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
          return
        self.send_json(HTTPStatus.OK, result)
        return
      api_key = str(payload.get("apiKey", "")).strip()
      try:
        save_service_integration(MPSTATS_PROVIDER, api_key, user)
        context_token = mpstats_call_context_start(user, "Настройки: сохранение MPStats API", details={"action": "save-and-check"})
        try:
          result = check_mpstats_connection()
        finally:
          mpstats_call_context_stop(context_token)
        record_admin_event(user, "service_integration_saved", "integration", MPSTATS_PROVIDER, details={
          "provider": MPSTATS_PROVIDER,
          "status": result.get("status") or "",
        })
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_mpstats_key"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-audit":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      portal_id = str(payload.get("portalId") or payload.get("portal_id") or "demo-wb")
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key") or "")
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      if not card_key:
        card_key = card_key_from_snapshot_card(raw_card) or draft_card_key(raw_card.get("nmID") or raw_card.get("vendorCode"))
      if not card_key:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_card_key"})
        return
      try:
        context_token = mpstats_call_context_start(user, "Карточка: аудит", portal_id=portal_id, card_key=card_key, nm_id=raw_card.get("nmID") or raw_card.get("nmId"), details={
          "hasManualCompetitors": bool(payload.get("auditCompetitors") or payload.get("competitorsForAudit")),
        })
        try:
          result = build_card_audit(
            portal_id,
            card_key,
            raw_card,
            subject_characteristics=None,
            mpstats_characteristics=None,
            period=payload.get("period"),
            audit_competitors=payload.get("auditCompetitors") or payload.get("competitorsForAudit"),
          )
        finally:
          mpstats_call_context_stop(context_token)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_audit_request"})
        return
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-content-reoptimize":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      portal_id = str(payload.get("portalId") or payload.get("portal_id") or "demo-wb")
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key") or "")
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      if not card_key:
        card_key = card_key_from_snapshot_card(raw_card) or draft_card_key(raw_card.get("nmID") or raw_card.get("vendorCode"))
      if not card_key:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_card_key"})
        return
      try:
        result = build_card_content_reoptimization(
          portal_id,
          card_key,
          raw_card,
          selected_keywords=payload.get("selectedKeywords") or payload.get("semanticCoreSelected"),
          current_keywords=payload.get("currentKeywords") or payload.get("semanticCoreCurrent"),
          remove_keywords=payload.get("removeKeywords") or payload.get("semanticCoreRemoval"),
          draft=payload.get("draft"),
        )
      except ValueError as exc:
        message = str(exc) or "invalid_content_reoptimization_request"
        status = HTTPStatus.CONFLICT if message == "llm_key_missing" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": message})
        return
      except RuntimeError as exc:
        self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(exc) or "llm_content_reoptimization_failed"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/mpstats/keywords":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      portal_id = str(payload.get("portalId") or payload.get("portal_id") or "demo-wb")
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      force_refresh = bool(payload.get("refresh"))
      try:
        context_token = mpstats_call_context_start(user, "СЯ: действующие позиции", portal_id=portal_id, card_key=card_key_from_snapshot_card(raw_card), nm_id=raw_card.get("nmID") or raw_card.get("nmId"), details={
          "refresh": force_refresh,
        })
        try:
          result = fetch_mpstats_keywords_core(raw_card, force_refresh=force_refresh)
        finally:
          mpstats_call_context_stop(context_token)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_mpstats_keywords_request"})
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
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/mpstats/semantic-expansion":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      portal_id = str(payload.get("portalId") or payload.get("portal_id") or "demo-wb")
      if not user_can_access_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      force_refresh = bool(payload.get("refresh"))
      try:
        context_token = mpstats_call_context_start(user, "СЯ: подбор новых запросов", portal_id=portal_id, card_key=card_key_from_snapshot_card(raw_card), nm_id=raw_card.get("nmID") or raw_card.get("nmId"), details={
          "query": payload.get("query") or "",
          "refresh": force_refresh,
        })
        try:
          result = fetch_mpstats_semantic_expansion(raw_card, query=payload.get("query"), force_refresh=force_refresh)
        finally:
          mpstats_call_context_stop(context_token)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_mpstats_semantic_request"})
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
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-drafts":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json(MAX_DRAFT_JSON_BYTES)
      if payload is None:
        try:
          content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
          content_length = 0
        if content_length > MAX_DRAFT_JSON_BYTES:
          self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
            "error": "draft_payload_too_large",
            "maxBytes": MAX_DRAFT_JSON_BYTES,
          })
        else:
          self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        return
      try:
        draft = save_card_draft(
          payload.get("portalId"),
          payload.get("cardKey"),
          payload.get("nmID"),
          payload.get("vendorCode"),
          payload.get("draft"),
          user,
        )
      except PermissionError as exc:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": str(exc) or "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_draft"})
        return
      work_periods = []
      if isinstance(draft, dict):
        work_periods = draft.pop("_workPeriods", [])
      self.send_json(HTTPStatus.OK, {"draft": draft, "workPeriods": work_periods})
      return

    if path == "/api/semantic-core-collections":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json(MAX_DRAFT_JSON_BYTES) or {}
      try:
        collection = save_semantic_core_collection(
          payload.get("portalId") or payload.get("portal_id"),
          payload.get("name"),
          payload.get("keywords"),
          user,
          collection_id=payload.get("collectionId") or payload.get("collection_id") or payload.get("id"),
          mode=payload.get("mode") or "append",
          meta=payload.get("meta") if isinstance(payload.get("meta"), dict) else {},
        )
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_semantic_collection"})
        return
      self.send_json(HTTPStatus.OK, {"collection": collection})
      return

    if path == "/api/card-competitors":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        competitors = save_card_competitors(
          payload.get("portalId"),
          payload.get("cardKey"),
          payload.get("nmID"),
          payload.get("vendorCode"),
          payload.get("competitors"),
          user,
        )
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_competitors"})
        return
      self.send_json(HTTPStatus.OK, {"competitors": competitors})
      return

    if path == "/api/card-competitors/refresh":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        context_token = mpstats_call_context_start(user, "Товарный аудит: обновить", portal_id=payload.get("portalId"), card_key=payload.get("cardKey"))
        try:
          competitors = refresh_card_competitors(
            payload.get("portalId"),
            payload.get("cardKey"),
            user,
          )
        finally:
          mpstats_call_context_stop(context_token)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_competitors"})
        return
      self.send_json(HTTPStatus.OK, {"competitors": competitors})
      return

    if path == "/api/card-competitors/reoptimize":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key") or "")
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      if not card_key:
        card_key = card_key_from_snapshot_card(raw_card) or draft_card_key(raw_card.get("nmID") or raw_card.get("vendorCode"))
      try:
        result = build_card_competitor_reoptimization(
          payload.get("portalId"),
          card_key,
          raw_card,
          payload.get("competitorNmID") or payload.get("competitor_nm_id"),
          draft=payload.get("draft"),
          user=user,
        )
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        message = str(exc) or "invalid_competitor_reoptimization_request"
        status = HTTPStatus.CONFLICT if message == "llm_key_missing" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": message})
        return
      except RuntimeError as exc:
        self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(exc) or "llm_competitor_reoptimization_failed"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-competitors/change-action":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        competitors = update_competitor_change_action(
          payload.get("portalId"),
          payload.get("cardKey"),
          payload.get("competitorNmID") or payload.get("competitor_nm_id"),
          payload.get("action"),
          user,
        )
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_competitor_change_action"})
        return
      self.send_json(HTTPStatus.OK, {"competitors": competitors})
      return

    if path == "/api/card-competitors/suggest":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key") or "")
      raw_card = payload.get("card") if isinstance(payload.get("card"), dict) else {}
      if not card_key:
        card_key = card_key_from_snapshot_card(raw_card) or draft_card_key(raw_card.get("nmID") or raw_card.get("vendorCode"))
      try:
        context_token = mpstats_call_context_start(user, "Товарный аудит: подобрать", portal_id=payload.get("portalId"), card_key=card_key, nm_id=raw_card.get("nmID") or raw_card.get("nmId"), details={
          "hasManualCompetitors": bool(payload.get("competitors") or payload.get("manualCompetitors")),
        })
        try:
          result = suggest_card_competitors(
            payload.get("portalId"),
            card_key,
            raw_card,
            payload.get("competitors") or payload.get("manualCompetitors"),
            user,
          )
        finally:
          mpstats_call_context_stop(context_token)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_competitors"})
        return
      except RuntimeError:
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/portal-work-periods":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json(MAX_DRAFT_JSON_BYTES) or {}
      portal_id = payload.get("portalId") or payload.get("portal_id")
      try:
        period = save_portal_work_period(portal_id, payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_work_period"})
        return
      status = HTTPStatus.OK if payload.get("periodId") or payload.get("id") else HTTPStatus.CREATED
      self.send_json(status, {"period": period})
      return

    if path == "/api/card-workset":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        workset = save_portal_workset(payload.get("portalId"), payload.get("cards"), user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_workset"})
        return
      self.send_json(HTTPStatus.OK, {"workset": workset})
      return

    if path == "/api/card-workset/create-tasks":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        result = create_workset_tasks(payload.get("portalId"), payload.get("cards"), user, {
          "workTypes": payload.get("workTypes"),
          "title": payload.get("title"),
          "comment": payload.get("comment"),
          "assigneeLogin": payload.get("assigneeLogin"),
          "workPeriodId": payload.get("workPeriodId") or payload.get("periodId"),
          "workPeriodTaskKey": payload.get("workPeriodTaskKey") or payload.get("taskKey"),
        })
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_workset"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-workset/delete-tasks":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        result = delete_card_work_tasks(payload.get("portalId"), payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_task_delete"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-workset/reorder-tasks":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        result = reorder_card_work_tasks(payload.get("portalId"), payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_task_order"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-workset/log-event":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        result = log_card_work_event(payload.get("portalId"), payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_task_event"})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-workset/audit-task":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      portal_id = payload.get("portalId")
      try:
        result = audit_and_save_card_task(portal_id, payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_task_audit"})
        return
      except RuntimeError as exc:
        card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key"))
        public_reason = public_audit_task_error_reason(exc)
        try:
          log_card_work_event(portal_id, {
            "cardKey": card_key,
            "action": "audit_failed",
            "workType": payload.get("workType") or payload.get("work_type") or "",
            "batchId": payload.get("batchId") or payload.get("batch_id") or "",
            "reason": public_reason,
          }, user)
        except Exception:
          pass
        print(f"Card task audit failed portal={portal_id} card={card_key}: {type(exc).__name__}")
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "secret_storage_unavailable", "reason": public_reason})
        return
      except Exception as exc:
        card_key = draft_card_key(payload.get("cardKey") or payload.get("card_key"))
        public_reason = public_audit_task_error_reason(exc)
        try:
          log_card_work_event(portal_id, {
            "cardKey": card_key,
            "action": "audit_failed",
            "workType": payload.get("workType") or payload.get("work_type") or "",
            "batchId": payload.get("batchId") or payload.get("batch_id") or "",
            "reason": public_reason,
          }, user)
        except Exception:
          pass
        print(f"Card task audit failed portal={portal_id} card={card_key}: {type(exc).__name__}")
        self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "audit_task_failed", "reason": public_reason})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path == "/api/card-workset/delete-completed-task":
      user = self.require_user()
      if not user:
        return
      payload = self.read_json() or {}
      try:
        result = delete_completed_approval_task(payload.get("portalId"), payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_completed_task_delete"})
        return
      self.send_json(HTTPStatus.OK, result)
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

    if path.startswith("/api/portals/") and path.endswith("/reset-work-cache"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/reset-work-cache")].strip("/")
      try:
        result = reset_portal_work_cache(portal_id_text, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path.startswith("/api/portals/") and path.endswith("/reset-analysis-cache"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/reset-analysis-cache")].strip("/")
      try:
        result = reset_portal_analysis_cache(portal_id_text, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path.startswith("/api/portals/") and path.endswith("/mpstats-bootstrap"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/mpstats-bootstrap")].strip("/")
      if not user_can_access_portal(user, portal_id_text):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      try:
        row, bootstrap = refresh_manual_portal_from_mpstats(portal_id_text, user)
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
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      portal_payload = public_portal_from_row(row)
      portal_payload["manualBootstrap"] = bootstrap
      self.send_json(HTTPStatus.OK, {"portal": portal_payload, "bootstrap": bootstrap})
      return

    if path.startswith("/api/portals/") and path.endswith("/ozon-mpstats-probe"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/ozon-mpstats-probe")].strip("/")
      if not user_can_edit_portal(user, portal_id_text):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        limit = int(payload.get("limit") or 20)
      except (TypeError, ValueError):
        limit = 20
      try:
        context_token = mpstats_call_context_start(user, "Ozon: проверка источника MPStats", portal_id=portal_id_text, details={
          "limit": max(1, min(limit, 50)),
        })
        try:
          result = build_ozon_mpstats_probe(portal_id_text, user, limit=limit)
        finally:
          mpstats_call_context_stop(context_token)
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
      except ValueError as exc:
        error_text = str(exc) or "invalid_ozon_mpstats_probe"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path.startswith("/api/portals/") and path.endswith("/ozon-mpstats-cards"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/ozon-mpstats-cards")].strip("/")
      if not user_can_edit_portal(user, portal_id_text):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        result = save_ozon_mpstats_cards(portal_id_text, user, payload.get("cards"))
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_ozon_cards"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path.startswith("/api/portals/") and path.endswith("/ozon-tasks"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/ozon-tasks")].strip("/")
      payload = self.read_json() or {}
      try:
        result = save_ozon_tasks(portal_id_text, payload, user)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_ozon_tasks"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.OK, result)
      return

    if path.startswith("/api/portals/") and path.endswith("/mpstats-import-all"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/mpstats-import-all")].strip("/")
      payload = self.read_json() or {}
      try:
        limit = int(payload.get("limit") or MPSTATS_STORE_FULL_IMPORT_MAX_CARDS)
      except (TypeError, ValueError):
        limit = MPSTATS_STORE_FULL_IMPORT_MAX_CARDS
      try:
        job = start_mpstats_store_import(portal_id_text, user, limit=limit)
      except PermissionError:
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      except ValueError as exc:
        error_text = str(exc) or "invalid_import_request"
        status = HTTPStatus.NOT_FOUND if error_text == "portal_not_found" else HTTPStatus.BAD_REQUEST
        self.send_json(status, {"error": error_text})
        return
      self.send_json(HTTPStatus.ACCEPTED, {"job": job})
      return

    if path.startswith("/api/portals/") and path.endswith("/delete"):
      user = self.require_user()
      if not user:
        return

      portal_id_text = path[len("/api/portals/"):-len("/delete")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      try:
        deleted = delete_portal(portal_id, actor=user)
      except ValueError as exc:
        error_text = str(exc) or "invalid_portal_id"
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": error_text})
        return
      if not deleted:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"deleted": True, "portal": deleted})
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

      row = set_portal_active(portal_id, action == "restore", actor=user)
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
        row = update_portal_team(portal_id, team, actor=user)
      except sqlite3.IntegrityError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_team"})
        return
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/client-contact"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/client-contact")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        row = update_portal_client_contact(portal_id, payload.get("clientContact"), actor=user)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_client_contact"})
        return
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/client-name"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/client-name")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        row = update_portal_client_name(portal_id, payload.get("clientName") or payload.get("client_name"), actor=user)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_client_name"})
        return
      if not row:
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "portal_not_found"})
        return
      self.send_json(HTTPStatus.OK, {"portal": public_portal_from_row(row)})
      return

    if path.startswith("/api/portals/") and path.endswith("/name"):
      user = self.require_user()
      if not user:
        return
      portal_id_text = path[len("/api/portals/"):-len("/name")].strip("/")
      try:
        portal_id = int(portal_id_text)
      except ValueError:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_portal_id"})
        return
      if not user_can_edit_portal(user, portal_id):
        self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return
      payload = self.read_json() or {}
      try:
        row = update_portal_name(portal_id, payload.get("name"), actor=user)
      except ValueError as exc:
        self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc) or "invalid_portal_name"})
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


def due_card_competitor_rows(limit):
  init_db()
  with connect_db() as db:
    rows = db.execute(
      """
      SELECT *
      FROM card_competitors
      WHERE competitor_nm_id != ''
      ORDER BY COALESCE(NULLIF(next_auto_check_at, ''), last_checked_at, created_at), id
      LIMIT 200
      """
    ).fetchall()
  now = utc_now()
  due_rows = [
    row for row in rows
    if not card_competitor_row_is_auto(row) and competitor_row_due_for_auto_check(row, now)
  ]
  return due_rows[:limit]


def run_competitor_auto_check_once():
  if not CARD_COMPETITOR_AUTO_CHECK_ENABLED:
    return 0
  if not CARD_COMPETITOR_AUTO_CHECK_LOCK.acquire(blocking=False):
    return 0
  try:
    rows = due_card_competitor_rows(CARD_COMPETITOR_AUTO_CHECK_MAX_BATCH)
    if not rows:
      return 0
    grouped = {}
    for row in rows:
      grouped.setdefault((row["portal_id"], row["card_key"]), []).append(row)
    checked = 0
    for (portal_id, card_key), group_rows in grouped.items():
      try:
        if refresh_card_competitor_rows(portal_id, card_key, group_rows, user=None, auto=True):
          checked += len(group_rows)
      except Exception as exc:  # noqa: BLE001 - background worker must keep running.
        print(f"Competitor auto-check failed for portal={portal_id} card={card_key}: {type(exc).__name__}: {exc}")
    return checked
  finally:
    CARD_COMPETITOR_AUTO_CHECK_LOCK.release()


def competitor_auto_check_worker_loop():
  time.sleep(10)
  interval = max(60, CARD_COMPETITOR_AUTO_CHECK_INTERVAL_SECONDS)
  while True:
    try:
      run_competitor_auto_check_once()
    except Exception as exc:  # noqa: BLE001 - background worker must keep running.
      print(f"Competitor auto-check loop failed: {type(exc).__name__}: {exc}")
    time.sleep(interval)


def start_competitor_auto_check_worker():
  global CARD_COMPETITOR_AUTO_CHECK_WORKER_STARTED
  if not CARD_COMPETITOR_AUTO_CHECK_ENABLED or CARD_COMPETITOR_AUTO_CHECK_WORKER_STARTED:
    return
  CARD_COMPETITOR_AUTO_CHECK_WORKER_STARTED = True
  worker = threading.Thread(
    target=competitor_auto_check_worker_loop,
    name="opticards-competitor-auto-check",
    daemon=True,
  )
  worker.start()


def run_server(host, port):
  init_db()
  start_competitor_auto_check_worker()
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
