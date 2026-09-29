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
    res.json({ user: req.user });
});

/* =========================
   SCRIPTS
   ========================= */
app.get('/api/scripts', requireAuth, (req, res) => {
    const rows = db.prepare(`
        SELECT id, name, mode, is_public, executions, created_at
        FROM scripts WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 200
    `).all(req.user.id);
    res.json({ scripts: rows });
});

app.post('/api/scripts', requireAuth, obfuscateLimiter, (req, res) => {
    try {
        const { name, code, mode } = req.body || {};
        if (!name || !code) return res.status(400).json({ error: 'Nama dan code wajib.' });

        const obfuscated = obfuscateLua(code, mode || 'direct');
        const accessKey = generateAccessKey();
        // URL loader akan di-set setelah insert (butuh ID)
        const info = db.prepare(`
            INSERT INTO scripts (user_id, name, original_code, obfuscated_code, loader_snippet, mode, access_key)
            VALUES (?, ?, ?, ?, '', ?, ?)
        `).run(req.user.id, String(name).slice(0, 100), code, obfuscated, mode || 'direct', accessKey);

        const scriptId = info.lastInsertRowid;
        const scriptUrl = `${req.protocol}://${req.get('host')}/api/raw/${scriptId}?key=${accessKey}`;
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
    res.json({ script: row });
});

app.delete('/api/scripts/:id', requireAuth, (req, res) => {
    const info = db.prepare('DELETE FROM scripts WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Tidak ada yang dihapus.' });
    res.json({ ok: true });
});

/* =========================
   RAW SCRIPT ENDPOINT (untuk loadstring)
   ========================= */
app.get('/api/raw/:id', (req, res) => {
    const id = Number(req.params.id);
    const key = req.query.key;

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
    if (!script) return res.status(404).send('-- Script tidak ditemukan');

    // Cek access key
    if (!script.is_public && script.access_key !== key) {
        return res.status(403).send('-- Access key salah');
    }

    // Catat execution
    const hwid = req.query.hwid || null;
    const executor = req.query.executor || null;
    db.prepare('INSERT INTO executions (script_id, hwid, executor) VALUES (?, ?, ?)')
        .run(id, hwid, executor);
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
    res.json({ stats: { totalScripts, totalExec } });
});

/* =========================
   HALAMAN
   ========================= */
app.get('/', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', redirectIfAuthed, (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/script', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'script.html')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mawww Protex jalan di port ${PORT}`);
});
