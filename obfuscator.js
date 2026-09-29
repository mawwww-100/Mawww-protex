// obfuscator.js

/**
 * Ratakan array bersarang jadi 1 dimensi.
 */
function flattenArray(arr) {
    const result = [];
    const stack = [arr];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (Array.isArray(cur)) {
            for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
        } else {
            result.push(cur);
        }
    }
    return result;
}

function rnd(prefix = '_') {
    return prefix + Math.random().toString(36).slice(2, 10);
}

/**
 * Obfuscate Lua source → byte array + loader universal.
 *
 * PENTING untuk kompatibilitas Delta:
 * - Tidak pakai `table.create` (tidak ada di Delta lama).
 * - `loadstring` hanya dipanggil dengan 1 argumen.
 * - Loader memakai `loadstring(source)()` saja.
 */
function obfuscateLua(source, mode = 'direct') {
    if (typeof source !== 'string' || source.length === 0) {
        throw new Error('Source code kosong.');
    }
    if (source.length > 500_000) {
        throw new Error('Source terlalu besar (max 500KB).');
    }

    // Encode setiap karakter ke byte
    const bytes = [];
    for (let i = 0; i < source.length; i++) {
        bytes.push(source.charCodeAt(i) & 0xff);
    }
    const flat = flattenArray([bytes]);

    // Pecah jadi chunk 400 byte agar literal tidak terlalu panjang
    const CHUNK = 400;
    const chunks = [];
    for (let i = 0; i < flat.length; i += CHUNK) {
        chunks.push(flat.slice(i, i + CHUNK));
    }

    const vData = rnd('_d');
    const vChars = rnd('_c');
    const vCode = rnd('_s');
    const vLoad = rnd('_l');

    const chunkLua = chunks.map(c => `{${c.join(',')}}`).join(',');

    // ---- Output utama (kompatibel Delta) ----
    // Ganti table.create() → {}
    // Loader hanya pakai loadstring(code)()
    const lines = [
        `--[[ Mawww Protex | mode=${mode} | delta-compatible ]]`,
        `local ${vData}_c = {${chunkLua}}`,
        `local ${vData} = {}`,
        `for _, c in ipairs(${vData}_c) do`,
        `    for _, b in ipairs(c) do table.insert(${vData}, b) end`,
        `end`,
        `local ${vChars} = {}`,
        `for i = 1, #${vData} do ${vChars}[i] = string.char(${vData}[i]) end`,
        `local ${vCode} = table.concat(${vChars})`,
        `local ${vLoad} = loadstring or load`,
        `if not ${vLoad} then error("[Mawww Protex] loadstring tidak tersedia") end`,
        `return ${vLoad}(${vCode})()`
    ];

    return lines.join('\n');
}

/**
 * Generate loader snippet untuk Delta / executor lain.
 * Ini yang ditempel user ke Delta.
 */
function generateLoaderSnippet(scriptUrl, accessKey) {
    const keyPart = accessKey ? `, "${accessKey}"` : '';
    return `-- Mawww Protex Loader — compatible with Delta, Hydrogen, Wave, Xeno, Codex, Arceus X
loadstring(game:HttpGet("${scriptUrl}"))(${keyPart})`;
}

module.exports = { obfuscateLua, generateLoaderSnippet };
