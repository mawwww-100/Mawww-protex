// server.js
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const {
    signToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    requireAuthPage,
    redirectIfAuthed,
    generateApiKey,
    generateAccessKey
} = require('./auth');
const { obfuscateLua, generateLoaderSnippet } = require('./obfuscator');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

/* =========================
   RATE LIMITERS
   ========================= */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' }
});

const obfuscateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Rate limit tercapai. Tunggu sebentar.' }
});

/* =========================
   AUTH
   ========================= */
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        let { username, email, password } = req.body || {};
        username = String(username || '').trim();
        email = String(email || '').trim().toLowerCase();
        password = String(password || '');

        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ error: 'Username 3-20 karakter, huruf/angka/underscore.' });
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return res.status(400).json({ error: 'Email tidak valid.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter.' });
        }

        const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (exists) return res.status(409).json({ error: 'Username atau email sudah dipakai.' });

        const hash = await bcrypt.hash(password, 10);
        const apiKey = generateApiKey();
        const info = db.prepare(
            'INSERT INTO users (username, email, password_hash, api_key) VALUES (?, ?, ?, ?)'
        ).run(username, email, hash, apiKey);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        setAuthCookie(res, signToken(user));
        res.json({ ok: true, user: { id: user.id, username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Gagal register.' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const user = db.prepare(
            'SELECT * FROM users WHERE username = ? OR email = ?'
        ).get(String(username || ''), String(username || '').toLowerCase());

        if (!user) return res.status(401).json({ error: 'Username/email atau password salah.' });
        const ok = await bcrypt.compare(String(password || ''), user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Username/email atau password salah.' });

        setAuthCookie(res, signToken(user));
        res.json({ ok: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).json({ error: 'Gagal login.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    const full = db.prepare('SELECT id, username, email, api_key, is_admin, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: full });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
        const { current, next } = req.body || {};
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        const ok = await bcrypt.compare(String(current || ''), user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Password lama salah.' });
        if (String(next || '').length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });

        const hash = await bcrypt.hash(next, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Gagal ganti password.' });
    }
});

app.post('/api/auth/regenerate-key', requireAuth, (req, res) => {
    const newKey = generateApiKey();
    db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newKey, req.user.id);
    res.json({ ok: true, api_key: newKey });
});

/* =========================
   SCRIPTS
   ========================= */
app.get('/api/scripts', requireAuth, (req, res) => {
    const q = (req.query.q || '').toString().trim();
    let rows;
    if (q) {
        rows = db.prepare(`
            SELECT id, name, mode, is_public, executions, created_at, expires_at
            FROM scripts WHERE user_id = ? AND name LIKE ?
            ORDER BY created_at DESC LIMIT 200
        `).all(req.user.id, `%${q}%`);
    } else {
        rows = db.prepare(`
            SELECT id, name, mode, is_public, executions, created_at, expires_at
            FROM scripts WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 200
        `).all(req.user.id);
    }
    res.json({ scripts: rows });
});

app.post('/api/scripts', requireAuth, obfuscateLimiter, (req, res) => {
    try {
        const { name, code, mode, expires_in_days } = req.body || {};
        if (!name || !code) return res.status(400).json({ error: 'Nama dan code wajib.' });

        const obfuscated = obfuscateLua(code, mode || 'direct');
        const accessKey = generateAccessKey();

        let expiresAt = null;
        if (expires_in_days && Number(expires_in_days) > 0) {
            expiresAt = Math.floor(Date.now() / 1000) + Number(expires_in_days) * 86400;
        }

        const info = db.prepare(`
            INSERT INTO scripts (user_id, name, original_code, obfuscated_code, loader_snippet, mode, access_key, expires_at)
            VALUES (?, ?, ?, ?, '', ?, ?, ?)
        `).run(req.user.id, String(name).slice(0, 100), code, obfuscated, mode || 'direct', accessKey, expiresAt);

        const scriptId = info.lastInsertRowid;
        const scriptUrl = `${req.protocol}://${req.get('host')}/api/raw/${scriptId}`;
        const loader = generateLoaderSnippet(scriptUrl, accessKey);

        db.prepare('UPDATE scripts SET loader_snippet = ? WHERE id = ?').run(loader, scriptId);

        res.json({ ok: true, id: scriptId, loader, accessKey });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/scripts/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Script tidak ditemukan.' });
    const wl = db.prepare('SELECT * FROM whitelist WHERE script_id = ? ORDER BY created_at DESC').all(row.id);
    const execs = db.prepare('SELECT * FROM executions WHERE script_id = ? ORDER BY executed_at DESC LIMIT 50').all(row.id);
    res.json({ script: row, whitelist: wl, executions: execs });
});

app.delete('/api/scripts/:id', requireAuth, (req, res) => {
    const info = db.prepare('DELETE FROM scripts WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Tidak ada yang dihapus.' });
    res.json({ ok: true });
});

app.post('/api/scripts/:id/toggle-public', requireAuth, (req, res) => {
    const row = db.prepare('SELECT id, is_public FROM scripts WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Script tidak ditemukan.' });
    db.prepare('UPDATE scripts SET is_public = ? WHERE id = ?').run(row.is_public ? 0 : 1, row.id);
    res.json({ ok: true, is_public: !row.is_public });
});

