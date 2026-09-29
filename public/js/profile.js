document.addEventListener('DOMContentLoaded', async () => {
  const infoUsername = document.getElementById('info-username');
  const infoEmail    = document.getElementById('info-email');
  const infoApiKey   = document.getElementById('info-api-key');

  const pwdForm  = document.getElementById('change-password-form');
  const pwdBtn   = document.getElementById('change-password-submit');
  const regenBtn = document.getElementById('regenerate-key');
  const copyBtn  = document.getElementById('copy-key');

  async function loadProfile() {
    try {
      const data = await api('/api/auth/me');
      const user = data.user || data;
      if (infoUsername) infoUsername.textContent = user.username || '-';
      if (infoEmail)    infoEmail.textContent    = user.email || '-';
      if (infoApiKey)   infoApiKey.textContent   = user.apiKey || '-';
      authStore.setUser(user);
    } catch (err) {
      toast.error(err.message || 'Gagal memuat profil');
    }
  }

  if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = pwdForm.currentPassword.value;
      const newPassword     = pwdForm.newPassword.value;
      const confirmPassword = pwdForm.confirmPassword.value;

      if (!currentPassword || !newPassword) {
        toast.error('Lengkapi semua field');
        return;
      }
      if (newPassword.length < 6) {
        toast.error('Password baru minimal 6 karakter');
        return;
      }
      if (newPassword !== confirmPassword) {
        toast.error('Konfirmasi password tidak cocok');
        return;
      }

      pwdBtn.disabled = true;
      const original = pwdBtn.textContent;
      pwdBtn.textContent = 'Menyimpan...';

      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: { currentPassword, newPassword }
        });
        toast.success('Password berhasil diubah');
        pwdForm.reset();
      } catch (err) {
        toast.error(err.message || 'Gagal mengubah password');
      } finally {
        pwdBtn.disabled = false;
        pwdBtn.textContent = original;
      }
    });
  }

  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (!confirm('Regenerasi API key? Key lama tidak akan berfungsi lagi.')) return;
      regenBtn.disabled = true;
      const original = regenBtn.textContent;
      regenBtn.textContent = 'Memproses...';
      try {
        const data = await api('/api/auth/regenerate-key', { method: 'POST' });
        if (data.apiKey && infoApiKey) infoApiKey.textContent = data.apiKey;
        toast.success('API key diperbarui');
      } catch (err) {
        toast.error(err.message || 'Gagal regenerasi API key');
      } finally {
        regenBtn.disabled = false;
        regenBtn.textContent = original;
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const key = infoApiKey ? infoApiKey.textContent : '';
      if (!key || key === '-') return;
      navigator.clipboard.writeText(key).then(
        () => toast.success('API key disalin'),
        () => toast.error('Gagal menyalin')
      );
    });
  }

  await loadProfile();
});
