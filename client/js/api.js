const BASE = 'http://localhost:8000';

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // Transactions
  getTransactions: (month, year) => request('GET', `/transactions?month=${month}&year=${year}`),
  addTransaction: (tx) => request('POST', '/transactions', tx),
  deleteTransaction: (id) => request('DELETE', `/transactions/${id}`),

  // Categories
  getCategories: () => request('GET', '/categories'),
  addCategory: (name) => request('POST', '/categories', { name }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),
};