/* =========================
   WHITELIST (HWID)
   ========================= */
app.post('/api/scripts/:id/whitelist', requireAuth, (req, res) => {
    const { hwid, note } = req.body || {};
    if (!hwid) return res.status(400).json({ error: 'HWID wajib.' });
    const row = db.prepare('SELECT id FROM scripts WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Script tidak ditemukan.' });

    try {
        db.prepare('INSERT INTO whitelist (script_id, hwid, note) VALUES (?, ?, ?)')
            .run(row.id, String(hwid).slice(0, 128), String(note || '').slice(0, 200));
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: 'HWID sudah ada.' });
    }
});

app.delete('/api/scripts/:id/whitelist/:wid', requireAuth, (req, res) => {
    const row = db.prepare('SELECT id FROM scripts WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Script tidak ditemukan.' });
    db.prepare('DELETE FROM whitelist WHERE id = ? AND script_id = ?').run(req.params.wid, row.id);
    res.json({ ok: true });
});

/* =========================
   RAW SCRIPT (dipanggil Delta)
   ========================= */
app.get('/api/raw/:id', (req, res) => {
    const id = Number(req.params.id);
    const key = req.query.key;
    const hwid = req.query.hwid || null;
    const executor = req.query.executor || null;
    const ip = req.ip;

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
    if (!script) return res.type('text/plain').send('-- [Mawww Protex] Script tidak ditemukan.');

    // Cek expired
    if (script.expires_at && script.expires_at < Math.floor(Date.now() / 1000)) {
        return res.type('text/plain').send('-- [Mawww Protex] Script sudah expired.');
    }

    // Cek access key (kalau bukan public)
    if (!script.is_public && script.access_key !== key) {
        return res.type('text/plain').send('-- [Mawww Protex] Access key salah.');
    }

    // Cek HWID whitelist (kalau ada whitelist, HWID wajib match)
    const wlCount = db.prepare('SELECT COUNT(*) AS c FROM whitelist WHERE script_id = ?').get(id).c;
    if (wlCount > 0) {
        if (!hwid) return res.type('text/plain').send('-- [Mawww Protex] HWID tidak terdeteksi.');
        const ok = db.prepare('SELECT id FROM whitelist WHERE script_id = ? AND hwid = ?').get(id, hwid);
        if (!ok) return res.type('text/plain').send('-- [Mawww Protex] HWID tidak di-whitelist.');
    }

    // Catat execution
    db.prepare('INSERT INTO executions (script_id, hwid, executor, ip) VALUES (?, ?, ?, ?)')
        .run(id, hwid, executor, ip);
    db.prepare('UPDATE scripts SET executions = executions + 1 WHERE id = ?').run(id);

    res.type('text/plain').send(script.obfuscated_code);
});

/* =========================
   STATS
   ========================= */
app.get('/api/stats', requireAuth, (req, res) => {
    const totalScripts = db.prepare('SELECT COUNT(*) AS c FROM scripts WHERE user_id = ?').get(req.user.id).c;
    const totalExec = db.prepare(`
        SELECT COALESCE(SUM(executions), 0) AS c FROM scripts WHERE user_id = ?
    `).get(req.user.id).c;
    const totalPublic = db.prepare('SELECT COUNT(*) AS c FROM scripts WHERE user_id = ? AND is_public = 1').get(req.user.id).c;
    res.json({ stats: { totalScripts, totalExec, totalPublic } });
});

/* =========================
   HALAMAN
   ========================= */
app.get('/', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/profile', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mawww Protex v2 jalan di port ${PORT}`);
});
