/**
 * DatePicker — a minimal calendar dropdown locked to a given month/year.
 * Usage:
 *   const picker = createDatePicker(inputEl, () => ({ month, year }));
 *   picker.destroy(); // cleanup
 */
export function createDatePicker(input, getContext, initialDate = null) {
  let popup = null;
  let selectedDate = initialDate;

  function formatDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function open() {
    if (popup) return;
    const { month, year } = getContext();

    popup = document.createElement('div');
    popup.className = 'dp-popup';
    render(popup, month, year);
    document.body.appendChild(popup);
    position();

    setTimeout(() => document.addEventListener('click', onOutside), 0);
  }

  function position() {
    if (!popup) return;
    const r = input.getBoundingClientRect();
    popup.style.top = `${r.bottom + window.scrollY + 6}px`;
    popup.style.left = `${r.left + window.scrollX}px`;
  }

  function close() {
    if (popup) { popup.remove(); popup = null; }
    document.removeEventListener('click', onOutside);
  }

  function onOutside(e) {
    if (!popup) return;
    if (!popup.contains(e.target) && e.target !== input) close();
  }

  function render(el, month, year) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    let cells = '';
    // empty cells before day 1
    for (let i = 0; i < firstDay; i++) cells += `<div></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const val = formatDate(year, month, d);
      const active = val === selectedDate ? 'dp-active' : '';
      cells += `<div class="dp-day ${active}" data-val="${val}">${d}</div>`;
    }

    el.innerHTML = `
      <div class="dp-header">
        <span class="dp-month-label">${new Date(year, month - 1).toLocaleString('default', { month: 'long' })} ${year}</span>
        <span class="dp-hint">locked to current month</span>
      </div>
      <div class="dp-grid dp-weekdays">${days.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="dp-grid dp-days">${cells}</div>
    `;

    el.querySelectorAll('.dp-day').forEach(cell => {
      cell.addEventListener('click', e => {
        e.stopPropagation();
        selectedDate = cell.dataset.val;
        input.value = selectedDate;
        input.dispatchEvent(new Event('change'));
        close();
      });
    });
  }

  input.addEventListener('click', e => { e.stopPropagation(); open(); });
  input.addEventListener('focus', e => { open(); });
  input.readOnly = true;
  input.style.cursor = 'pointer';

  function destroy() {
    close();
    input.removeEventListener('click', open);
    input.removeEventListener('focus', open);
  }

  return { destroy, setDate: (d) => { selectedDate = d; } };
}
