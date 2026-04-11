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
  // Auth
  me: () => request('GET', '/auth/me', null, false),
  logout: () => request('POST', '/auth/logout', null, false),
  updateSettings: (settings) => request('PUT', '/user/settings', settings),

  // Transactions
  getTransactions: (month, year) => request('GET', `/transactions?month=${month}&year=${year}`),
  addTransaction: (tx) => request('POST', '/transactions', tx),
  deleteTransaction: (id) => request('DELETE', `/transactions/${id}`),
  getAllTransactions: () => request('GET', '/transactions/all'),

  // Budgets
  getBudgets: () => request('GET', '/budgets'),
  saveBudgets: (items) => request('PUT', '/budgets', items),

  // Categories
  getCategories: () => request('GET', '/categories'),
  addCategory: (name) => request('POST', '/categories', { name }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  // Plan — Income
  getPlanIncome: () => request('GET', '/plan/income'),
  addPlanIncome: (item) => request('POST', '/plan/income', item),
  deletePlanIncome: (id) => request('DELETE', `/plan/income/${id}`),

  // Plan — Tax Groups (includes bands nested)
  getTaxGroups: () => request('GET', '/plan/tax/groups'),
  createTaxGroup: (group) => request('POST', '/plan/tax/groups', group),
  deleteTaxGroup: (groupId) => request('DELETE', `/plan/tax/groups/${groupId}`),

  // Plan — Tax Bands
  createTaxBand: (groupId, band) => request('POST', `/plan/tax/groups/${groupId}/bands`, band),
  updateTaxBand: (bandId, band) => request('PUT', `/plan/tax/bands/${bandId}`, band),
  deleteTaxBand: (bandId) => request('DELETE', `/plan/tax/bands/${bandId}`),

  // Plan — Pension
  getPension: () => request('GET', '/plan/pension'),
  addPension: (item) => request('POST', '/plan/pension', item),
  deletePension: (id) => request('DELETE', `/plan/pension/${id}`),
};
