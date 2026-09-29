// auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'mawww-protex-dev-secret-change-me';
const COOKIE_NAME = 'mawww_protex_token';

function signToken(user) {
    return jwt.sign(
        { uid: user.id, username: user.username, admin: !!user.is_admin },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function setAuthCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

function clearAuthCookie(res) {
    res.clearCookie(COOKIE_NAME);
}

function getUserFromToken(req) {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return null;
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return db.prepare('SELECT id, username, email, is_admin FROM users WHERE id = ?').get(payload.uid);
    } catch (_) {
        return null;
    }
}

function requireAuth(req, res, next) {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Belum login.' });
    req.user = user;
    next();
}

function requireAuthPage(req, res, next) {
    const user = getUserFromToken(req);
    if (!user) return res.redirect('/login');
    req.user = user;
    next();
}

function redirectIfAuthed(req, res, next) {
    const user = getUserFromToken(req);
    if (user) return res.redirect('/dashboard');
    next();
}

function generateApiKey() {
    return 'mawww_' + crypto.randomBytes(24).toString('hex');
}

function generateAccessKey() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
}

module.exports = {
    signToken,
    setAuthCookie,
    clearAuthCookie,
    getUserFromToken,
    requireAuth,
    requireAuthPage,
    redirectIfAuthed,
    generateApiKey,
    generateAccessKey
};
