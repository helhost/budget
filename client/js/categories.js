import { api } from './api.js';

// ── tiny helpers ─────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ── module ────────────────────────────────────────────────────────────────────

export async function mount(el_) {
  // ── persistent DOM skeleton (built once) ───────────────────────────────────

  const cName = el('input', { type: 'text', placeholder: 'Category name' });
  const cSubmit = el('button', { className: 'btn-primary' }, 'Add');
  const cError = el('p', { className: 'form-error' });
  const catList = el('div');

  el_.append(
    el('div', { className: 'page-header' },
      el('h1', {}, 'Categories'),
    ),
    el('div', { className: 'card add-form' },
      el('h2', {}, 'Add category'),
      el('div', { className: 'form-row' }, cName, cSubmit),
      cError,
    ),
    el('div', { className: 'card' }, catList),
  );

  // ── load & render list ────────────────────────────────────────────────────

  async function load() {
    catList.replaceChildren(el('div', { className: 'loading' }, 'Loading…'));
    const cats = await api.getCategories();

    if (!cats.length) {
      catList.replaceChildren(el('div', { className: 'empty' }, 'No categories yet.'));
      return;
    }

    const ul = el('ul', { className: 'cat-list' });
    for (const c of cats) {
      const btn = el('button', { className: 'btn-delete', 'data-id': c.id }, '✕');
      btn.addEventListener('click', async () => {
        await api.deleteCategory(btn.dataset.id);
        load();
      });
      ul.append(el('li', {}, el('span', {}, c.name), btn));
    }
    catList.replaceChildren(ul);
  }

  // ── add category ──────────────────────────────────────────────────────────

  cSubmit.addEventListener('click', async () => {
    cError.textContent = '';
    const name = cName.value.trim();
    if (!name) { cError.textContent = 'Name is required.'; return; }
    try {
      await api.addCategory(name);
      cName.value = '';
      load();
    } catch (e) {
      cError.textContent = e.message;
    }
  });

  cName.addEventListener('keydown', e => {
    if (e.key === 'Enter') cSubmit.click();
  });

  await load();
}
