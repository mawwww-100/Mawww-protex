(function () {
  document.addEventListener('DOMContentLoaded', () => {
    if (!authStore.getToken()) {
      location.replace('/login');
      return;
    }

    const user = authStore.getUser();
    if (user) {
      document.querySelectorAll('[data-username]').forEach(el => {
        el.textContent = user.username || user.email || '';
      });
    }

    document.querySelectorAll('[data-logout]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
        authStore.clear();
        location.replace('/login');
      });
    });
  });
})();
