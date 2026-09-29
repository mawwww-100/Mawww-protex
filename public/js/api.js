(function () {
  const containerId = 'toast-container';
  let container = null;

  function ensure() {
    if (container) return container;
    container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'info', duration = 3500) {
    const c = ensure();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-show'));
    setTimeout(() => {
      el.classList.remove('toast-show');
      setTimeout(() => el.remove(), 250);
    }, duration);
  }

  window.toast = {
    info: (m, d) => show(m, 'info', d),
    success: (m, d) => show(m, 'success', d),
    error: (m, d) => show(m, 'error', d),
    warning: (m, d) => show(m, 'warning', d)
  };
})();
