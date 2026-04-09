from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import date
from typing import Optional
import database

app = FastAPI(title="Budget API")
database.init_db()


# ── Models ────────────────────────────────────────────────────────────────

class TransactionIn(BaseModel):
    date: date            # accepts "YYYY-MM-DD"
    category: str
    item: str
    amount: float
    comment: Optional[str] = None

class TransactionOut(TransactionIn):
    id: int


# ── Routes ────────────────────────────────────────────────────────────────

@app.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(tx: TransactionIn):
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transactions (date, category, item, amount, comment) VALUES (?, ?, ?, ?, ?)",
            (tx.date.isoformat(), tx.category, tx.item, tx.amount, tx.comment),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_dict(row)


@app.get("/transactions", response_model=list[TransactionOut])
def get_transactions(month: int, year: int):
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1–12")
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


# ── Helpers ───────────────────────────────────────────────────────────────

def _row_to_dict(row):
    return {**dict(row)}
