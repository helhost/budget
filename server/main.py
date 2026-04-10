from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import date
from typing import Optional
import database
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Budget API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://[::1]:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()


# ── Models ────────────────────────────────────────────────────────────────

class TransactionIn(BaseModel):
    date: date
    category: str
    item: str
    amount: float
    type: str = "outgoing"   # outgoing | incoming | saving
    comment: Optional[str] = None

class TransactionOut(TransactionIn):
    id: int


# ── Transactions ──────────────────────────────────────────────────────────

@app.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(tx: TransactionIn):
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transactions (date, category, item, amount, type, comment) VALUES (?, ?, ?, ?, ?, ?)",
            (tx.date.isoformat(), tx.category, tx.item, tx.amount, tx.type, tx.comment),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_dict(row)


@app.get("/transactions/all", response_model=list[TransactionOut])
def get_all_transactions():
    with database.get_connection() as conn:
        rows = conn.execute("SELECT * FROM transactions ORDER BY date").fetchall()
    return [_row_to_dict(r) for r in rows]


@app.get("/transactions", response_model=list[TransactionOut])
def get_transactions(month: int, year: int):
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1-12")
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE strftime('%m', date) = ? AND strftime('%Y', date) = ? ORDER BY date",
            (f"{month:02d}", str(year)),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@app.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int):
    with database.get_connection() as conn:
        deleted = conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,)).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")


# ── Categories ────────────────────────────────────────────────────────────

class CategoryIn(BaseModel):
    name: str

class CategoryOut(CategoryIn):
    id: int

@app.get("/categories", response_model=list[CategoryOut])
def get_categories():
    with database.get_connection() as conn:
        rows = conn.execute("SELECT * FROM categories ORDER BY name").fetchall()
    return [dict(r) for r in rows]

@app.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(cat: CategoryIn):
    with database.get_connection() as conn:
        try:
            cur = conn.execute("INSERT INTO categories (name) VALUES (?)", (cat.name,))
            conn.commit()
            row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
        except Exception:
            raise HTTPException(status_code=409, detail="Category already exists")
    return dict(row)

@app.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int):
    with database.get_connection() as conn:
        deleted = conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,)).rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Category not found")


# ── Helpers ───────────────────────────────────────────────────────────────

def _row_to_dict(row):
    return {**dict(row)}
