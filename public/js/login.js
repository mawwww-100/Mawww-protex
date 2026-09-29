document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const submit = document.getElementById('login-submit');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = form.identifier.value.trim();
    const password = form.password.value;

    if (!identifier || !password) {
      toast.error('Isi username/email dan password');
      return;
    }

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Memproses...';

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: { identifier, password }
      });
      if (!data || !data.token) throw new Error('Respons server tidak valid');
      authStore.setToken(data.token);
      if (data.user) authStore.setUser(data.user);
      toast.success('Login berhasil');
      setTimeout(() => location.replace('/dashboard'), 350);
    } catch (err) {
      toast.error(err.message || 'Login gagal');
      submit.disabled = false;
      submit.textContent = original;
    }
  });
});
