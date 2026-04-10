import sqlite3
from pathlib import Path

DB_PATH = Path("data/budget.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id  TEXT    NOT NULL UNIQUE,
                email      TEXT    NOT NULL,
                name       TEXT,
                currency   TEXT    NOT NULL DEFAULT 'GBP',
                created_at TEXT    DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                date       TEXT    NOT NULL,
                category   TEXT    NOT NULL,
                item       TEXT    NOT NULL,
                amount     REAL    NOT NULL,
                type       TEXT    NOT NULL DEFAULT 'outgoing',
                comment    TEXT,
                created_at TEXT    DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name    TEXT    NOT NULL,
                UNIQUE(user_id, name)
            )
        """)
        conn.commit()


DEFAULT_CATEGORIES = ["Groceries", "Transport", "Entertainment", "Rent", "Shopping"]

def upsert_user(google_id: str, email: str, name: str) -> int:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO users (google_id, email, name)
            VALUES (?, ?, ?)
            ON CONFLICT(google_id) DO UPDATE SET email=excluded.email, name=excluded.name
        """, (google_id, email, name))
        conn.commit()

        row = conn.execute("SELECT id FROM users WHERE google_id = ?", (google_id,)).fetchone()
        user_id = row["id"]

        for cat in DEFAULT_CATEGORIES:
            conn.execute(
                "INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)",
                (user_id, cat),
            )
        conn.commit()

        return user_id
