'use strict';

require('dotenv').config?.();

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('./src/db');
const auth = require('./src/auth');
const { obfuscateLua } = require('./src/obfuscator');

// Validasi JWT_SECRET — wajib ada, biar gagal cepat kalau lupa set
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET belum diset di environment variables.');
  console.error('        Generate: openssl rand -hex 32');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Railway pakai reverse proxy

// --- Middleware global ---
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Static file dari folder public/
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true
}));

// --- Rate limiters ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan, coba lagi nanti' }
});

const obfuscateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Batas obfuscate tercapai, coba lagi sebentar lagi' }
});

const rawLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan' }
});

// =========================================================
// ROUTES — Halaman HTML
// =========================================================

const redirectIfAuthed = (req, res, next) => {
  const token = req.cookies?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    const user = auth.verifyToken(token);
    if (user) return res.redirect('/dashboard');
  }
  next();
};

app.get('/', redirectIfAuthed, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

app.get('/login', redirectIfAuthed, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

app.get('/register', redirectIfAuthed, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'register.html'))
);

app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

app.get('/profile', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'profile.html'))
);

// Redirect .html ke clean URL (optional)
app.get('/login.html', (req, res) => res.redirect('/login'));
app.get('/register.html', (req, res) => res.redirect('/register'));
app.get('/profile.html', (req, res) => res.redirect('/profile'));

// =========================================================
// API — Auth
// =========================================================

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, dan password wajib diisi' });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username harus 3-32 karakter' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username hanya boleh huruf, angka, dan underscore' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Format email tidak valid' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    const existing = db.getUserByUsernameOrEmail(username, email);
    if (existing) {
      return res.status(409).json({ error: 'Username atau email sudah dipakai' });
    }

    const user = await auth.createUser(username, email, password);
    const token = auth.signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        apiKey: user.api_key
      }
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Gagal membuat akun' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { identifier, username, email, password } = req.body || {};
    const id = identifier || username || email;

    if (!id || !password) {
      return res.status(400).json({ error: 'Username/email dan password wajib diisi' });
    }

    const user = db.getUserByUsernameOrEmail(id, id);
    if (!user) {
      return res.status(401).json({ error: 'Kredensial salah' });
    }

    const ok = await auth.verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Kredensial salah' });
    }

    const token = auth.signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        apiKey: user.api_key
      }
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Gagal login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      apiKey: user.api_key,
      createdAt: user.created_at
    }
  });
});

app.post('/api/auth/change-password', auth.requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    }

    const user = db.getUserById(req.user.id);
    const ok = await auth.verifyPassword(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Password saat ini salah' });
    }

    const hash = await auth.hashPassword(newPassword);
    db.updateUserPassword(user.id, hash);

    res.json({ ok: true });
  } catch (err) {
    console.error('[change-password]', err);
    res.status(500).json({ error: 'Gagal mengganti password' });
  }
});

app.post('/api/auth/regenerate-key', auth.requireAuth, (req, res) => {
  try {
    const newKey = auth.generateApiKey();
    db.updateUserApiKey(req.user.id, newKey);
    res.json({ apiKey: newKey });
  } catch (err) {
    console.error('[regenerate-key]', err);
    res.status(500).json({ error: 'Gagal regenerasi API key' });
  }
});

// =========================================================
// API — Scripts
// =========================================================

app.get('/api/scripts', auth.requireAuth, (req, res) => {
  const scripts = db.getScriptsByUser(req.user.id);
  res.json(scripts);
});

app.post('/api/scripts', auth.requireAuth, obfuscateLimiter, (req, res) => {
  try {
    const { name, code } = req.body || {};

    if (!name || !code) {
      return res.status(400).json({ error: 'Nama dan kode wajib diisi' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Nama maksimal 100 karakter' });
    }
    if (code.length > 200000) {
      return res.status(400).json({ error: 'Kode terlalu panjang (max 200KB)' });
    }

    const obfuscated = obfuscateLua(code);
    const script = db.createScript(req.user.id, name, obfuscated);

    res.json({
      id: script.id,
      name: script.name,
      createdAt: script.created_at,
      rawUrl: '/api/raw/' + script.id
    });
  } catch (err) {
    console.error('[create-script]', err);
    res.status(500).json({ error: 'Gagal membuat script' });
  }
});

app.delete('/api/scripts/:id', auth.requireAuth, (req, res) => {
  const script = db.getScriptById(req.params.id);
  if (!script) return res.status(404).json({ error: 'Script tidak ditemukan' });
  if (script.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  db.deleteScript(req.params.id);
  res.json({ ok: true });
});

// Endpoint raw — diakses oleh executor Roblox, wajib API key
app.get('/api/raw/:id', rawLimiter, auth.requireApiKey, (req, res) => {
  const script = db.getScriptById(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- script not found');

  db.logExecution(script.id, req.user.id, req.ip, req.headers['x-hwid'] || null, req.headers['user-agent'] || null);

  res.type('text/plain').send(script.obfuscated_code);
});

// =========================================================
// API — Stats
// =========================================================

app.get('/api/stats', auth.requireAuth, (req, res) => {
  const stats = db.getUserStats(req.user.id);
  res.json(stats);
});

// =========================================================
// 404 & Error handler
// =========================================================

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// =========================================================
// Start server
// =========================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  Mawww Protex running');
  console.log('  Port   : ' + PORT);
  console.log('  Env    : ' + (process.env.NODE_ENV || 'development'));
  console.log('  DB     : ' + (process.env.DATABASE_PATH || './mawww.db'));
  console.log('==============================================');
});
