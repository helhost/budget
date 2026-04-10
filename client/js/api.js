const BASE = window.location.port === '3000' ? 'http://localhost:8000' : '';

async function request(method, path, body, redirectOn401 = true) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    if (redirectOn401) window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // Auth — no redirect on 401, let the caller decide
  me: () => request('GET', '/auth/me', null, false),
  logout: () => request('POST', '/auth/logout', null, false),

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
