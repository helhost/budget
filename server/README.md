# Budget API

Simple personal budget backend — Python + FastAPI + SQLite.

## Setup

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

API runs at `http://localhost:8000`  
Interactive docs at `http://localhost:8000/docs`

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/transactions` | Add a transaction |
| `GET` | `/transactions?month=4&year=2026` | Get transactions for a month |
| `DELETE` | `/transactions/{id}` | Delete a transaction |

## Example

```bash
# Add a transaction
curl -X POST http://localhost:8000/transactions \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-04-10", "category": "Groceries", "item": "Tesco run", "amount": 43.20}'

# Get April 2026
curl "http://localhost:8000/transactions?month=4&year=2026"

# Delete
curl -X DELETE http://localhost:8000/transactions/1
```
