const BASE = 'http://localhost:8000';

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',       // send httpOnly session cookie
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // Auth
  me: () => request('GET', '/auth/me'),
  logout: () => request('POST', '/auth/logout'),

  // Transactions
  getTransactions: (month, year) => request('GET', `/transactions?month=${month}&year=${year}`),
  addTransaction: (tx) => request('POST', '/transactions', tx),
  deleteTransaction: (id) => request('DELETE', `/transactions/${id}`),
  getAllTransactions: () => request('GET', '/transactions/all'),

  // Categories
  getCategories: () => request('GET', '/categories'),
  addCategory: (name) => request('POST', '/categories', { name }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),
};
