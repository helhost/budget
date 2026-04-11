from fastapi import FastAPI, HTTPException, Cookie
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import date
from typing import Optional
import database
import auth
import os
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


# ── Auth helpers ──────────────────────────────────────────────────────────────

def current_user(session: Optional[str] = Cookie(default=None)) -> int:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = auth.decode_jwt(session)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user_id


# ── Auth routes ───────────────────────────────────────────────────────────────

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
    is_prod = "localhost" not in frontend_url
    response.set_cookie(
        key="session", value=token, httponly=True,
        secure=is_prod, samesite="lax", max_age=60 * 60 * 24 * 30,
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
        row = conn.execute(
            "SELECT id, email, name, currency, theme FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)


class SettingsIn(BaseModel):
    currency: Optional[str] = None
    theme:    Optional[str] = None

@app.put("/user/settings")
def update_settings(settings: SettingsIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        if settings.currency is not None:
            conn.execute("UPDATE users SET currency = ? WHERE id = ?", (settings.currency, user_id))
        if settings.theme is not None:
            conn.execute("UPDATE users SET theme = ? WHERE id = ?", (settings.theme, user_id))
        conn.commit()
    return {"currency": settings.currency, "theme": settings.theme}


# ── Models ────────────────────────────────────────────────────────────────────

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


# ── Transactions ──────────────────────────────────────────────────────────────

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
            "SELECT * FROM transactions WHERE user_id = ? AND strftime('%m', date) = ? AND strftime('%Y', date) = ? ORDER BY date DESC",
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


# ── Categories ────────────────────────────────────────────────────────────────

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


# ── Budgets ───────────────────────────────────────────────────────────────────

class BudgetItem(BaseModel):
    category: str
    monthly_limit: float

@app.get("/budgets")
def get_budgets(session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT category, monthly_limit FROM budgets WHERE user_id = ? ORDER BY category",
            (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.put("/budgets")
def upsert_budgets(items: list[BudgetItem], session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        for item in items:
            conn.execute("""
                INSERT INTO budgets (user_id, category, monthly_limit)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit
            """, (user_id, item.category, item.monthly_limit))
        conn.commit()
    return {"ok": True}


# ── Plan — Income ─────────────────────────────────────────────────────────────

class PlanIncomeItem(BaseModel):
    name: str
    amount: float
    frequency: str = "Monthly"

class PlanIncomeItemOut(PlanIncomeItem):
    id: int

@app.get("/plan/income", response_model=list[PlanIncomeItemOut])
def get_plan_income(session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM plan_income WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.post("/plan/income", response_model=PlanIncomeItemOut, status_code=201)
def add_plan_income(item: PlanIncomeItem, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO plan_income (user_id, name, amount, frequency) VALUES (?,?,?,?)",
            (user_id, item.name, item.amount, item.frequency),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM plan_income WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)

@app.delete("/plan/income/{item_id}", status_code=204)
def delete_plan_income(item_id: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM plan_income WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Not found")


# ── Plan — Tax Groups ─────────────────────────────────────────────────────────

class TaxGroupIn(BaseModel):
    name: str
    order_index: int = 0

class TaxBandIn(BaseModel):
    name: str
    rate: float
    band_from: float = 0
    band_to: Optional[float] = None
    taper_start: Optional[float] = None
    taper_rate: Optional[float] = None
    taper_floor: Optional[float] = None
    is_allowance: int = 0
    order_index: int = 0

class TaxBandOut(TaxBandIn):
    id: int
    group_id: int


@app.get("/plan/tax/groups")
def get_tax_groups(session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        groups = conn.execute(
            "SELECT * FROM plan_tax_groups WHERE user_id = ? ORDER BY order_index", (user_id,)
        ).fetchall()
        result = []
        for g in groups:
            bands = conn.execute(
                "SELECT * FROM plan_tax_bands WHERE group_id = ? ORDER BY order_index", (g["id"],)
            ).fetchall()
            result.append({**dict(g), "bands": [dict(b) for b in bands]})
    return result


@app.post("/plan/tax/groups", status_code=201)
def create_tax_group(group: TaxGroupIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO plan_tax_groups (user_id, name, order_index) VALUES (?,?,?)",
            (user_id, group.name, group.order_index),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM plan_tax_groups WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {**dict(row), "bands": []}


@app.delete("/plan/tax/groups/{group_id}", status_code=204)
def delete_tax_group(group_id: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM plan_tax_groups WHERE id = ? AND user_id = ?", (group_id, user_id)
        ).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Not found")


@app.post("/plan/tax/groups/{group_id}/bands", status_code=201)
def create_tax_band(group_id: int, band: TaxBandIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        g = conn.execute(
            "SELECT id FROM plan_tax_groups WHERE id = ? AND user_id = ?", (group_id, user_id)
        ).fetchone()
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        cur = conn.execute("""
            INSERT INTO plan_tax_bands
                (group_id, name, rate, band_from, band_to,
                 taper_start, taper_rate, taper_floor, is_allowance, order_index)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            group_id, band.name, band.rate, band.band_from, band.band_to,
            band.taper_start, band.taper_rate, band.taper_floor,
            band.is_allowance, band.order_index,
        ))
        conn.commit()
        row = conn.execute("SELECT * FROM plan_tax_bands WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


@app.put("/plan/tax/bands/{band_id}")
def update_tax_band(band_id: int, band: TaxBandIn, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        row = conn.execute("""
            SELECT b.id FROM plan_tax_bands b
            JOIN plan_tax_groups g ON g.id = b.group_id
            WHERE b.id = ? AND g.user_id = ?
        """, (band_id, user_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Band not found")
        conn.execute("""
            UPDATE plan_tax_bands SET
                name=?, rate=?, band_from=?, band_to=?,
                taper_start=?, taper_rate=?, taper_floor=?,
                is_allowance=?, order_index=?
            WHERE id=?
        """, (
            band.name, band.rate, band.band_from, band.band_to,
            band.taper_start, band.taper_rate, band.taper_floor,
            band.is_allowance, band.order_index, band_id,
        ))
        conn.commit()
        updated = conn.execute("SELECT * FROM plan_tax_bands WHERE id = ?", (band_id,)).fetchone()
    return dict(updated)


@app.delete("/plan/tax/bands/{band_id}", status_code=204)
def delete_tax_band(band_id: int, session: Optional[str] = Cookie(default=None)):
    user_id = current_user(session)
    with database.get_connection() as conn:
        row = conn.execute("""
            SELECT b.id FROM plan_tax_bands b
            JOIN plan_tax_groups g ON g.id = b.group_id
            WHERE b.id = ? AND g.user_id = ?
        """, (band_id, user_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Band not found")
        conn.execute("DELETE FROM plan_tax_bands WHERE id = ?", (band_id,))
        conn.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row):
    return {**dict(row)}


# ── Static files ──────────────────────────────────────────────────────────────
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

CLIENT_DIR = os.path.join(os.path.dirname(__file__), "client")

if os.path.isdir(CLIENT_DIR):
    @app.get("/")
    def root():
        return FileResponse(os.path.join(CLIENT_DIR, "index.html"))

    app.mount("/", StaticFiles(directory=CLIENT_DIR, html=True), name="static")
