'use strict';

/**
 * Obfuscator Lua sederhana — mengubah source menjadi byte array yang
 * di-load via loadstring. Bukan proteksi kuat, tapi cukup untuk mencegah
 * pembacaan langsung. Untuk proteksi serius, gunakan obfuscator Lua
 * pihak ketiga (Prometheus, Luraph, dsb).
 */
function obfuscateLua(source) {
  const bytes = Buffer.from(source, 'utf8');
  const nums = Array.from(bytes).join(',');

  const loader = [
    'local b = {' + nums + '}',
    'local s = {}',
    'for i = 1, #b do s[i] = string.char(b[i]) end',
    'local code = table.concat(s)',
    'local fn = loadstring or load',
    'return fn(code)()'
  ].join('\n');

  return '--[[ Mawww Protex obfuscated ]]\n' + loader;
}

module.exports = { obfuscateLua };
