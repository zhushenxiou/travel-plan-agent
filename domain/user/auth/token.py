from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass

from infrastructure.persistence.database import get_connection


@dataclass
class TokenData:
    user_id: str
    token: str
    expires_at: float


_TOKEN_EXPIRY_SECONDS = 86400 * 7


def _ensure_table() -> None:
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at REAL NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)")
    conn.commit()


def generate_token(user_id: str) -> str:
    raw = f"{user_id}:{os.urandom(16).hex()}:{time.time()}"
    token = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = time.time() + _TOKEN_EXPIRY_SECONDS
    _ensure_table()
    conn = get_connection()
    conn.execute(
        "INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires_at),
    )
    conn.commit()
    return token


def verify_token(token: str) -> str | None:
    _ensure_table()
    conn = get_connection()
    now = time.time()
    conn.execute("DELETE FROM auth_tokens WHERE expires_at < ?", (now,))
    conn.commit()
    row = conn.execute(
        "SELECT user_id, expires_at FROM auth_tokens WHERE token = ?",
        (token,),
    ).fetchone()
    if not row or time.time() > row["expires_at"]:
        return None
    return row["user_id"]


def revoke_token(token: str) -> None:
    _ensure_table()
    conn = get_connection()
    conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    conn.commit()
