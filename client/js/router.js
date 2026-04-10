const routes = {};

export function register(hash, mountFn) {
  routes[hash] = mountFn;
}

export function navigate(hash) {
  window.location.hash = hash;
}

function render() {
  const hash = window.location.hash.replace('#', '') || 'log';
  const content = document.getElementById('content');
  content.innerHTML = '';

  // Update nav active state
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === hash);
  });

  const mount = routes[hash];
  if (mount) mount(content);
}

export function init() {
  window.addEventListener('hashchange', render);
  render();
}
