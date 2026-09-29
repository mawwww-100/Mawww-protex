document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const submit = document.getElementById('register-submit');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const email    = form.email.value.trim();
    const password = form.password.value;
    const confirm  = form.confirm.value;

    if (!username || !email || !password) {
      toast.error('Lengkapi semua field');
      return;
    }
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }
    if (password !== confirm) {
      toast.error('Konfirmasi password tidak cocok');
      return;
    }

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Mendaftar...';

    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        skipAuth: true,
        body: { username, email, password }
      });

      if (data && data.token) {
        authStore.setToken(data.token);
        if (data.user) authStore.setUser(data.user);
        toast.success('Registrasi berhasil');
        setTimeout(() => location.replace('/dashboard'), 350);
      } else {
        toast.success('Registrasi berhasil, silakan login');
        setTimeout(() => location.replace('/login'), 800);
      }
    } catch (err) {
      toast.error(err.message || 'Registrasi gagal');
      submit.disabled = false;
      submit.textContent = original;
    }
  });
});
