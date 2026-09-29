document.addEventListener('DOMContentLoaded', async () => {
  const listEl     = document.getElementById('scripts-list');
  const emptyEl    = document.getElementById('scripts-empty');
  const loadingEl  = document.getElementById('scripts-loading');
  const createForm = document.getElementById('create-script-form');
  const createBtn  = document.getElementById('create-script-submit');
  const refreshBtn = document.getElementById('refresh-scripts');

  const statScripts = document.getElementById('stat-scripts');
  const statExec    = document.getElementById('stat-executions');

  async function loadStats() {
    try {
      const data = await api('/api/stats');
      if (statScripts) statScripts.textContent = data.totalScripts ?? 0;
      if (statExec)    statExec.textContent    = data.totalExecutions ?? 0;
    } catch (_) {}
  }

  function renderScripts(scripts) {
    listEl.innerHTML = '';
    if (!scripts || scripts.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    for (const s of scripts) {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = s.name || '(tanpa nama)';

      const idTd = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = s.id ?? '';
      idTd.appendChild(code);

      const dateTd = document.createElement('td');
      dateTd.textContent = s.created_at
        ? new Date(s.created_at).toLocaleString('id-ID')
        : '-';

      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions';

      const rawBtn = document.createElement('button');
      rawBtn.className = 'btn btn-sm';
      rawBtn.textContent = 'Copy Raw URL';
      rawBtn.addEventListener('click', () => {
        const url = location.origin + '/api/raw/' + s.id;
        navigator.clipboard.writeText(url).then(
          () => toast.success('URL disalin'),
          () => toast.info(url)
        );
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-danger';
      delBtn.textContent = 'Hapus';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Hapus script "' + (s.name || s.id) + '"?')) return;
        try {
          await api('/api/scripts/' + s.id, { method: 'DELETE' });
          toast.success('Script dihapus');
          load();
          loadStats();
        } catch (err) {
          toast.error(err.message || 'Gagal menghapus');
        }
      });

      actionsTd.append(rawBtn, delBtn);
      row.append(nameTd, idTd, dateTd, actionsTd);
      listEl.appendChild(row);
    }
  }

  async function load() {
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    try {
      const data = await api('/api/scripts');
      const scripts = Array.isArray(data) ? data : (data.scripts || data.data || []);
      renderScripts(scripts);
    } catch (err) {
      toast.error(err.message || 'Gagal memuat scripts');
    } finally {
      loadingEl.hidden = true;
    }
  }

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = createForm.name.value.trim();
      const code = createForm.code.value;

      if (!name || !code) {
        toast.error('Nama dan kode wajib diisi');
        return;
      }

      createBtn.disabled = true;
      const original = createBtn.textContent;
      createBtn.textContent = 'Mengunggah...';

      try {
        await api('/api/scripts', {
          method: 'POST',
          body: { name, code }
        });
        toast.success('Script dibuat');
        createForm.reset();
        load();
        loadStats();
      } catch (err) {
        toast.error(err.message || 'Gagal membuat script');
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = original;
      }
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', load);

  await Promise.all([load(), loadStats()]);
});
