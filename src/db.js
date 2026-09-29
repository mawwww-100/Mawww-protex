'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'mawww.db');

// Pastikan folder database ada (untuk volume Railway)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    api_key       TEXT UNIQUE NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    name            TEXT NOT NULL,
    obfuscated_code TEXT NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id   INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    ip          TEXT,
    hwid        TEXT,
    user_agent  TEXT,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_scripts_user    ON scripts(user_id);
  CREATE INDEX IF NOT EXISTS idx_exec_script     ON executions(script_id);
  CREATE INDEX IF NOT EXISTS idx_exec_user       ON executions(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_apikey    ON users(api_key);
`);

// --- Users ---
function getUserByUsernameOrEmail(username, email) {
  return db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1'
  ).get(username, email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByApiKey(key) {
  return db.prepare('SELECT * FROM users WHERE api_key = ?').get(key);
}

function createUser({ username, email, passwordHash, apiKey }) {
  const info = db.prepare(
    'INSERT INTO users (username, email, password_hash, api_key) VALUES (?, ?, ?, ?)'
  ).run(username, email, passwordHash, apiKey);
  return getUserById(info.lastInsertRowid);
}

function updateUserPassword(id, hash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

function updateUserApiKey(id, key) {
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(key, id);
}

// --- Scripts ---
function getScriptsByUser(userId) {
  return db.prepare(
    'SELECT id, name, created_at FROM scripts WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

function getScriptById(id) {
  return db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
}

function createScript(userId, name, obfuscatedCode) {
  const info = db.prepare(
    'INSERT INTO scripts (user_id, name, obfuscated_code) VALUES (?, ?, ?)'
  ).run(userId, name, obfuscatedCode);
  return getScriptById(info.lastInsertRowid);
}

function deleteScript(id) {
  db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
}

// --- Executions ---
function logExecution(scriptId, userId, ip, hwid, userAgent) {
  db.prepare(
    'INSERT INTO executions (script_id, user_id, ip, hwid, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(scriptId, userId, ip, hwid, userAgent);
}

// --- Stats ---
function getUserStats(userId) {
  const scripts = db.prepare(
    'SELECT COUNT(*) AS c FROM scripts WHERE user_id = ?'
  ).get(userId).c;

  const executions = db.prepare(
    'SELECT COUNT(*) AS c FROM executions WHERE user_id = ?'
  ).get(userId).c;

  return { totalScripts: scripts, totalExecutions: executions };
}

module.exports = {
  db,
  getUserByUsernameOrEmail,
  getUserById,
  getUserByApiKey,
  createUser,
  updateUserPassword,
  updateUserApiKey,
  getScriptsByUser,
  getScriptById,
  createScript,
  deleteScript,
  logExecution,
  getUserStats
};
