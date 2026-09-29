'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';
const SALT_ROUNDS = 10;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET wajib diset di environment');
}

// --- Password ---
function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// --- API Key ---
function generateApiKey() {
  return 'mwp_' + crypto.randomBytes(24).toString('hex');
}

// --- JWT ---
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// --- Create user ---
async function createUser(username, email, password) {
  const passwordHash = await hashPassword(password);
  const apiKey = generateApiKey();
  return db.createUser({ username, email, passwordHash, apiKey });
}

// --- Middleware: Bearer token dari header Authorization ---
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }

  req.user = { id: payload.id, username: payload.username };
  next();
}

// --- Middleware: API key dari header X-API-Key (HANYA header, bukan query) ---
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ error: 'API key tidak ditemukan' });
  }

  const user = db.getUserByApiKey(key);
  if (!user) {
    return res.status(401).json({ error: 'API key tidak valid' });
  }

  req.user = { id: user.id, username: user.username };
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateApiKey,
  signToken,
  verifyToken,
  createUser,
  requireAuth,
  requireApiKey
};
