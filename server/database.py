import sqlite3
from pathlib import Path

DB_PATH = Path("data/budget.db")

DEFAULT_CATEGORIES = [
    "Salary", "Rent", "Bills & Utilities", "Groceries", "Transport",
    "Dining Out", "Entertainment", "Shopping", "Health & Fitness",
    "Savings", "Investments", "Gifts", "Insurance", "Other",
]

DEFAULT_TAX_GROUPS = [
    {
        "name": "Income Tax",
        "order_index": 0,
        "bands": [
            {
                "name": "Personal Allowance",
                "rate": 0,
                "band_from": 0,
                "band_to": 12570,
                "taper_start": 100000,
                "taper_rate": 0.5,
                "taper_floor": 0,
                "is_allowance": 1,
                "order_index": 0,
            },
            {
                "name": "Basic Rate",
                "rate": 20,
                "band_from": 0,
                "band_to": 37700,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 1,
            },
            {
                "name": "Higher Rate",
                "rate": 40,
                "band_from": 37700,
                "band_to": 112570,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 2,
            },
            {
                "name": "Additional Rate",
                "rate": 45,
                "band_from": 112570,
                "band_to": None,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 3,
            },
        ],
    },
    {
        "name": "National Insurance",
        "order_index": 1,
        "bands": [
            {
                "name": "Zero Rate",
                "rate": 0,
                "band_from": 0,
                "band_to": 12570,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 0,
            },
            {
                "name": "Primary Rate",
                "rate": 8,
                "band_from": 12570,
                "band_to": 50270,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 1,
            },
            {
                "name": "Upper Rate",
                "rate": 2,
                "band_from": 50270,
                "band_to": None,
                "taper_start": None,
                "taper_rate": None,
                "taper_floor": None,
                "is_allowance": 0,
                "order_index": 2,
            },
        ],
    },
]


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
                theme      TEXT    NOT NULL DEFAULT 'dark',
                created_at TEXT    DEFAULT (datetime('now'))
            )
        """)
        for col, definition in [
            ("currency", "TEXT NOT NULL DEFAULT 'GBP'"),
            ("theme",    "TEXT NOT NULL DEFAULT 'dark'"),
        ]:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {definition}")
            except Exception:
                pass

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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS budgets (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id),
                category      TEXT    NOT NULL,
                monthly_limit REAL    NOT NULL DEFAULT 0,
                UNIQUE(user_id, category)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plan_income (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                name       TEXT    NOT NULL,
                amount     REAL    NOT NULL,
                frequency  TEXT    NOT NULL DEFAULT 'Monthly',
                created_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plan_tax_groups (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                name        TEXT    NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plan_tax_bands (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id     INTEGER NOT NULL REFERENCES plan_tax_groups(id) ON DELETE CASCADE,
                name         TEXT    NOT NULL,
                rate         REAL    NOT NULL,
                band_from    REAL    NOT NULL DEFAULT 0,
                band_to      REAL,
                taper_start  REAL,
                taper_rate   REAL,
                taper_floor  REAL,
                is_allowance INTEGER NOT NULL DEFAULT 0,
                order_index  INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.commit()

        # migrate existing plan_tax_bands tables that lack is_allowance
        try:
            conn.execute("ALTER TABLE plan_tax_bands ADD COLUMN is_allowance INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        except Exception:
            pass


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

        # Seed default tax groups if user has none
        existing = conn.execute(
            "SELECT COUNT(*) FROM plan_tax_groups WHERE user_id = ?", (user_id,)
        ).fetchone()[0]

        if existing == 0:
            for group in DEFAULT_TAX_GROUPS:
                cur = conn.execute(
                    "INSERT INTO plan_tax_groups (user_id, name, order_index) VALUES (?,?,?)",
                    (user_id, group["name"], group["order_index"]),
                )
                group_id = cur.lastrowid
                for band in group["bands"]:
                    conn.execute("""
                        INSERT INTO plan_tax_bands
                            (group_id, name, rate, band_from, band_to,
                             taper_start, taper_rate, taper_floor, is_allowance, order_index)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                    """, (
                        group_id, band["name"], band["rate"],
                        band["band_from"], band["band_to"],
                        band["taper_start"], band["taper_rate"], band["taper_floor"],
                        band["is_allowance"], band["order_index"],
                    ))

        conn.commit()
        return user_id
