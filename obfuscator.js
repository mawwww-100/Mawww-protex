// obfuscator.js

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
 * Delta-compatible:
 * - Tidak pakai table.create
 * - loadstring hanya 1 argumen
 * - Tidak pakai getfenv
 */
function obfuscateLua(source, mode = 'direct') {
    if (typeof source !== 'string' || source.length === 0) {
        throw new Error('Source code kosong.');
    }
    if (source.length > 500_000) {
        throw new Error('Source terlalu besar (max 500KB).');
    }

    const bytes = [];
    for (let i = 0; i < source.length; i++) {
        bytes.push(source.charCodeAt(i) & 0xff);
    }
    const flat = flattenArray([bytes]);

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

function generateLoaderSnippet(scriptUrl, accessKey) {
    // Loader universal, HWID opsional
    return `-- Mawww Protex Loader | Delta / Hydrogen / Wave / Xeno / Codex / Arceus
-- Version: 2.0
local __url = "${scriptUrl}"
local __key = "${accessKey || ''}"
local __hwid = (gethwid and gethwid()) or (syn and syn.get_hwid and syn.get_hwid()) or "unknown"
local __exec = (identifyexecutor and identifyexecutor()) or "unknown"
local __full = __url .. "?key=" .. __key .. "&hwid=" .. tostring(__hwid) .. "&executor=" .. tostring(__exec)
local __src = game:HttpGet(__full)
if not __src or __src == "" then warn("[Mawww Protex] Source kosong / akses ditolak.") return end
loadstring(__src)()`;
}

module.exports = { obfuscateLua, generateLoaderSnippet };
