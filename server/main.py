from fastapi import FastAPI, HTTPException, Cookie, Request
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import date
from typing import Optional
import database
import auth
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Budget API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://[::1]:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

database.init_db()


# ── Auth helpers ──────────────────────────────────────────────────────────

def current_user(session: Optional[str] = Cookie(default=None)) -> int:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = auth.decode_jwt(session)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user_id


# ── Auth routes ───────────────────────────────────────────────────────────

@app.get("/auth/login")
def login():
    return RedirectResponse(auth.get_google_auth_url())


@app.get("/auth/callback")
async def callback(code: str):
    user_info = await auth.exchange_code(code)
    user_id = database.upsert_user(
        google_id=user_info["sub"],
        email=user_info["email"],
        name=user_info.get("name", ""),
    )
    token = auth.create_jwt(user_id)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    response = RedirectResponse(f"{frontend_url}/#log")
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
    )
    return response


@app.post("/auth/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
    return response


@app.get("/auth/me")
def me(session: Optional[str] = Cookie(default=None)):
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = auth.decode_jwt(session)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    with database.get_connection() as conn:
        row = conn.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)


# ── Models ────────────────────────────────────────────────────────────────

class TransactionIn(BaseModel):
    date: date
    category: str
    item: str
    amount: float
    type: str = "outgoing"
    comment: Optional[str] = None

class TransactionOut(TransactionIn):
    id: int

class CategoryIn(BaseModel):
    name: str

class CategoryOut(CategoryIn):
    id: int


# ── Transactions ──────────────────────────────────────────────────────────

@app.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(tx: TransactionIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transactions (user_id, date, category, item, amount, type, comment) VALUES (?,?,?,?,?,?,?)",
            (user_id, tx.date.isoformat(), tx.category, tx.item, tx.amount, tx.type, tx.comment),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_dict(row)


@app.get("/transactions/all", response_model=list[TransactionOut])
def get_all_transactions(session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id = ? ORDER BY date", (user_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@app.get("/transactions", response_model=list[TransactionOut])
def get_transactions(month: int, year: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1-12")
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id = ? AND strftime('%m', date) = ? AND strftime('%Y', date) = ? ORDER BY date",
            (user_id, f"{month:02d}", str(year)),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@app.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user_id)
        ).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")


# ── Categories ────────────────────────────────────────────────────────────

@app.get("/categories", response_model=list[CategoryOut])
def get_categories(session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM categories WHERE user_id = ? ORDER BY name", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(cat: CategoryIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO categories (user_id, name) VALUES (?, ?)", (user_id, cat.name)
            )
            conn.commit()
            row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
        except Exception:
            raise HTTPException(status_code=409, detail="Category already exists")
    return dict(row)


@app.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM categories WHERE id = ? AND user_id = ?", (cat_id, user_id)
        ).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Category not found")


# ── Helpers ───────────────────────────────────────────────────────────────

def _row_to_dict(row):
    return {**dict(row)}


# ── Static files (client) — mount last so API routes take priority ────────
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

CLIENT_DIR = os.path.join(os.path.dirname(__file__), "client")

if os.path.isdir(CLIENT_DIR):
    @app.get("/")
    def root():
        return FileResponse(os.path.join(CLIENT_DIR, "index.html"))

    app.mount("/", StaticFiles(directory=CLIENT_DIR, html=True), name="static")
