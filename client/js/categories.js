import { api } from './api.js';

export async function mount(el) {
  el.innerHTML = `
    <div class="page-header">
      <h1>Categories</h1>
    </div>

    <div class="card add-form">
      <h2>Add category</h2>
      <div class="form-row">
        <input type="text" id="c-name" placeholder="Category name" />
        <button id="c-submit" class="btn-primary">Add</button>
      </div>
      <p id="c-error" class="form-error"></p>
    </div>

    <div class="card">
      <div id="cat-list"><div class="loading">Loading…</div></div>
    </div>
  `;

  const catList = el.querySelector('#cat-list');
  const cError = el.querySelector('#c-error');
  const cName = el.querySelector('#c-name');

  async function load() {
    catList.innerHTML = '<div class="loading">Loading…</div>';
    const cats = await api.getCategories();
    if (!cats.length) {
      catList.innerHTML = '<div class="empty">No categories yet.</div>';
      return;
    }
    catList.innerHTML = `
      <ul class="cat-list">
        ${cats.map(c => `
          <li>
            <span>${c.name}</span>
            <button class="btn-delete" data-id="${c.id}">✕</button>
          </li>
        `).join('')}
      </ul>
    `;
    catList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.deleteCategory(btn.dataset.id);
        load();
      });
    });
  }

  el.querySelector('#c-submit').addEventListener('click', async () => {
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
    if (e.key === 'Enter') el.querySelector('#c-submit').click();
  });

  await load();
}
