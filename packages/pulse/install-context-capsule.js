#!/usr/bin/env node
/**
 * Antigravity 底部栏「⚡ tok/s ➔ 💊 3A 莫兰迪跑道胶囊」跨平台极速安装器 (v1.3.1)
 * 支持：Windows / macOS (Intel & Apple Silicon) 桌面客户端 + 全平台浏览器网页端扩展导出
 * 特点：
 * 1. 完全独立于汉化工程：不重跑汉化、不扫描词库、不改动已有汉化或任何其他文件。
 * 2. 零外部依赖内存级补丁：无需 npx/@electron/asar 解包数千个文件，20ms 级直接在内存中更新 app.asar 的 dist/preload.js。
 * 3. Reload Window 1秒热加载钩子：preload.js 优先动态热读 ~/.gemini/tools/context-capsule-payload.js（缺失时自动回退内置副本），日常调样式无需重启客户端。
 * 4. <5ms 极速头部巡检与一键自愈 (--check / --ensure)：仅按偏移读取 ASAR 头部与 preload 切片，官方自动更新覆盖后自动无感恢复。
 * 5. Windows 桌面 Explorer (IShellWindows SWC_DESKTOP) 守护重启 + WMI 回退；macOS 原子替换 + ElectronAsarIntegrity 同步 + Ad-hoc 重签名 + SIGHUP 脱离守护重启 + SUDO_USER 属主保护。
 * 6. 自动导出网页端适配器：同步在 ~/.gemini/tools/antigravity-pulse-web/ 生成 Chrome/Edge 原生扩展 (MV3 MAIN world) 与 Tampermonkey 油猴脚本。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');

const CAPSULE_START = '/* === AGY_CONTEXT_CAPSULE_START === */';
const CAPSULE_END   = '/* === AGY_CONTEXT_CAPSULE_END === */';
const HOT_LOADER_TAG = '/* AGY_HOT_LOADER_V14 */';
const INSTALLER_VERSION = '1.3.1';
const WEB_ADAPTER_VERSION = '1.3.1';

function sleepSync(ms) {
    try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch (e) {
        const end = Date.now() + ms;
        while (Date.now() < end) {}
    }
}

/**
 * 解析真实用户家目录：macOS/Linux 下若通过 sudo 运行，优先返回 SUDO_USER 的真实家目录。
 */
function resolveRealUserHome(options) {
    const opts = options || {};
    const platform = opts.platform || process.platform;
    const env = opts.env || process.env;
    const homedirFn = typeof opts.homedir === 'function' ? opts.homedir : os.homedir;
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;

    const fallbackHome = homedirFn();
    if ((platform === 'darwin' || platform === 'linux') && env.SUDO_USER && env.SUDO_USER !== 'root') {
        const candidate = platform === 'darwin'
            ? path.posix.join('/Users', env.SUDO_USER)
            : path.posix.join('/home', env.SUDO_USER);
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return fallbackHome;
}

/**
 * 归一化 macOS 目标架构参数：
 * - arm64 / aarch64 / apple -> 'arm64'
 * - intel / x64 / x86_64 -> 'intel'
 * - 空 / 'auto' -> 'auto'
 * - 其他非法值抛出带有 exitCode=2 的错误
 */
function normalizeMacArch(archArg) {
    if (archArg === undefined || archArg === null) return 'auto';
    const norm = String(archArg).trim().toLowerCase();
    if (!norm || norm === 'auto') return 'auto';
    if (norm === 'arm64' || norm === 'aarch64' || norm === 'apple') return 'arm64';
    if (norm === 'intel' || norm === 'x64' || norm === 'x86_64') return 'intel';
    const err = new Error(
        `[ERROR] 不支持的 --arch 参数值 "${archArg}"，可选值: arm64 | intel | auto。`
    );
    err.exitCode = 2;
    throw err;
}

/**
 * 解析 `/usr/bin/file "<App>/Contents/MacOS/Antigravity"` 输出，识别二进制架构。
 */
function detectMachOArchFromFileOutput(fileOutput) {
    const raw = String(fileOutput || '');
    if (!raw.trim()) return 'unknown';
    const machIdx = raw.indexOf('Mach-O');
    const desc = machIdx !== -1 ? raw.slice(machIdx) : raw;
    const lower = desc.toLowerCase();

    const hasArm64 = /\barm64e?\b|\baarch64\b/.test(lower);
    const hasIntel = /\bx86_64\b|\bi386\b/.test(lower);
    if (lower.includes('universal binary') || (hasArm64 && hasIntel)) {
        return 'universal';
    }
    if (hasArm64) return 'arm64';
    if (hasIntel) return 'intel';
    return 'unknown';
}

/**
 * 校验请求的架构、宿主机 ARM64 能力与目标 .app 二进制架构是否兼容。
 */
function validateMacArchCompatibility(requestedArch, hostCanArm64, appBinaryArch) {
    const req = normalizeMacArch(requestedArch);
    const binArch = String(appBinaryArch || 'unknown').toLowerCase();
    const canArm64 = Boolean(hostCanArm64);

    if (req === 'arm64' && !canArm64) {
        return {
            ok: false,
            effectiveArch: 'arm64',
            reason: '[错误] 当前 macOS 宿主机为纯 Intel (x86_64) 架构，无法运行 Apple Silicon (arm64) 模式，请改用 --arch intel 指令。\n' +
                '[Error] Current macOS host is Intel-only (x86_64) and does not support arm64. Please rerun with --arch intel.'
        };
    }

    if (req === 'arm64' && binArch !== 'unknown' && binArch !== 'universal' && binArch !== 'arm64') {
        return {
            ok: false,
            effectiveArch: 'arm64',
            reason: `[错误] 目标客户端为纯 Intel (${binArch}) 架构包，与 --arch arm64 不匹配。请下载 Apple Silicon 版 Antigravity 或改用 --arch intel。\n` +
                `[Error] Target Antigravity.app is Intel-only (${binArch}), which does not match --arch arm64. Please use --arch intel or install the Apple Silicon build.`
        };
    }

    if (req === 'intel' && binArch !== 'unknown' && binArch !== 'universal' && binArch !== 'intel') {
        return {
            ok: false,
            effectiveArch: 'intel',
            reason: `[错误] 目标客户端为纯 Apple Silicon (${binArch}) 架构包，与 --arch intel 不匹配。请下载 Intel 版 Antigravity 或改用 --arch arm64。\n` +
                `[Error] Target Antigravity.app is Apple Silicon-only (${binArch}), which does not match --arch intel. Please use --arch arm64 or install the Intel build.`
        };
    }

    let effectiveArch = req;
    if (req === 'auto') {
        if (binArch === 'arm64' || binArch === 'intel') {
            effectiveArch = binArch;
        } else {
            effectiveArch = canArm64 ? 'arm64' : 'intel';
        }
    }

    return { ok: true, effectiveArch };
}

function detectHostCanArm64(options) {
    const opts = options || {};
    const arch = opts.arch || process.arch;
    const platform = opts.platform || process.platform;
    const execFileSyncFn = typeof opts.execFileSync === 'function' ? opts.execFileSync : child_process.execFileSync;
    if (arch === 'arm64') return true;
    if (platform === 'darwin') {
        try {
            const out = execFileSyncFn('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            return out === '1';
        } catch (e) {}
    }
    return false;
}

function detectAppBundleBinaryArch(appBundle, options) {
    if (!appBundle) return 'unknown';
    const opts = options || {};
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const execFileSyncFn = typeof opts.execFileSync === 'function' ? opts.execFileSync : child_process.execFileSync;
    const binPath = path.join(appBundle, 'Contents', 'MacOS', 'Antigravity');
    if (!existsFn(binPath)) return 'unknown';
    const fileCmd = existsFn('/usr/bin/file') ? '/usr/bin/file' : 'file';
    try {
        const out = execFileSyncFn(fileCmd, [binPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return detectMachOArchFromFileOutput(out);
    } catch (e) {
        return 'unknown';
    }
}

function parseArchArg(args) {
    if (!Array.isArray(args)) return { provided: false, raw: '' };
    let provided = false;
    let raw = '';
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--arch') {
            provided = true;
            if (args[i + 1] !== undefined && !String(args[i + 1]).startsWith('-')) {
                raw = args[i + 1];
                i++;
            } else {
                raw = '__MISSING_VALUE__';
            }
        } else if (a.startsWith('--arch=')) {
            provided = true;
            raw = a.slice('--arch='.length);
            if (!raw) raw = '__MISSING_VALUE__';
        }
    }
    return { provided, raw };
}

/**
 * macOS (darwin) 下自动补全 Homebrew、MacPorts、系统路径与常见 Node 版本管理器 PATH。
 * 支持按目标架构调整 /opt/homebrew/* 与 /usr/local/* 优先级。
 */
function ensureDarwinPath(envObj, realHome, options) {
    const opts = options || {};
    const targetEnv = envObj || process.env;
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const readdirFn = typeof opts.readdirSync === 'function' ? opts.readdirSync : fs.readdirSync;
    const execPath = opts.execPath || process.execPath;
    const home = realHome || resolveRealUserHome(opts);
    let requestedArch = 'auto';
    try {
        requestedArch = normalizeMacArch(opts.arch);
    } catch (e) {
        requestedArch = 'auto';
    }
    const preferIntel = requestedArch === 'intel' || (requestedArch === 'auto' && !detectHostCanArm64(opts));

    const brewPriority = preferIntel
        ? ['/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin', '/opt/homebrew/sbin']
        : ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin'];

    const priorityPaths = [
        ...brewPriority,
        '/opt/local/bin',
        path.posix.join(home, '.volta', 'bin'),
        path.posix.join(home, '.asdf', 'shims'),
        path.posix.join(home, '.local', 'share', 'mise', 'shims'),
        path.posix.join(home, '.local', 'bin'),
        path.posix.join(home, '.fnm', 'current', 'bin'),
        path.posix.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
        path.posix.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin')
    ];

    const nvmVersionsDir = path.posix.join(home, '.nvm', 'versions', 'node');
    if (existsFn(nvmVersionsDir)) {
        try {
            const versions = readdirFn(nvmVersionsDir).slice().sort();
            for (const v of versions) {
                priorityPaths.push(path.posix.join(nvmVersionsDir, v, 'bin'));
            }
        } catch (e) {}
    }

    const systemFallbackPaths = [
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
    ];

    const currentPaths = (targetEnv.PATH || '').split(':').filter(Boolean);
    const nodeBinDir = execPath ? path.posix.dirname(execPath.replace(/\\/g, '/')) : '';
    if (nodeBinDir && !currentPaths.includes(nodeBinDir) && existsFn(nodeBinDir)) {
        currentPaths.unshift(nodeBinDir);
    }

    for (let i = priorityPaths.length - 1; i >= 0; i--) {
        const p = priorityPaths[i];
        const existIdx = currentPaths.indexOf(p);
        if (existIdx !== -1 && i < brewPriority.length) {
            currentPaths.splice(existIdx, 1);
            currentPaths.unshift(p);
        } else if (existIdx === -1 && existsFn(p)) {
            currentPaths.unshift(p);
        }
    }

    for (const p of systemFallbackPaths) {
        if (!currentPaths.includes(p) && existsFn(p)) {
            currentPaths.push(p);
        }
    }

    targetEnv.PATH = currentPaths.join(':');
    return targetEnv.PATH;
}

if (process.platform === 'darwin') {
    let bootArch = 'auto';
    try {
        const parsed = parseArchArg(process.argv.slice(2));
        if (parsed.provided && parsed.raw !== '__MISSING_VALUE__') {
            bootArch = normalizeMacArch(parsed.raw);
        }
    } catch (e) {}
    ensureDarwinPath(process.env, resolveRealUserHome(), { arch: bootArch });
}

/**
 * 当在 macOS/Linux 下以 sudo root 写入用户目录产物后，归还文件及目录属主给真实用户 SUDO_USER。
 */
function restoreRealUserOwnership(targetPath, options) {
    const opts = options || {};
    const platform = opts.platform || process.platform;
    const env = opts.env || process.env;
    const getuidFn = typeof opts.getuid === 'function' ? opts.getuid : (process.getuid ? () => process.getuid() : null);

    if (platform !== 'darwin' && platform !== 'linux') return false;
    if (!getuidFn || getuidFn() !== 0) return false;
    const sudoUser = env.SUDO_USER;
    if (!sudoUser || sudoUser === 'root') return false;
    if (!targetPath || !fs.existsSync(targetPath)) return false;

    let uid = env.SUDO_UID ? Number(env.SUDO_UID) : NaN;
    let gid = env.SUDO_GID ? Number(env.SUDO_GID) : NaN;
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
        try {
            uid = Number(child_process.execFileSync('id', ['-u', sudoUser], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
            gid = Number(child_process.execFileSync('id', ['-g', sudoUser], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
        } catch (e) {}
    }

    if (Number.isInteger(uid) && Number.isInteger(gid)) {
        const chownRecursive = (curPath) => {
            try {
                const st = fs.lstatSync(curPath);
                if (st.isSymbolicLink()) return;
                fs.chownSync(curPath, uid, gid);
                if (st.isDirectory()) {
                    for (const entry of fs.readdirSync(curPath)) {
                        chownRecursive(path.join(curPath, entry));
                    }
                }
            } catch (e) {}
        };
        chownRecursive(targetPath);
        return true;
    }

    try {
        child_process.execFileSync('chown', ['-R', sudoUser, targetPath], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function computeIntegrity(buf) {
    const blockSize = 4 * 1024 * 1024;
    const blocks = [];
    for (let i = 0; i < buf.length; i += blockSize) {
        const chunk = buf.subarray(i, Math.min(i + blockSize, buf.length));
        blocks.push(crypto.createHash('sha256').update(chunk).digest('hex'));
    }
    if (blocks.length === 0) {
        blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
    }
    return {
        algorithm: 'SHA256',
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        blockSize,
        blocks
    };
}

/**
 * 计算 ASAR 头部 JSON 字符串的 SHA-256 十六进制摘要（用于 macOS ElectronAsarIntegrity）。
 */
function computeAsarHeaderHash(asarBuf) {
    if (!Buffer.isBuffer(asarBuf) || asarBuf.length < 16) {
        throw new Error('无效的 ASAR 缓冲区：长度不足 16 字节');
    }
    if (asarBuf.readUInt32LE(0) !== 4) {
        throw new Error('无效的 ASAR 头部格式');
    }
    const headerStrSize = asarBuf.readUInt32LE(12);
    if (headerStrSize === 0 || 16 + headerStrSize > asarBuf.length) {
        throw new Error(`无效的 ASAR 头部 JSON 长度: ${headerStrSize}`);
    }
    return crypto.createHash('sha256').update(asarBuf.subarray(16, 16 + headerStrSize)).digest('hex');
}

/**
 * 在 Info.plist XML 文本中精确更新 ElectronAsarIntegrity -> Resources/app.asar -> hash。
 */
function updatePlistAsarIntegrity(plistContent, headerHash) {
    if (typeof plistContent !== 'string' || !plistContent || !headerHash) {
        return plistContent;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(headerHash)) {
        throw new Error(`无效的 SHA-256 哈希格式: ${headerHash}`);
    }
    const normalizedHash = headerHash.toLowerCase();
    const integrityRegex = /(<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<key>Resources\/app\.asar<\/key>\s*<dict>(?:(?!<\/dict>)[\s\S])*?<key>hash<\/key>\s*<string>)[a-fA-F0-9]{64}(<\/string>)/;
    if (!integrityRegex.test(plistContent)) {
        return plistContent;
    }
    return plistContent.replace(integrityRegex, `$1${normalizedHash}$2`);
}

function buildCapsuleSnippet(payloadRaw, options) {
    const embedOnly = Boolean(options && options.embedOnly);
    const loaderBody = embedOnly
        ? `        const payload = ${JSON.stringify(payloadRaw)};\n`
        : `        ${HOT_LOADER_TAG}\n` +
          `        let payload = ${JSON.stringify(payloadRaw)};\n` +
          `        try {\n` +
          `            const fsMod = require('fs');\n` +
          `            const pathMod = require('path');\n` +
          `            const osMod = require('os');\n` +
          `            const hotPath = pathMod.join(osMod.homedir(), '.gemini', 'tools', 'context-capsule-payload.js');\n` +
          `            if (fsMod.existsSync(hotPath)) {\n` +
          `                const hotRaw = fsMod.readFileSync(hotPath, 'utf8');\n` +
          `                if (hotRaw && hotRaw.length > 500) payload = hotRaw;\n` +
          `            }\n` +
          `        } catch (e) {}\n`;

    return `\n${CAPSULE_START}\n(function() {\n` +
        `    try {\n` +
        `        const wf = (typeof electron_1 !== 'undefined' && electron_1.webFrame) ? electron_1.webFrame : require('electron').webFrame;\n` +
        loaderBody +
        `        const inject = () => {\n` +
        `            try { if (wf && wf.executeJavaScript) void Promise.resolve(wf.executeJavaScript(payload)).catch(() => {}); } catch (e) {}\n` +
        `        };\n` +
        `        if (document.readyState === 'loading') {\n` +
        `            document.addEventListener('DOMContentLoaded', inject);\n` +
        `        } else {\n` +
        `            inject();\n` +
        `        }\n` +
        `        window.addEventListener('load', inject);\n` +
        `        setTimeout(inject, 600);\n` +
        `        setTimeout(inject, 2000);\n` +
        `    } catch (e) {}\n` +
        `})();\n${CAPSULE_END}\n`;
}

// <5ms 极速只读切片巡检：无需读取数百 MB 的完整 app.asar，仅按文件描述符偏移读取头部与 dist/preload.js
function checkAsarStatusFast(asarPath) {
    const t0 = Date.now();
    let fd = null;
    try {
        fd = fs.openSync(asarPath, 'r');
        const prefix = Buffer.alloc(16);
        const bytesRead = fs.readSync(fd, prefix, 0, 16, 0);
        if (bytesRead < 16 || prefix.readUInt32LE(0) !== 4) {
            return { installed: false, hotReloadCapable: false, error: '无效的 ASAR 头部格式', elapsedMs: Date.now() - t0 };
        }
        const headerSize = prefix.readUInt32LE(4);
        const jsonSize = prefix.readUInt32LE(12);
        const dataOffsetBase = 8 + headerSize;

        const jsonBuf = Buffer.alloc(jsonSize);
        fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
        const headerObj = JSON.parse(jsonBuf.toString('utf8'));
        const preloadEntry = headerObj.files && headerObj.files.dist && headerObj.files.dist.files && headerObj.files.dist.files['preload.js'];
        if (!preloadEntry || preloadEntry.unpacked || preloadEntry.offset === undefined) {
            return { installed: false, hotReloadCapable: false, error: '未找到 dist/preload.js 条目', elapsedMs: Date.now() - t0 };
        }
        const pOffset = Number(preloadEntry.offset);
        const pSize = Number(preloadEntry.size);
        const pBuf = Buffer.alloc(pSize);
        fs.readSync(fd, pBuf, 0, pSize, dataOffsetBase + pOffset);
        const pStr = pBuf.toString('utf8');
        const installed = pStr.includes(CAPSULE_START) || pStr.includes('__AGY_CTX_CAPSULE_ACTIVE__');
        const hotReloadCapable = pStr.includes(HOT_LOADER_TAG);
        return {
            installed,
            hotReloadCapable,
            preloadSize: pSize,
            elapsedMs: Date.now() - t0
        };
    } catch (err) {
        return {
            installed: false,
            hotReloadCapable: false,
            error: err && err.message ? err.message : String(err),
            elapsedMs: Date.now() - t0
        };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

function cleanOldCapsuleFromPreload(preloadStr) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRe = new RegExp(`\\n?${esc(CAPSULE_START)}[\\s\\S]*?${esc(CAPSULE_END)}\\n?`, 'g');
    let out = preloadStr.replace(blockRe, '');

    const legacyRe = /\(function\(\)\s*\{\s*try\s*\{\s*const wf\s*=[\s\S]*?__AGY_CTX_CAPSULE_ACTIVE__[\s\S]*?setTimeout\(inject,\s*2000\);\s*\}\s*catch\s*\(e\)\s*\{\}\s*\}\)\(\);\s*/g;
    out = out.replace(legacyRe, '');
    return out;
}

function patchAsarBufferInMemory(asarBuf, payloadRaw, options) {
    if (asarBuf.length < 16 || asarBuf.readUInt32LE(0) !== 4) {
        throw new Error('无效的 ASAR 头部格式');
    }
    const headerSize = asarBuf.readUInt32LE(4);
    const jsonSize = asarBuf.readUInt32LE(12);
    const dataOffsetBase = 8 + headerSize;
    const headerObj = JSON.parse(asarBuf.subarray(16, 16 + jsonSize).toString('utf8'));

    const preloadEntry = headerObj.files && headerObj.files.dist && headerObj.files.dist.files && headerObj.files.dist.files['preload.js'];
    if (!preloadEntry || preloadEntry.unpacked || preloadEntry.offset === undefined) {
        throw new Error('未在 app.asar 中找到打包态的 dist/preload.js');
    }

    const oldOffset = Number(preloadEntry.offset);
    const oldSize = Number(preloadEntry.size);
    const oldPreloadBuf = asarBuf.subarray(dataOffsetBase + oldOffset, dataOffsetBase + oldOffset + oldSize);
    const oldPreloadStr = oldPreloadBuf.toString('utf8');

    const cleanedStr = cleanOldCapsuleFromPreload(oldPreloadStr);
    const isUninstall = Boolean(options && options.uninstall);
    const newPreloadStr = isUninstall ? cleanedStr : (cleanedStr + buildCapsuleSnippet(payloadRaw, options));
    const newPreloadBuf = Buffer.from(newPreloadStr, 'utf8');
    const newSize = newPreloadBuf.length;
    const delta = newSize - oldSize;

    function shiftOffsets(node) {
        if (!node || !node.files) return;
        for (const entry of Object.values(node.files)) {
            if (entry.files) {
                shiftOffsets(entry);
            } else if (!entry.unpacked && entry.offset !== undefined) {
                const curOff = Number(entry.offset);
                if (curOff > oldOffset) {
                    entry.offset = String(curOff + delta);
                }
            }
        }
    }
    shiftOffsets(headerObj);

    preloadEntry.size = newSize;
    preloadEntry.integrity = computeIntegrity(newPreloadBuf);

    const newJsonBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
    const newJsonSize = newJsonBuf.length;
    const alignedJsonSize = Math.ceil(newJsonSize / 4) * 4;
    const newHeaderSize = 8 + alignedJsonSize;

    const headerPrefix = Buffer.alloc(16 + alignedJsonSize, 0);
    headerPrefix.writeUInt32LE(4, 0);
    headerPrefix.writeUInt32LE(newHeaderSize, 4);
    headerPrefix.writeUInt32LE(newHeaderSize - 4, 8);
    headerPrefix.writeUInt32LE(newJsonSize, 12);
    newJsonBuf.copy(headerPrefix, 16);

    const beforeData = asarBuf.subarray(dataOffsetBase, dataOffsetBase + oldOffset);
    const afterData = asarBuf.subarray(dataOffsetBase + oldOffset + oldSize);

    return Buffer.concat([headerPrefix, beforeData, newPreloadBuf, afterData]);
}

// 导出网页端 Antigravity 适配器 (Chrome/Edge Manifest V3 扩展 + Tampermonkey 油猴脚本)
function exportWebAdapters(payloadRaw, options) {
    try {
        const realHome = (options && options.realHome) || resolveRealUserHome();
        const geminiDir = path.join(realHome, '.gemini');
        const toolsDir = path.join(geminiDir, 'tools');
        const webDir = path.join(toolsDir, 'antigravity-pulse-web');
        const geminiExisted = fs.existsSync(geminiDir);
        const toolsExisted = fs.existsSync(toolsDir);
        fs.mkdirSync(webDir, { recursive: true });

        const manifest = {
            manifest_version: 3,
            name: 'Antigravity Pulse (能量胶囊)',
            version: WEB_ADAPTER_VERSION,
            description: 'Antigravity 底部工具栏实时生成速度 (tok/s)、上下文容量胶囊与 5 小时剩余额度监控组件（网页端 & 桌面端同源内核）',
            content_scripts: [
                {
                    matches: [
                        'https://*.google.com/*',
                        'https://*.cloud.google.com/*',
                        'https://*.antigravity.google/*',
                        'http://localhost:*/*',
                        'http://127.0.0.1:*/*'
                    ],
                    js: ['context-capsule-payload.js'],
                    run_at: 'document_start',
                    world: 'MAIN'
                }
            ]
        };

        fs.writeFileSync(path.join(webDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        fs.writeFileSync(path.join(webDir, 'context-capsule-payload.js'), payloadRaw, 'utf8');

        const userScriptHeader = [
            '// ==UserScript==',
            '// @name         Antigravity Pulse (能量胶囊)',
            '// @namespace    https://github.com/akelabs/antigravity-pulse',
            `// @version      ${WEB_ADAPTER_VERSION}`,
            '// @description  Antigravity 底部工具栏实时生成速度 (tok/s)、上下文容量胶囊与 5 小时剩余额度监控（点击切换中/英文）',
            '// @match        https://*.google.com/*',
            '// @match        https://*.cloud.google.com/*',
            '// @match        https://*.antigravity.google/*',
            '// @run-at       document-start',
            '// @grant        none',
            '// ==/UserScript==',
            ''
        ].join('\n');

        fs.writeFileSync(path.join(webDir, 'antigravity-pulse.user.js'), userScriptHeader + payloadRaw, 'utf8');
        restoreRealUserOwnership(!geminiExisted ? geminiDir : (!toolsExisted ? toolsDir : webDir));
        console.log(`[√] 已同步生成网页端适配器目录: ${webDir}`);
        return true;
    } catch (e) {
        const detail = e && e.message ? e.message : String(e);
        console.warn(`[警告] 导出网页端适配器失败: ${detail}`);
        if (options && options.strict) {
            process.exitCode = 1;
            throw e;
        }
        return false;
    }
}

/**
 * 校验命令行参数合法性：拦截未知选项、误输位置参数（无 '-' 前缀）及带值参数缺失/空值。
 */
function validateCliArgs(args) {
    if (!Array.isArray(args)) {
        return { ok: false, exitCode: 2, message: '[ERROR] 命令行参数列表无效。' };
    }

    const booleanFlags = new Set([
        '--dry-run', '--schedule', '--worker', '--daemon-restart', '--noop-test',
        '--sync', '--web-only', '--check', '--ensure', '--embed-only', '--uninstall',
        '--confirm', '--yes', '-y', '--clean', '--help', '-h'
    ]);
    const valueFlags = new Set(['--asar', '--install-dir', '--arch', '--run-id']);

    for (let i = 0; i < args.length; i++) {
        const raw = args[i];
        const a = typeof raw === 'string' ? raw : String(raw ?? '');

        if (!a || !a.startsWith('-')) {
            const cleanWord = a.trim().replace(/^--+/, '');
            const suggestFlag = cleanWord ? `--${cleanWord}` : '--help';
            return {
                ok: false,
                exitCode: 2,
                message: `[ERROR] 未识别的位置参数 "${a}"（是否想输入 "${suggestFlag}"？），已中止执行以防误关闭客户端。请运行 --help 查看支持参数。`
            };
        }

        if (valueFlags.has(a)) {
            const next = args[i + 1];
            if (next === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `[ERROR] 参数 "${a}" 缺少参数值。请运行 --help 查看支持参数。`
                };
            }
            const nextStr = String(next);
            if (!nextStr.trim()) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `[ERROR] 参数 "${a}" 的值不能为空字符串。`
                };
            }
            if (nextStr.startsWith('-')) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `[ERROR] 参数 "${a}" 缺少有效值（遇到选项 "${nextStr}"）。`
                };
            }
            if (a === '--arch') {
                try {
                    normalizeMacArch(nextStr);
                } catch (archErr) {
                    return {
                        ok: false,
                        exitCode: 2,
                        message: archErr && archErr.message ? archErr.message : String(archErr)
                    };
                }
            }
            i++;
            continue;
        }

        const eqIdx = a.indexOf('=');
        if (eqIdx !== -1) {
            const key = a.slice(0, eqIdx);
            const val = a.slice(eqIdx + 1);
            if (!valueFlags.has(key)) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `[ERROR] 未识别的参数 "${a}"，已中止执行以防误关闭客户端。请运行 --help 查看支持参数。`
                };
            }
            if (!val.trim() || val.startsWith('-')) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `[ERROR] 参数 "${key}" 的值无效或为空: "${val}"。`
                };
            }
            if (key === '--arch') {
                try {
                    normalizeMacArch(val);
                } catch (archErr) {
                    return {
                        ok: false,
                        exitCode: 2,
                        message: archErr && archErr.message ? archErr.message : String(archErr)
                    };
                }
            }
            continue;
        }

        if (!booleanFlags.has(a)) {
            return {
                ok: false,
                exitCode: 2,
                message: `[ERROR] 未识别的参数 "${a}"，已中止执行以防误关闭客户端。请先更新最新 install-context-capsule.js 或运行 --help 查看支持参数。`
            };
        }
    }

    return { ok: true, exitCode: 0, message: '' };
}

/**
 * 从命令行参数中解析 --asar / --install-dir 路径。
 */
function parseAsarArg(args) {
    if (!Array.isArray(args)) return '';
    let result = '';
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--asar' || a === '--install-dir') {
            const next = args[i + 1];
            if (next !== undefined && String(next).trim() !== '' && !String(next).startsWith('-')) {
                result = String(next);
                i++;
            }
        } else if (a.startsWith('--asar=')) {
            const val = a.slice('--asar='.length);
            if (val.trim() !== '' && !val.startsWith('-')) result = val;
        } else if (a.startsWith('--install-dir=')) {
            const val = a.slice('--install-dir='.length);
            if (val.trim() !== '' && !val.startsWith('-')) result = val;
        }
    }
    return result;
}

/**
 * 识别需要跳过的 macOS 只读镜像、临时隔离目录、废纸篓或时间机器备份路径。
 */
function isSkippedMacAppBundlePath(p) {
    if (!p || typeof p !== 'string') return false;
    const norm = p.replace(/\\/g, '/');
    if (/\/\.Trash(?:\/|$)/i.test(norm)) return true;
    if (/\/AppTranslocation(?:\/|$)/i.test(norm)) return true;
    if (/\.timemachine/i.test(norm)) return true;
    if (!/^\/System\/Volumes\/Data(?:\/|$)/i.test(norm) && /(?:^|\/)Volumes(?:\/|$)/i.test(norm)) return true;
    return false;
}

/**
 * 将用户传入的文件或目录（如 .app 包、安装根目录、resources 目录或 app.asar 本身）解析为 app.asar 路径。
 */
function resolveAsarFromPath(inputPath, options) {
    if (!inputPath) return '';
    const opts = options || {};
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const statFn = typeof opts.statSync === 'function' ? opts.statSync : fs.statSync;
    const pathImpl = opts.pathImpl || path;

    const resolved = pathImpl.resolve ? pathImpl.resolve(inputPath) : path.resolve(inputPath);
    if (!existsFn(resolved)) return '';

    try {
        if (statFn(resolved).isFile()) {
            return resolved;
        }
    } catch (e) {}

    const subCandidates = [
        pathImpl.join(resolved, 'Contents', 'Resources', 'app.asar'),
        pathImpl.join(resolved, 'resources', 'app.asar'),
        pathImpl.join(resolved, 'app.asar')
    ];
    for (const c of subCandidates) {
        if (existsFn(c)) return c;
    }
    return '';
}

// 自动探测 Antigravity app.asar 路径 (支持 --asar / --install-dir 显式指定与目录自动解析)
function findAsarPath(customAsarPath, options) {
    const opts = options || {};
    const platform = opts.platform || process.platform;
    const env = opts.env || process.env;
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const statFn = typeof opts.statSync === 'function' ? opts.statSync : fs.statSync;
    const execSyncFn = typeof opts.execSync === 'function' ? opts.execSync : child_process.execSync;
    const pathImpl = opts.pathImpl || path;
    const realHome = opts.realHome || resolveRealUserHome({ platform, env, existsSync: existsFn });

    if (customAsarPath) {
        const direct = resolveAsarFromPath(customAsarPath, { existsSync: existsFn, statSync: statFn, pathImpl });
        if (direct) return direct;
        throw new Error(`指定的 --asar / --install-dir 路径未包含有效 app.asar: ${customAsarPath}`);
    }

    const candidates = [];
    const pushDirOrAsar = (dirOrFile) => {
        if (!dirOrFile) return;
        const resolved = resolveAsarFromPath(dirOrFile, { existsSync: existsFn, statSync: statFn, pathImpl });
        if (resolved) candidates.push(resolved);
    };

    let sawReadOnlyMacInstance = false;

    if (platform === 'darwin') {
        // ① ANTIGRAVITY_INSTALL_DIR / ANTIGRAVITY_HOME（用户显式指定环境变量时不跳过）
        pushDirOrAsar(env.ANTIGRAVITY_INSTALL_DIR);
        pushDirOrAsar(env.ANTIGRAVITY_HOME);

        // ② 运行中进程 ps -ax -o command= 提取 .app/Contents/MacOS/Antigravity 反推 .app/Contents/Resources/app.asar
        try {
            const psOut = execSyncFn('ps -ax -o command=', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const rawLine of String(psOut).split(/\r?\n/)) {
                const line = rawLine.trim();
                const m = line.match(/^(.*?\.app)\/Contents\/MacOS\/Antigravity(?:\s|$)/);
                if (m && m[1]) {
                    const appDir = m[1].trim();
                    if (isSkippedMacAppBundlePath(appDir)) {
                        const normApp = appDir.replace(/\\/g, '/');
                        if (/\/AppTranslocation(?:\/|$)/i.test(normApp) || /(?:^|\/)Volumes(?:\/|$)/i.test(normApp)) {
                            sawReadOnlyMacInstance = true;
                        }
                        continue;
                    }
                    candidates.push(pathImpl.join(appDir, 'Contents', 'Resources', 'app.asar'));
                }
            }
        } catch (e) {}

        // ③ /Applications/Antigravity.app/Contents/Resources/app.asar
        candidates.push('/Applications/Antigravity.app/Contents/Resources/app.asar');

        // ④ <realHome>/Applications/Antigravity.app/Contents/Resources/app.asar
        candidates.push(pathImpl.join(realHome, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar'));

        // 检查前四步候选，若未命中再走 mdfind 兜底（避免不必要的 Spotlight 查询）
        for (const c of candidates) {
            if (c && existsFn(c)) return c;
        }

        // ⑤ mdfind 'kMDItemFSName == "Antigravity.app"' 兜底
        try {
            const mdOut = execSyncFn('mdfind \'kMDItemFSName == "Antigravity.app"\'', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const rawLine of String(mdOut).split(/\r?\n/)) {
                const appDir = rawLine.trim();
                if (appDir && appDir.endsWith('.app') && !isSkippedMacAppBundlePath(appDir)) {
                    const asarCandidate = pathImpl.join(appDir, 'Contents', 'Resources', 'app.asar');
                    candidates.push(asarCandidate);
                    if (existsFn(asarCandidate)) return asarCandidate;
                }
            }
        } catch (e) {}
    } else if (platform === 'linux') {
        pushDirOrAsar(env.ANTIGRAVITY_INSTALL_DIR);
        pushDirOrAsar(env.ANTIGRAVITY_HOME);
        candidates.push('/opt/Antigravity/resources/app.asar');
        candidates.push('/opt/antigravity/resources/app.asar');
        candidates.push('/usr/share/antigravity/resources/app.asar');
    } else {
        pushDirOrAsar(env.ANTIGRAVITY_INSTALL_DIR);
        pushDirOrAsar(env.ANTIGRAVITY_HOME);
        if (platform === 'win32') {
            try {
                const exeOut = execSyncFn(
                    'powershell.exe -NoProfile -Command "(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
                    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
                ).trim();
                if (exeOut && existsFn(exeOut)) {
                    candidates.push(pathImpl.join(pathImpl.dirname(exeOut), 'resources', 'app.asar'));
                }
            } catch (e) {}
        }
        const localAppData = env.LOCALAPPDATA || pathImpl.join(os.homedir(), 'AppData', 'Local');
        candidates.push(pathImpl.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'));
        candidates.push(pathImpl.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app.asar'));
        if (env.ProgramFiles) {
            candidates.push(pathImpl.join(env.ProgramFiles, 'Antigravity', 'resources', 'app.asar'));
        }
    }

    for (const c of candidates) {
        if (c && existsFn(c)) return c;
    }
    const roHint = sawReadOnlyMacInstance
        ? '；检测到 Antigravity 正从只读镜像或临时隔离目录运行，请先将 Antigravity.app 拖入 /Applications 后重试'
        : '';
    throw new Error('未找到 Antigravity app.asar，已检查路径: ' + candidates.join(', ') + roHint);
}

/**
 * 从 app.asar 路径反推 macOS .app 包路径（若不位于 .app/Contents/Resources 下则返回空字符串）。
 */
function resolveMacAppBundleFromAsar(asarPath) {
    if (!asarPath) return '';
    const usePosix = process.platform === 'win32' && String(asarPath).startsWith('/');
    const pMod = usePosix ? path.posix : path;
    let cur = pMod.resolve(asarPath);
    for (let i = 0; i < 6; i++) {
        if (cur.endsWith('.app')) return cur;
        const parent = pMod.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    return '';
}

/**
 * 精确匹配 macOS `ps -ax -o comm=` 输出中的 Antigravity 主二进制路径，绝不误匹配带 --asar 参数的 node 进程。
 */
function matchMacAntigravityCommOutput(psOut) {
    if (!psOut) return false;
    for (const rawLine of String(psOut).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (/\/Contents\/MacOS\/Antigravity$/.test(line)) {
            return true;
        }
    }
    return false;
}

function isAntigravityRunning() {
    if (process.platform === 'win32') {
        try {
            const tl = child_process.execSync('tasklist /fi "imagename eq Antigravity.exe" /nh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return tl.toLowerCase().includes('antigravity.exe');
        } catch (e) {
            return false;
        }
    }
    if (process.platform === 'darwin') {
        try {
            const pgOut = child_process.execFileSync('pgrep', ['-x', 'Antigravity'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (pgOut.length > 0) return true;
        } catch (e) {}
        try {
            const psOut = child_process.execFileSync('ps', ['-ax', '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return matchMacAntigravityCommOutput(psOut);
        } catch (e) {
            return false;
        }
    }
    if (process.platform === 'linux') {
        try {
            const pgOut = child_process.execFileSync('pgrep', ['-x', 'antigravity'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (pgOut.length > 0) return true;
        } catch (e) {}
    }
    return false;
}

function killAntigravitySync() {
    if (process.platform !== 'win32') return;
    try {
        child_process.execSync('taskkill /F /IM Antigravity.exe /T >nul 2>nul', { stdio: 'ignore' });
    } catch (e) {}
    try {
        child_process.execSync('powershell.exe -NoProfile -Command "Stop-Process -Name Antigravity -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
    } catch (e) {}
}

function stopMacAntigravityForRestart() {
    if (process.platform !== 'darwin') return;
    try {
        child_process.execFileSync('killall', ['-TERM', 'Antigravity'], { stdio: 'ignore' });
    } catch (e) {}

    const waitStart = Date.now();
    while (Date.now() - waitStart < 2500) {
        sleepSync(250);
        if (!isAntigravityRunning()) break;
    }

    // 清理残留的主进程与 Antigravity Helper* 渲染/GPU子进程（按 comm= 精准查找 PID，绝不误伤外部 node 进程）
    try {
        const psOut = child_process.execFileSync('ps', ['-ax', '-o', 'pid=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        for (const rawLine of String(psOut).split(/\r?\n/)) {
            const line = rawLine.trim();
            const m = line.match(/^(\d+)\s+(.+)$/);
            if (!m) continue;
            const pid = Number(m[1]);
            const comm = m[2].trim();
            if (
                pid > 0 &&
                pid !== process.pid &&
                (/\/Contents\/MacOS\/Antigravity$/.test(comm) || /\/Contents\/Frameworks\/Antigravity Helper/.test(comm))
            ) {
                try { process.kill(pid, 'SIGKILL'); } catch (e2) {}
            }
        }
    } catch (e) {}

    try { child_process.execFileSync('killall', ['-KILL', 'Antigravity'], { stdio: 'ignore' }); } catch (e) {}
    try { child_process.execFileSync('pkill', ['-KILL', '-f', '/Contents/Frameworks/Antigravity Helper'], { stdio: 'ignore' }); } catch (e) {}
    sleepSync(600);
}

function stopLinuxAntigravityForRestart(options) {
    const opts = options || {};
    const platform = opts.platform || process.platform;
    if (platform !== 'linux') return;
    const execFileSyncFn = typeof opts.execFileSync === 'function' ? opts.execFileSync : child_process.execFileSync;
    const isRunningFn = typeof opts.isRunning === 'function' ? opts.isRunning : isAntigravityRunning;
    const sleepFn = typeof opts.sleep === 'function' ? opts.sleep : sleepSync;

    try {
        execFileSyncFn('pkill', ['-TERM', '-x', 'antigravity'], { stdio: 'ignore' });
    } catch (e) {}

    const waitStart = Date.now();
    while (Date.now() - waitStart < 2500) {
        sleepFn(250);
        if (!isRunningFn()) break;
    }

    if (isRunningFn()) {
        try {
            execFileSyncFn('pkill', ['-KILL', '-x', 'antigravity'], { stdio: 'ignore' });
        } catch (e) {}
        sleepFn(400);
    }
}

function startLinuxAntigravityApp(asarPath, options) {
    const opts = options || {};
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const spawnFn = typeof opts.spawn === 'function' ? opts.spawn : child_process.spawn;
    const getuidFn = typeof opts.getuid === 'function' ? opts.getuid : (process.getuid ? () => process.getuid() : () => 1000);
    const env = opts.env || process.env;
    const cleanEnv = Object.assign({}, env);
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
    delete cleanEnv.NODE_OPTIONS;
    delete cleanEnv.VSCODE_IPC_HOOK;
    delete cleanEnv.VSCODE_NLS_CONFIG;

    const installRoot = asarPath ? path.dirname(path.dirname(asarPath)) : '';
    const candidates = [];
    if (installRoot) {
        candidates.push(path.join(installRoot, 'antigravity'));
        candidates.push(path.join(installRoot, 'Antigravity'));
    }
    let binToRun = '';
    for (const c of candidates) {
        if (existsFn(c)) {
            binToRun = c;
            break;
        }
    }
    if (!binToRun) return false;

    try {
        let child = null;
        if (getuidFn() === 0 && cleanEnv.SUDO_USER && cleanEnv.SUDO_USER !== 'root') {
            child = spawnFn('sudo', ['-u', cleanEnv.SUDO_USER, binToRun], {
                cwd: path.dirname(binToRun),
                detached: true,
                stdio: 'ignore',
                env: cleanEnv
            });
        } else {
            child = spawnFn(binToRun, [], {
                cwd: path.dirname(binToRun),
                detached: true,
                stdio: 'ignore',
                env: cleanEnv
            });
        }
        if (child && typeof child.unref === 'function') child.unref();
        return true;
    } catch (e) {
        return false;
    }
}

function startAntigravityApp(agyExe, options) {
    const opts = options || {};
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const spawnFn = typeof opts.spawn === 'function' ? opts.spawn : child_process.spawn;
    if (!agyExe || !existsFn(agyExe)) return false;
    const agyDir = path.dirname(agyExe);
    const cleanEnv = Object.assign({}, opts.env || process.env);
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
    delete cleanEnv.NODE_OPTIONS;
    delete cleanEnv.VSCODE_IPC_HOOK;
    delete cleanEnv.VSCODE_NLS_CONFIG;
    try {
        const child = spawnFn(agyExe, [], {
            cwd: agyDir,
            detached: true,
            stdio: 'ignore',
            env: cleanEnv
        });
        if (child && typeof child.unref === 'function') child.unref();
        return true;
    } catch (e) {
        try {
            const fallback = spawnFn('explorer.exe', [agyExe], {
                cwd: agyDir,
                detached: true,
                stdio: 'ignore',
                env: cleanEnv
            });
            if (fallback && typeof fallback.unref === 'function') fallback.unref();
            return true;
        } catch (e2) {
            return false;
        }
    }
}

function startMacAntigravityApp(appBundle, options) {
    if (!appBundle || !fs.existsSync(appBundle)) return false;
    const opts = options || {};
    const env = opts.env || process.env;
    const execFileSyncFn = typeof opts.execFileSync === 'function' ? opts.execFileSync : child_process.execFileSync;
    const getuidFn = typeof opts.getuid === 'function' ? opts.getuid : (process.getuid ? () => process.getuid() : () => 1000);
    const cleanEnv = Object.assign({}, env);
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
    delete cleanEnv.NODE_OPTIONS;
    delete cleanEnv.VSCODE_IPC_HOOK;
    delete cleanEnv.VSCODE_NLS_CONFIG;

    try {
        if (getuidFn() === 0 && cleanEnv.SUDO_USER && cleanEnv.SUDO_USER !== 'root') {
            execFileSyncFn('sudo', ['-u', cleanEnv.SUDO_USER, 'open', '-a', appBundle], { stdio: 'ignore', env: cleanEnv });
        } else {
            execFileSyncFn('open', ['-a', appBundle], { stdio: 'ignore', env: cleanEnv });
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * macOS 写入前权限预检与交互式 sudo 提权。
 */
function ensureMacWritePermissionIfNeeded(asarPath, options) {
    const opts = options || {};
    const platform = opts.platform || process.platform;
    if (platform !== 'darwin') return { ok: true, elevated: false };

    const env = opts.env || process.env;
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const accessFn = typeof opts.accessSync === 'function' ? opts.accessSync : fs.accessSync;
    const spawnSyncFn = typeof opts.spawnSync === 'function' ? opts.spawnSync : child_process.spawnSync;
    const getuidFn = typeof opts.getuid === 'function' ? opts.getuid : (process.getuid ? () => process.getuid() : () => 1000);
    const isTTY = typeof opts.isTTY === 'boolean' ? opts.isTTY : Boolean(process.stdin && process.stdin.isTTY);
    const execPath = opts.execPath || process.execPath;
    const argv = opts.argv || process.argv;
    const exitFn = typeof opts.exit === 'function' ? opts.exit : (code) => process.exit(code);
    const pathImpl = opts.pathImpl || path;

    const resourcesDir = pathImpl.dirname(asarPath);
    const targetsToCheck = [resourcesDir, asarPath];
    const contentsDir = pathImpl.dirname(resourcesDir);
    const plistPath = pathImpl.join(contentsDir, 'Info.plist');
    if (pathImpl.basename(resourcesDir) === 'Resources' && pathImpl.basename(contentsDir) === 'Contents' && existsFn(plistPath)) {
        targetsToCheck.push(plistPath);
    }

    let needsElevation = false;
    for (const t of targetsToCheck) {
        if (!existsFn(t)) continue;
        try {
            accessFn(t, fs.constants.W_OK);
        } catch (err) {
            needsElevation = true;
            break;
        }
    }

    if (!needsElevation || getuidFn() === 0) {
        return { ok: true, elevated: false };
    }

    if (isTTY) {
        console.log('[权限] 检测到当前用户对 macOS Antigravity 应用目录缺少写入权限，正在请求管理员权限 (sudo)...');
        console.log('[Permission] Write permission is required for Antigravity.app. Requesting sudo elevation...');
        const sudoUser = (env.SUDO_USER && env.SUDO_USER !== 'root')
            ? env.SUDO_USER
            : (env.USER || env.LOGNAME || '');
        const sudoArgs = ['env', `PATH=${env.PATH || ''}`];
        if (sudoUser) sudoArgs.push(`SUDO_USER=${sudoUser}`);
        if (env.ANTIGRAVITY_INSTALL_DIR) sudoArgs.push(`ANTIGRAVITY_INSTALL_DIR=${env.ANTIGRAVITY_INSTALL_DIR}`);
        if (env.ANTIGRAVITY_HOME) sudoArgs.push(`ANTIGRAVITY_HOME=${env.ANTIGRAVITY_HOME}`);
        sudoArgs.push(execPath, ...argv.slice(1));

        const res = spawnSyncFn('sudo', sudoArgs, { stdio: 'inherit' });
        const status = (res && typeof res.status === 'number') ? res.status : 1;
        exitFn(status);
        return { ok: status === 0, elevated: true, status };
    }

    throw new Error(
        '当前用户对 macOS 应用目录缺少写入权限，且处于非交互式终端，无法弹出 sudo 密码提示。' +
        '请使用 sudo 手动重新运行（例如: sudo node install-context-capsule.js）。\n' +
        '[Permission Denied] Insufficient write permissions for Antigravity.app in a non-TTY shell. Please rerun with sudo.'
    );
}

/**
 * 跨平台通用原子写入 app.asar：先写入同目录临时文件再 rename 覆盖，保持原文件权限 mode，异常时清理 .tmp。
 */
function writeAsarAtomic(asarPath, patchedBuf) {
    let origMode = 0o644;
    try {
        origMode = fs.statSync(asarPath).mode & 0o777;
    } catch (e) {}
    const tmpPath = path.join(path.dirname(asarPath), `.app.asar.agy-pulse-${process.pid}-${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tmpPath, patchedBuf, { mode: origMode });
        try { fs.chmodSync(tmpPath, origMode); } catch (e) {}
        fs.renameSync(tmpPath, asarPath);
    } catch (err) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (cleanupErr) {}
        throw err;
    }
}

const writeAsarAtomicMac = writeAsarAtomic;

function atomicCopyFile(srcPath, destPath) {
    let origMode = 0o644;
    try {
        origMode = fs.statSync(srcPath).mode & 0o777;
    } catch (e) {}
    const tmpPath = path.join(
        path.dirname(destPath),
        `.${path.basename(destPath)}.agy-pulse-${process.pid}-${Date.now()}.tmp`
    );
    try {
        fs.copyFileSync(srcPath, tmpPath);
        try { fs.chmodSync(tmpPath, origMode); } catch (e) {}
        fs.renameSync(tmpPath, destPath);
    } catch (err) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (cleanupErr) {}
        throw err;
    }
}

/**
 * 首次注入前纯净原包原子备份：
 * 仅当非卸载模式、目标 asarPath 存在且 checkAsarStatusFast(asarPath).installed === false 时：
 * - 若 `${asarPath}.orig.bak` 不存在，将原 asarPath 原子拷贝为 `${asarPath}.orig.bak`
 * - 若在 macOS .app 下且 Contents/Info.plist 存在、`Info.plist.orig.bak` 不存在，同步备份 `Info.plist.orig.bak`
 */
function backupOriginalBundleFiles(asarPath, options) {
    const opts = options || {};
    if (opts.uninstall) {
        return { asarBackedUp: false, plistBackedUp: false, skipped: true };
    }
    if (!asarPath || !fs.existsSync(asarPath)) {
        return { asarBackedUp: false, plistBackedUp: false, skipped: true };
    }
    const status = checkAsarStatusFast(asarPath);
    if (status.error || status.installed !== false) {
        return { asarBackedUp: false, plistBackedUp: false, skipped: true };
    }

    let asarBackedUp = false;
    let plistBackedUp = false;

    const asarBakPath = `${asarPath}.orig.bak`;
    if (!fs.existsSync(asarBakPath)) {
        atomicCopyFile(asarPath, asarBakPath);
        asarBackedUp = true;
    }

    const appBundle = opts.appBundle !== undefined ? opts.appBundle : resolveMacAppBundleFromAsar(asarPath);
    if (appBundle) {
        const plistPath = path.join(appBundle, 'Contents', 'Info.plist');
        const plistBakPath = `${plistPath}.orig.bak`;
        if (fs.existsSync(plistPath) && !fs.existsSync(plistBakPath)) {
            atomicCopyFile(plistPath, plistBakPath);
            plistBackedUp = true;
        }
    }

    return { asarBackedUp, plistBackedUp, skipped: false, asarBakPath };
}

/**
 * 构建目标 ASAR 缓冲区：卸载时优先校验并采用纯净原包备份 `.orig.bak`，不可用时回退内存切片还原。
 */
function prepareTargetAsarBuffer(asarPath, origBuf, payloadRaw, options) {
    const opts = options || {};
    const isUninstall = Boolean(opts.uninstall);
    if (isUninstall && asarPath) {
        const asarBakPath = `${asarPath}.orig.bak`;
        if (fs.existsSync(asarBakPath)) {
            const bakStatus = checkAsarStatusFast(asarBakPath);
            if (!bakStatus.error && !bakStatus.installed) {
                const bakBuf = fs.readFileSync(asarBakPath);
                return { patchedBuf: bakBuf, restoredFromOrigBak: true };
            }
        }
    }
    const patchedBuf = patchAsarBufferInMemory(origBuf, payloadRaw, opts);
    return { patchedBuf, restoredFromOrigBak: false };
}

function extractPlistAppAsarHash(plistContent) {
    if (typeof plistContent !== 'string' || !plistContent) return '';
    const m = plistContent.match(
        /<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<key>Resources\/app\.asar<\/key>\s*<dict>(?:(?!<\/dict>)[\s\S])*?<key>hash<\/key>\s*<string>([a-fA-F0-9]{64})<\/string>/
    );
    return m ? m[1].toLowerCase() : '';
}

function restoreMacOrigPlistIfMatched(appBundle, restoredAsarBuf) {
    if (!appBundle || !Buffer.isBuffer(restoredAsarBuf)) return false;
    const plistPath = path.join(appBundle, 'Contents', 'Info.plist');
    const plistBakPath = `${plistPath}.orig.bak`;
    if (!fs.existsSync(plistBakPath)) return false;
    try {
        const origPlist = fs.readFileSync(plistBakPath, 'utf8');
        const asarHeaderHash = computeAsarHeaderHash(restoredAsarBuf).toLowerCase();
        const origPlistHash = extractPlistAppAsarHash(origPlist);
        if (!origPlistHash || origPlistHash === asarHeaderHash) {
            atomicCopyFile(plistBakPath, plistPath);
            return true;
        }
    } catch (e) {}
    return false;
}

/**
 * 清理本地能量胶囊组件、备份、网页端扩展导出目录与重启日志（配合 --uninstall --clean）。
 */
function cleanLocalPulseArtifacts(realHome) {
    const home = realHome || resolveRealUserHome();
    const toolsDir = path.join(home, '.gemini', 'tools');
    const targets = [
        path.join(toolsDir, 'antigravity-pulse-web'),
        path.join(toolsDir, 'capsule-restart.log'),
        path.join(toolsDir, 'apply-capsule-only-bg.ps1'),
        path.join(toolsDir, 'context-capsule-payload.js'),
        path.join(toolsDir, 'context-capsule-payload.js.bak'),
        path.join(toolsDir, 'install-context-capsule.js.bak'),
        path.join(toolsDir, 'install-context-capsule.js')
    ];
    const cleaned = [];
    for (const target of targets) {
        if (fs.existsSync(target)) {
            try {
                fs.rmSync(target, { recursive: true, force: true });
                cleaned.push(target);
            } catch (e) {}
        }
    }
    return cleaned;
}

/**
 * 判定是否需要使用脱离父进程的后台守护通道重启：
 * 仅当显式传入 --schedule / --noop-test，或当前处于 Antigravity/VSCode 内置终端及受限自动化环境时返回 true；
 * 外部独立终端（PowerShell / macOS Terminal 等）默认返回 false，走前台同步更新流。
 */
function shouldUseDetachedDaemon(env, args) {
    const e = env || process.env;
    const a = Array.isArray(args) ? args : [];
    if (a.includes('--sync') || a.includes('--worker') || a.includes('--dry-run')) {
        return false;
    }
    if (a.includes('--schedule') || a.includes('--noop-test')) {
        return true;
    }
    if (
        Boolean(e.VSCODE_PID) ||
        Boolean(e.VSCODE_IPC_HOOK) ||
        Boolean(e.VSCODE_CWD) ||
        Boolean(e.ANTIGRAVITY_CLI && e.ANTIGRAVITY_CLI !== '0') ||
        e.AGY_FORCE_DAEMON === '1' ||
        String(e.TERM_PROGRAM || '').toLowerCase() === 'vscode'
    ) {
        return true;
    }
    return false;
}

/**
 * 交互式重启客户端前确认（仅当显式传入 --confirm 且未传 --yes/-y 时触发）。
 */
function promptRestartConfirmation(options) {
    const opts = options || {};
    const isTTY = typeof opts.isTTY === 'boolean' ? opts.isTTY : Boolean(process.stdin && process.stdin.isTTY);
    const writeFn = typeof opts.write === 'function' ? opts.write : (msg) => process.stdout.write(msg);
    const readLineFn = typeof opts.readLine === 'function' ? opts.readLine : () => {
        const chunks = [];
        const buf = Buffer.alloc(1);
        while (true) {
            let bytes = 0;
            try {
                bytes = fs.readSync(0, buf, 0, 1, null);
            } catch (e) {
                if (e && e.code === 'EAGAIN') {
                    sleepSync(20);
                    continue;
                }
                break;
            }
            if (bytes === 0) break;
            if (buf[0] === 0x0a) break;
            if (buf[0] !== 0x0d) chunks.push(buf[0]);
        }
        return Buffer.from(chunks).toString('utf8');
    };

    if (!isTTY) {
        console.error('[ERROR] 当前处于非交互式终端，无法响应 --confirm 确认提示。若确认继续重启客户端，请追加 --yes 参数重试。');
        return { confirmed: false, exitCode: 1 };
    }

    writeFn('检测到 Antigravity 正在运行，继续操作将重启客户端，是否继续？[Y/n] ');
    const answer = String(readLineFn() || '').trim();
    if (answer.length > 0 && !/^y/i.test(answer)) {
        console.log('[*] 已取消操作，未关闭 Antigravity 客户端。');
        return { confirmed: false, exitCode: 0 };
    }
    return { confirmed: true, exitCode: 0 };
}

/**
 * macOS 守护重启核心执行流：
 * 1. 关闭客户端前先读取并验证内存补丁成功（失败则绝不误关客户端）；
 * 2. 停止客户端后执行备份、原子写入与签名收尾；
 * 3. 若写入或收尾抛错，记录日志后仍调用 startMacAntigravityApp 重新拉起客户端，防止关掉后弃管。
 */
function executeMacDaemonRestartStep(asarPath, payloadRaw, options) {
    const opts = options || {};
    const effectiveArch = opts.effectiveArch || 'auto';
    const realHome = opts.realHome || resolveRealUserHome();
    const isEmbedOnly = Boolean(opts.embedOnly);
    const isUninstall = Boolean(opts.uninstall);
    const waitMs = typeof opts.waitMs === 'number' ? opts.waitMs : 3000;
    const appendLog = typeof opts.appendLog === 'function' ? opts.appendLog : () => {};
    const sleepFn = typeof opts.sleep === 'function' ? opts.sleep : sleepSync;
    const readFileSyncFn = typeof opts.readFileSync === 'function' ? opts.readFileSync : fs.readFileSync;
    const stopFn = typeof opts.stopApp === 'function' ? opts.stopApp : stopMacAntigravityForRestart;
    const backupFn = typeof opts.backupBundle === 'function' ? opts.backupBundle : backupOriginalBundleFiles;
    const writeFn = typeof opts.writeAsar === 'function' ? opts.writeAsar : writeAsarAtomic;
    const finalizeFn = typeof opts.finalizeBundle === 'function' ? opts.finalizeBundle : finalizeMacAppBundle;
    const startFn = typeof opts.startApp === 'function' ? opts.startApp : startMacAntigravityApp;
    const appBundle = opts.appBundle !== undefined ? opts.appBundle : resolveMacAppBundleFromAsar(asarPath);

    let origBuf = null;
    let patchedBuf = null;
    let restoredFromOrigBak = false;
    let elapsedMs = 0;

    try {
        const t0 = Date.now();
        origBuf = readFileSyncFn(asarPath);
        const prep = prepareTargetAsarBuffer(asarPath, origBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall });
        patchedBuf = prep.patchedBuf;
        restoredFromOrigBak = prep.restoredFromOrigBak;
        computeAsarHeaderHash(patchedBuf);
        elapsedMs = Date.now() - t0;
    } catch (prepErr) {
        appendLog('ERROR validating patch before stopping Antigravity: ' + (prepErr && prepErr.message ? prepErr.message : String(prepErr)));
        return { ok: false, stopped: false, relaunched: false, error: prepErr };
    }

    appendLog(`Sleeping ${waitMs}ms before closing Antigravity on macOS ${effectiveArch}...`);
    if (waitMs > 0) sleepFn(waitMs);

    appendLog('Stopping Antigravity gracefully (SIGTERM then cleanup)...');
    stopFn();

    let relaunched = false;
    try {
        if (!isUninstall) {
            backupFn(asarPath, { uninstall: false, appBundle });
        }
        writeFn(asarPath, patchedBuf);
        if (isUninstall && restoredFromOrigBak && appBundle) {
            restoreMacOrigPlistIfMatched(appBundle, patchedBuf);
        }
        const macRes = finalizeFn(asarPath, patchedBuf, { realHome, arch: effectiveArch, appBundle });
        appendLog(
            `Patched app.asar (macOS ${effectiveArch}) atomically in ${elapsedMs}ms (${origBuf.length} -> ${patchedBuf.length} bytes), ` +
            `plistUpdated=${macRes.plistUpdated}, codesigned=${macRes.codesigned}, caches=${(macRes.cleanedCaches || []).length}`
        );
        const targetBundle = (macRes && macRes.appBundle) || appBundle;
        if (targetBundle) {
            relaunched = Boolean(startFn(targetBundle));
            appendLog(`Relaunched macOS appBundle=${targetBundle}, ok=${relaunched}`);
        }
        return { ok: true, stopped: true, relaunched, restoredFromOrigBak };
    } catch (err) {
        appendLog('ERROR in macOS daemon-restart: ' + (err && err.message ? err.message : String(err)));
        if (appBundle && !relaunched) {
            try {
                relaunched = Boolean(startFn(appBundle));
                appendLog(`Fallback relaunch after error appBundle=${appBundle}, ok=${relaunched}`);
            } catch (relaunchErr) {
                appendLog('Fallback relaunch failed: ' + (relaunchErr && relaunchErr.message ? relaunchErr.message : String(relaunchErr)));
            }
        }
        return { ok: false, stopped: true, relaunched, error: err };
    }
}

/**
 * 清理 macOS Antigravity 渲染缓存目录（绝不触碰 User 配置与登录态）。
 */
function cleanMacElectronCache(realHome) {
    const home = realHome || resolveRealUserHome();
    const appSupportDir = path.join(home, 'Library', 'Application Support', 'Antigravity');
    if (!fs.existsSync(appSupportDir)) return [];

    const cacheDirs = ['Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache'];
    const cleaned = [];
    for (const dirName of cacheDirs) {
        const target = path.join(appSupportDir, dirName);
        if (fs.existsSync(target)) {
            try {
                fs.rmSync(target, { recursive: true, force: true });
                cleaned.push(dirName);
            } catch (e) {}
        }
    }
    return cleaned;
}

/**
 * macOS 写入 app.asar 后的收尾：同步 Info.plist ElectronAsarIntegrity、清理缓存、去除隔离属性并 Ad-hoc 深度重签名。
 */
function finalizeMacAppBundle(asarPath, patchedBuf, options) {
    const opts = options || {};
    const realHome = opts.realHome || resolveRealUserHome();
    const execFileSyncFn = typeof opts.execFileSync === 'function' ? opts.execFileSync : child_process.execFileSync;
    const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
    const readFileSyncFn = typeof opts.readFileSync === 'function' ? opts.readFileSync : fs.readFileSync;
    const writeFileSyncFn = typeof opts.writeFileSync === 'function' ? opts.writeFileSync : fs.writeFileSync;

    const appBundle = opts.appBundle !== undefined ? opts.appBundle : resolveMacAppBundleFromAsar(asarPath);
    const asarBytes = Buffer.isBuffer(patchedBuf) ? patchedBuf : readFileSyncFn(asarPath);
    const headerHash = computeAsarHeaderHash(asarBytes);

    let plistUpdated = false;
    if (appBundle) {
        const plistPath = path.join(appBundle, 'Contents', 'Info.plist');
        if (existsFn(plistPath)) {
            let plistContent = '';
            try {
                plistContent = readFileSyncFn(plistPath, 'utf8');
            } catch (e) {}

            if (plistContent && plistContent.includes('ElectronAsarIntegrity')) {
                const nextContent = updatePlistAsarIntegrity(plistContent, headerHash);
                const regexMatched = nextContent !== plistContent || nextContent.includes(headerHash);
                if (nextContent !== plistContent) {
                    writeFileSyncFn(plistPath, nextContent, 'utf8');
                    plistUpdated = true;
                } else if (!regexMatched && existsFn('/usr/libexec/PlistBuddy')) {
                    try {
                        execFileSyncFn('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerHash}`, plistPath], { stdio: 'ignore' });
                        plistUpdated = true;
                    } catch (e) {}
                }
            } else if (existsFn('/usr/libexec/PlistBuddy')) {
                try {
                    execFileSyncFn('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerHash}`, plistPath], { stdio: 'ignore' });
                    plistUpdated = true;
                } catch (e) {}
            }
        }
    }

    const cleanedCaches = cleanMacElectronCache(realHome);

    let codesigned = false;
    if (appBundle && existsFn(appBundle)) {
        try {
            execFileSyncFn('xattr', ['-cr', appBundle], { stdio: 'ignore' });
        } catch (e) {}
        const targetArch = opts.arch || '';
        let signedByArch = false;
        if (targetArch === 'arm64' && existsFn('/usr/bin/arch')) {
            try {
                execFileSyncFn('/usr/bin/arch', ['-arm64', 'codesign', '--force', '--deep', '--sign', '-', appBundle], { stdio: 'pipe' });
                codesigned = true;
                signedByArch = true;
            } catch (eArch) {}
        }
        if (!signedByArch) {
            try {
                execFileSyncFn('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'pipe' });
                codesigned = true;
            } catch (err) {
                const detail = err && err.stderr ? String(err.stderr) : (err && err.message ? err.message : String(err));
                console.warn(`[警告] macOS Ad-hoc 重签名失败，可能导致客户端无法启动: ${detail}`);
            }
        }
    }

    return { headerHash, plistUpdated, cleanedCaches, codesigned, appBundle };
}

function parseRunIdArg(args) {
    if (!Array.isArray(args)) return '';
    let result = '';
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--run-id' && args[i + 1] && !String(args[i + 1]).startsWith('-')) {
            result = String(args[i + 1]);
            i++;
        } else if (typeof a === 'string' && a.startsWith('--run-id=')) {
            const val = a.slice('--run-id='.length);
            if (val && !val.startsWith('-')) result = val;
        }
    }
    return result;
}

function main() {
    const args = process.argv.slice(2);

    // 0. CLI 参数完整性与防呆守卫：遇到未知参数、无 '-' 位置参数或缺值选项直接安全退出 (code 2)
    const cliValidation = validateCliArgs(args);
    if (!cliValidation.ok) {
        console.error(cliValidation.message);
        process.exitCode = cliValidation.exitCode || 2;
        return;
    }

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`Antigravity Pulse 安装器 v${INSTALLER_VERSION}`);
        console.log('用法: node install-context-capsule.js [--check | --ensure | --dry-run | --web-only | --uninstall [--clean] | --embed-only | --confirm | --yes | --asar <path> | --install-dir <path> | --arch <arm64|intel>]');
        console.log('参数说明:');
        console.log('  --check              极速只读巡检 app.asar 钩子状态 (<5ms)');
        console.log('  --ensure             智能自愈：若已挂载热加载钩子则免重启跳过，缺失时自动补齐');
        console.log('  --confirm            关闭运行中的客户端前交互确认（配合 --yes / -y 可免交互放行）');
        console.log('  --uninstall          移除能量胶囊钩子并优先从纯净原包备份恢复');
        console.log('  --clean              配合 --uninstall 清理本地导出目录 (~/.gemini/tools/antigravity-pulse-web) 与日志');
        console.log('  --web-only           仅导出网页端 Chrome/Edge 扩展与 Tampermonkey 油猴脚本');
        console.log('  --dry-run            在系统临时目录演练内存补丁，不修改真实客户端文件');
        console.log('  --embed-only         使用静态内嵌模式注入（不启用热加载动态读取）');
        console.log('  --asar <path>        显式指定 app.asar 文件或安装目录路径');
        console.log('  --install-dir <path> 显式指定客户端安装根目录或 macOS .app 包路径');
        console.log('  --arch <arm64|intel> 指定 macOS 目标架构校验与签名模式 (arm64 | intel | auto)');
        return;
    }

    const isDryRun = args.includes('--dry-run');
    const isSchedule = args.includes('--schedule');
    const isWorker = args.includes('--worker');
    const isDaemonRestart = args.includes('--daemon-restart');
    const isNoopTest = args.includes('--noop-test');
    const isSync = args.includes('--sync');
    const isWebOnly = args.includes('--web-only');
    const isCheck = args.includes('--check');
    const isEnsure = args.includes('--ensure');
    const isEmbedOnly = args.includes('--embed-only');
    const isUninstall = args.includes('--uninstall');
    const isConfirm = args.includes('--confirm');
    const isYes = args.includes('--yes') || args.includes('-y');
    const isClean = args.includes('--clean');

    const customAsarArg = parseAsarArg(args);
    const runIdArg = parseRunIdArg(args);

    const parsedArch = parseArchArg(args);
    let requestedArch = 'auto';
    try {
        requestedArch = normalizeMacArch(parsedArch.raw);
    } catch (archErr) {
        console.error(archErr && archErr.message ? archErr.message : String(archErr));
        process.exitCode = (archErr && archErr.exitCode) || 2;
        return;
    }

    const realHome = resolveRealUserHome();

    const checkArchCompatOrFail = (asarPath) => {
        if (!asarPath) return { ok: true, effectiveArch: requestedArch };
        const appBundle = resolveMacAppBundleFromAsar(asarPath);
        if (process.platform === 'darwin') {
            const hostCanArm64 = detectHostCanArm64();
            const appBinaryArch = appBundle ? detectAppBundleBinaryArch(appBundle) : 'unknown';
            const compat = validateMacArchCompatibility(requestedArch, hostCanArm64, appBinaryArch);
            if (!compat.ok) {
                return compat;
            }
            return { ok: true, effectiveArch: compat.effectiveArch, appBinaryArch };
        }
        return { ok: true, effectiveArch: requestedArch, appBinaryArch: 'unknown' };
    };

    // 1. 极速只读巡检模式 (--check)：无需 payload 文件即可 <5ms 检测 app.asar 钩子状态
    if (isCheck) {
        const asarPath = findAsarPath(customAsarArg, { realHome });
        const compat = checkArchCompatOrFail(asarPath);
        if (!compat.ok) {
            console.error(compat.reason);
            process.exitCode = 1;
            return;
        }
        const status = checkAsarStatusFast(asarPath);
        const archSuffix = (process.platform === 'darwin' || requestedArch !== 'auto')
            ? ` | 架构: macOS ${compat.effectiveArch}`
            : '';
        if (status.installed) {
            console.log(`[INSTALLED] app.asar 已挂载能量胶囊钩子 | 热加载(Reload免重启): ${status.hotReloadCapable ? '已开启' : '旧版静态'}${archSuffix} | 巡检耗时: ${status.elapsedMs}ms | 路径: ${asarPath}`);
        } else {
            console.log(`[MISSING] app.asar 尚未挂载能量胶囊钩子 (可能已被官方更新覆盖)${archSuffix} | 巡检耗时: ${status.elapsedMs}ms | 路径: ${asarPath}`);
            process.exitCode = 1;
        }
        return;
    }

    const defaultPayloadPath = path.join(realHome, '.gemini', 'tools', 'context-capsule-payload.js');
    const localFallbackPath = path.join(__dirname, 'context-capsule-payload.js');
    const payloadPath = fs.existsSync(defaultPayloadPath) ? defaultPayloadPath : localFallbackPath;
    if ((!isUninstall || isWebOnly) && !isNoopTest && !fs.existsSync(payloadPath)) {
        throw new Error('未找到胶囊监控载荷文件: ' + defaultPayloadPath);
    }
    const payloadRaw = ((isUninstall && !isWebOnly) || isNoopTest) ? '' : fs.readFileSync(payloadPath, 'utf8');

    // 1.2 仅导出网页端适配器模式 (--web-only)：严格模式失败返回非零退出码
    if (isWebOnly) {
        try {
            exportWebAdapters(payloadRaw, { realHome, strict: true });
        } catch (e) {
            process.exitCode = 1;
        }
        return;
    }

    // 1.5 独立后台守护重启子进程 (--daemon-restart)
    if (isDaemonRestart) {
        if (process.platform !== 'win32') {
            try { process.on('SIGHUP', () => {}); } catch (e) {}
        }

        const geminiDir = path.join(realHome, '.gemini');
        const toolsDir = path.join(geminiDir, 'tools');
        const geminiExisted = fs.existsSync(geminiDir);
        const toolsExisted = fs.existsSync(toolsDir);
        const logFile = path.join(toolsDir, 'capsule-restart.log');
        const eol = process.platform === 'win32' ? '\r\n' : '\n';
        const tag = process.platform === 'darwin'
            ? 'Mac-Daemon'
            : (process.platform === 'linux' ? 'Linux-Daemon' : 'Explorer-Daemon');
        const appendLog = (msg) => {
            const ts = new Date().toTimeString().slice(0, 8);
            try { fs.appendFileSync(logFile, `[${ts}] [${tag}] ${msg}${eol}`, 'utf8'); } catch (e) {}
        };
        try {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            const ts0 = new Date().toTimeString().slice(0, 8);
            fs.writeFileSync(logFile, `[${ts0}] [${tag}] Handshake OK (runId=${runIdArg || 'manual'}, pid=${process.pid}, ppid=${process.ppid})${eol}`, 'utf8');
            restoreRealUserOwnership(!geminiExisted ? geminiDir : (!toolsExisted ? toolsDir : logFile));
        } catch (e) {}

        if (isNoopTest) {
            appendLog('Noop test finished without touching Antigravity.');
            restoreRealUserOwnership(logFile);
            return;
        }

        const asarPath = findAsarPath(customAsarArg, { realHome });

        if (process.platform === 'darwin') {
            const compat = checkArchCompatOrFail(asarPath);
            if (!compat.ok) {
                appendLog('Arch compatibility check failed: ' + compat.reason);
                restoreRealUserOwnership(logFile);
                return;
            }
            executeMacDaemonRestartStep(asarPath, payloadRaw, {
                effectiveArch: compat.effectiveArch,
                realHome,
                embedOnly: isEmbedOnly,
                uninstall: isUninstall,
                waitMs: 3000,
                appendLog
            });
            if (isUninstall && isClean) {
                cleanLocalPulseArtifacts(realHome);
                return;
            }
            restoreRealUserOwnership(logFile);
            return;
        }

        if (process.platform === 'linux') {
            let origBuf = null;
            let patchedBuf = null;
            let elapsedMs = 0;
            try {
                const t0 = Date.now();
                origBuf = fs.readFileSync(asarPath);
                const prep = prepareTargetAsarBuffer(asarPath, origBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall });
                patchedBuf = prep.patchedBuf;
                computeAsarHeaderHash(patchedBuf);
                elapsedMs = Date.now() - t0;
            } catch (prepErr) {
                appendLog('ERROR validating patch on Linux before stopping app: ' + (prepErr && prepErr.message ? prepErr.message : String(prepErr)));
                restoreRealUserOwnership(logFile);
                return;
            }

            appendLog('Sleeping 3000ms before closing Antigravity on Linux...');
            sleepSync(3000);

            appendLog('Stopping Antigravity on Linux (pkill -TERM -x antigravity)...');
            stopLinuxAntigravityForRestart();

            let relaunched = false;
            try {
                if (!isUninstall) {
                    backupOriginalBundleFiles(asarPath, { uninstall: false });
                }
                writeAsarAtomic(asarPath, patchedBuf);
                appendLog(`Patched app.asar (Linux) atomically in ${elapsedMs}ms (${origBuf.length} -> ${patchedBuf.length} bytes).`);
                relaunched = startLinuxAntigravityApp(asarPath);
                appendLog(`Relaunched Linux Antigravity ok=${relaunched}`);
            } catch (err) {
                appendLog('ERROR in Linux daemon-restart: ' + (err && err.message ? err.message : String(err)));
                if (!relaunched) {
                    const fallbackOk = startLinuxAntigravityApp(asarPath);
                    appendLog(`Fallback relaunch on Linux ok=${fallbackOk}`);
                }
            }
            if (isUninstall && isClean) {
                cleanLocalPulseArtifacts(realHome);
                return;
            }
            restoreRealUserOwnership(logFile);
            return;
        }

        const agyExe = path.join(path.dirname(path.dirname(asarPath)), 'Antigravity.exe');
        const agyDir = path.dirname(agyExe);

        // 关闭客户端前先尝试内存级预校验：若因 ASAR 结构变更（非 EBUSY/EPERM 文件锁）导致不兼容，立即中止避免白关客户端
        try {
            const preBuf = fs.readFileSync(asarPath);
            const prePrep = prepareTargetAsarBuffer(asarPath, preBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall });
            computeAsarHeaderHash(prePrep.patchedBuf);
        } catch (preErr) {
            const code = preErr && preErr.code ? String(preErr.code) : '';
            if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') {
                appendLog('ERROR pre-validating app.asar before stopping Antigravity.exe: ' + (preErr && preErr.message ? preErr.message : String(preErr)));
                return;
            }
        }

        appendLog('Sleeping 3000ms before closing Antigravity.exe...');
        sleepSync(3000);

        appendLog('Stopping Antigravity.exe...');
        for (let i = 0; i < 24; i++) {
            try { child_process.execSync('taskkill /F /IM Antigravity.exe /T >nul 2>nul', { stdio: 'ignore', windowsHide: true }); } catch (e) {}
            if (!isAntigravityRunning()) break;
            sleepSync(250);
        }
        // 额外等待 800ms 确保 Windows 内核释放 Electron 单例命名管道锁
        sleepSync(800);

        try {
            const t0 = Date.now();
            const origBuf = fs.readFileSync(asarPath);
            const prep = prepareTargetAsarBuffer(asarPath, origBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall });
            const patchedBuf = prep.patchedBuf;
            const elapsedMs = Date.now() - t0;
            if (!isUninstall) {
                try { backupOriginalBundleFiles(asarPath, { uninstall: false }); } catch (bakErr) {}
            }
            let writeOk = false;
            let lastErr = null;
            for (let attempt = 1; attempt <= 15; attempt++) {
                try {
                    writeAsarAtomic(asarPath, patchedBuf);
                    writeOk = true;
                    break;
                } catch (err) {
                    lastErr = err;
                    try { child_process.execSync('taskkill /F /IM Antigravity.exe /T >nul 2>nul', { stdio: 'ignore', windowsHide: true }); } catch (e2) {}
                    sleepSync(400);
                }
            }
            if (!writeOk) {
                appendLog('ERROR writing app.asar: ' + (lastErr && lastErr.message));
            } else {
                appendLog(`Patched app.asar OK in ${elapsedMs}ms (${origBuf.length} -> ${patchedBuf.length} bytes).`);
            }
        } catch (patchErr) {
            appendLog('ERROR patching app.asar: ' + (patchErr && patchErr.message));
        }

        sleepSync(300);
        const cleanEnv = Object.assign({}, process.env);
        delete cleanEnv.ELECTRON_RUN_AS_NODE;
        delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
        delete cleanEnv.NODE_OPTIONS;
        delete cleanEnv.VSCODE_IPC_HOOK;
        delete cleanEnv.VSCODE_NLS_CONFIG;

        if (fs.existsSync(agyExe)) {
            appendLog('Launching Antigravity.exe (Stage 1: direct detached spawn under Explorer token)...');
            try {
                const c1 = child_process.spawn(agyExe, [], {
                    cwd: agyDir,
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: false,
                    env: cleanEnv
                });
                c1.unref();
            } catch (e1) {
                appendLog('Stage 1 spawn error: ' + e1.message);
            }
            sleepSync(1800);
            if (isAntigravityRunning()) {
                sleepSync(1000);
            }
            if (!isAntigravityRunning()) {
                appendLog('Stage 1 not alive, trying Stage 2 (explorer.exe shell)...');
                try {
                    const c2 = child_process.spawn('explorer.exe', [agyExe], {
                        cwd: agyDir,
                        detached: true,
                        stdio: 'ignore',
                        env: cleanEnv
                    });
                    c2.unref();
                } catch (e2) {
                    appendLog('Stage 2 spawn error: ' + e2.message);
                }
                sleepSync(2000);
            }
        }
        appendLog('Restart sequence finished. isRunning=' + isAntigravityRunning());
        if (isUninstall && isClean) {
            cleanLocalPulseArtifacts(realHome);
        }
        return;
    }

    const asarPath = isNoopTest ? '' : findAsarPath(customAsarArg, { realHome });
    const agyExe = (asarPath && process.platform === 'win32')
        ? path.join(path.dirname(path.dirname(asarPath)), 'Antigravity.exe')
        : '';

    let effectiveArch = requestedArch;
    if (!isNoopTest && !isDryRun && process.platform === 'darwin') {
        const compat = checkArchCompatOrFail(asarPath);
        if (!compat.ok) {
            console.error(compat.reason);
            process.exitCode = 1;
            return;
        }
        effectiveArch = compat.effectiveArch;
    }

    // 2. 免打扰智能自愈模式 (--ensure)：若已挂载热加载钩子且非闭源静态模式，无需重启客户端，Reload Window 即可生效（不触发 sudo）
    if (isEnsure && !isEmbedOnly && !isUninstall && !isNoopTest) {
        const status = checkAsarStatusFast(asarPath);
        if (status.installed && status.hotReloadCapable) {
            if (!isWorker && !isDryRun) {
                exportWebAdapters(payloadRaw, { realHome });
            }
            const archNote = process.platform === 'darwin' ? ` [macOS ${effectiveArch}]` : '';
            console.log(`[√] 极速巡检通过 (${status.elapsedMs}ms)${archNote}：app.asar 热加载钩子完好，无需重启客户端！在 Antigravity 内执行 Developer: Reload Window 即可秒级生效最新胶囊。`);
            return;
        }
        console.log(`[*] 检测到 app.asar 未安装最新热加载钩子 (installed=${status.installed}, hotReload=${status.hotReloadCapable})，正在自动补齐...`);
    }

    // 2.5 macOS 写权限前置预检（--dry-run / --noop-test 不触发 sudo）
    if (!isDryRun && !isNoopTest && process.platform === 'darwin') {
        ensureMacWritePermissionIfNeeded(asarPath);
    }

    // 2.6 可选交互确认 (--confirm)：若目标客户端正在运行且未传 --yes/-y，先征求用户确认
    if (isConfirm && !isYes && !isDryRun && !isNoopTest && !isWorker && !isDaemonRestart && isAntigravityRunning()) {
        const confirmRes = promptRestartConfirmation();
        if (!confirmRes.confirmed) {
            process.exitCode = confirmRes.exitCode;
            return;
        }
    }

    // 2.7 桌面模式同步导出网页版 Chrome/Edge 扩展与 Tampermonkey 油猴脚本（置于 macOS sudo 预检之后，避免提权前后重复执行）
    if (!isWorker && !isUninstall && !isNoopTest && !isDryRun) {
        exportWebAdapters(payloadRaw, { realHome });
    }

    // 3. 守护进程重启通路：仅在显式 --schedule/--noop-test 或处于内置终端/自动化环境且客户端正在运行时启用
    if (
        !isDryRun &&
        !isWorker &&
        !isSync &&
        shouldUseDetachedDaemon(process.env, args) &&
        (isSchedule || isNoopTest || isAntigravityRunning())
    ) {
        const toolsDir = path.join(realHome, '.gemini', 'tools');
        const logFile = path.join(toolsDir, 'capsule-restart.log');
        const runId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const waitForHandshake = (maxWaitMs) => {
            const steps = Math.max(1, Math.ceil(maxWaitMs / 150));
            for (let w = 0; w < steps; w++) {
                sleepSync(150);
                try {
                    if (fs.existsSync(logFile)) {
                        const txt = fs.readFileSync(logFile, 'utf8');
                        if (txt.includes(runId)) return true;
                    }
                } catch (e) {}
            }
            return false;
        };

        if (process.platform === 'win32') {
            const daemonArgList = [
                `"${__filename}"`,
                '--daemon-restart',
                '--run-id',
                runId
            ];
            if (isNoopTest) daemonArgList.push('--noop-test');
            if (isEmbedOnly) daemonArgList.push('--embed-only');
            if (isUninstall) daemonArgList.push('--uninstall');
            if (isClean) daemonArgList.push('--clean');
            if (requestedArch !== 'auto') daemonArgList.push('--arch', requestedArch);
            if (customAsarArg) daemonArgList.push('--asar', `"${customAsarArg}"`);
            const daemonArgsStr = daemonArgList.join(' ');

            let launchedChannel = '';

            // 通道 1：通过桌面 Shell 窗口接口 (IShellWindows SWC_DESKTOP=8) 由桌面进程派生独立 node.exe，脱离当前终端作业对象生命周期
            try {
                const psExplorer = [
                    "$sw = [Activator]::CreateInstance([Type]::GetTypeFromCLSID('9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
                    '$hwnd = 0',
                    '$desk = $sw.FindWindowSW(0, 0, 8, [ref]$hwnd, 1)',
                    "if ($null -eq $desk) { throw 'Desktop shell window not found' }",
                    "$desk.Document.Application.ShellExecute($env:AGY_EXEC_BIN, $env:AGY_EXEC_ARGS, $env:AGY_EXEC_CWD, 'open', 0)"
                ].join('; ');
                child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psExplorer], {
                    env: Object.assign({}, process.env, {
                        AGY_EXEC_BIN: process.execPath,
                        AGY_EXEC_ARGS: daemonArgsStr,
                        AGY_EXEC_CWD: realHome
                    }),
                    stdio: 'ignore',
                    windowsHide: true
                });
                if (waitForHandshake(2500)) {
                    launchedChannel = 'Explorer-SWC_DESKTOP';
                }
            } catch (eExp) {}

            // 通道 2：回退标准 CIM Win32_Process.Create 启动独立 node.exe 守护进程
            if (!launchedChannel) {
                try {
                    const wmiNodeCmd = `"${process.execPath}" ${daemonArgsStr}`;
                    const psWmi = [
                        '$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:AGY_WMI_CMD }',
                        'if ($res.ReturnValue -ne 0) { throw "WMI Create failed with code $($res.ReturnValue)" }'
                    ].join('; ');
                    child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psWmi], {
                        env: Object.assign({}, process.env, { AGY_WMI_CMD: wmiNodeCmd }),
                        stdio: 'ignore',
                        windowsHide: true
                    });
                    if (waitForHandshake(2000)) {
                        launchedChannel = 'WMI-Win32_Process';
                    }
                } catch (eWmi) {}
            }

            if (!launchedChannel) {
                throw new Error('独立后台守护进程启动握手超时（可能被本机安全软件拦截），请先手动关闭 Antigravity 后在外部终端运行 node install-context-capsule.js');
            }

            if (isNoopTest) {
                console.log(`[√] 脱离 Job 守护握手实测通过 (通道: ${launchedChannel}, runId: ${runId})。`);
                return;
            }

            console.log(`[√] 已通过独立后台守护通道 (${launchedChannel}, runId=${runId}) 握手成功：3 秒后将自动关闭 Antigravity、写入胶囊热加载钩子并重新打开客户端。`);
            return;
        } else {
            // macOS / Linux：脱离终端会话的 detached 守护进程 + SIGHUP 免疫 + runId 握手
            const daemonArgs = [
                __filename,
                '--daemon-restart',
                '--run-id',
                runId
            ];
            if (isNoopTest) daemonArgs.push('--noop-test');
            if (isEmbedOnly) daemonArgs.push('--embed-only');
            if (isUninstall) daemonArgs.push('--uninstall');
            if (isClean) daemonArgs.push('--clean');
            if (requestedArch !== 'auto') daemonArgs.push('--arch', requestedArch);
            if (customAsarArg) daemonArgs.push('--asar', customAsarArg);

            const child = child_process.spawn(process.execPath, daemonArgs, {
                cwd: realHome,
                detached: true,
                stdio: 'ignore',
                env: process.env
            });
            child.unref();

            if (!waitForHandshake(3000)) {
                throw new Error('独立后台守护进程启动握手超时，请先手动关闭 Antigravity 后重试。');
            }

            if (isNoopTest) {
                console.log(`[√] 独立后台守护握手实测通过 (通道: Detached-Daemon, runId: ${runId})。`);
                return;
            }

            if (process.platform === 'linux') {
                console.log(`[√] 已通过独立后台守护通道 (Detached-Daemon, Linux, runId=${runId}) 握手成功：3 秒后将平滑关闭 Antigravity、原子更新 app.asar 并重启客户端。`);
            } else {
                const macUninstNote = isUninstall ? '（注：macOS 因系统本地重签名机制，如需恢复 Apple 官方 Developer ID 签名请覆盖安装官方安装包）' : '';
                console.log(`[√] 已通过独立后台守护通道 (Detached-Daemon, macOS ${effectiveArch}, runId=${runId}) 握手成功：3 秒后将优雅关闭 Antigravity、原子更新 app.asar 并重签名重启客户端。${macUninstNote}`);
            }
            return;
        }
    }

    const t0 = Date.now();
    const origBuf = fs.readFileSync(asarPath);
    const prep = isDryRun
        ? { patchedBuf: patchAsarBufferInMemory(origBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall }), restoredFromOrigBak: false }
        : prepareTargetAsarBuffer(asarPath, origBuf, payloadRaw, { embedOnly: isEmbedOnly, uninstall: isUninstall });
    const patchedBuf = prep.patchedBuf;
    const restoredFromOrigBak = prep.restoredFromOrigBak;
    const elapsedMs = Date.now() - t0;

    if (isDryRun) {
        const dryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-pulse-dryrun-'));
        const testOut = path.join(dryDir, 'app.asar');
        fs.writeFileSync(testOut, patchedBuf);
        console.log(`[DryRun 验证通过] 耗时 ${elapsedMs}ms | 原大小: ${origBuf.length} -> 新大小: ${patchedBuf.length} | 测试包: ${testOut}`);
        return;
    }

    let wasRunning = isAntigravityRunning();
    if (wasRunning) {
        if (process.platform === 'darwin') {
            console.log('[*] 正在优雅关闭 Antigravity 以释放 app.asar...');
            stopMacAntigravityForRestart();
        } else if (process.platform === 'linux') {
            console.log('[*] 正在平滑关闭 Antigravity (Linux) 以释放 app.asar...');
            stopLinuxAntigravityForRestart();
        } else if (process.platform === 'win32') {
            console.log('[*] 正在关闭 Antigravity.exe 以释放 app.asar 文件锁...');
            killAntigravitySync();
            sleepSync(1200);
        }
    }

    if (!isUninstall) {
        backupOriginalBundleFiles(asarPath, { uninstall: false });
    }

    if (process.platform === 'darwin') {
        const appBundle = resolveMacAppBundleFromAsar(asarPath);
        writeAsarAtomic(asarPath, patchedBuf);
        if (isUninstall && restoredFromOrigBak && appBundle) {
            restoreMacOrigPlistIfMatched(appBundle, patchedBuf);
        }
        const macRes = finalizeMacAppBundle(asarPath, patchedBuf, { realHome, arch: effectiveArch });
        if (isUninstall) {
            console.log(`[√] 已无损移除底部栏能量胶囊钩子并还原原始 preload.js [macOS ${effectiveArch}]: ${asarPath}（耗时 ${elapsedMs}ms，codesign=${macRes.codesigned}）。（注：macOS 因系统本地重签名机制，如需恢复 Apple 官方 Developer ID 签名请覆盖安装官方安装包）`);
            if (isClean) {
                const cleaned = cleanLocalPulseArtifacts(realHome);
                if (cleaned.length > 0) console.log(`[√] 已清理本地导出产物: ${cleaned.join(', ')}`);
            }
        } else {
            console.log(`[√] 底部栏「⚡ tok/s ➔ 💊 跑道胶囊 (v${INSTALLER_VERSION} 热加载版)」已独立注入 [macOS ${effectiveArch}]: ${asarPath}（耗时 ${elapsedMs}ms，codesign=${macRes.codesigned}）。`);
        }
        if (!isWorker && wasRunning && macRes.appBundle) {
            startMacAntigravityApp(macRes.appBundle);
            console.log('[√] 已自动重新启动 Antigravity。');
        }
        return;
    }

    if (process.platform === 'linux') {
        writeAsarAtomic(asarPath, patchedBuf);
        if (isUninstall) {
            console.log(`[√] 已无损移除底部栏能量胶囊钩子并还原原始 preload.js [Linux]: ${asarPath}（耗时 ${elapsedMs}ms）。`);
            if (isClean) {
                const cleaned = cleanLocalPulseArtifacts(realHome);
                if (cleaned.length > 0) console.log(`[√] 已清理本地导出产物: ${cleaned.join(', ')}`);
            }
        } else {
            console.log(`[√] 底部栏「⚡ tok/s ➔ 💊 跑道胶囊 (v${INSTALLER_VERSION} 热加载版)」已独立注入 [Linux]: ${asarPath}（耗时 ${elapsedMs}ms）。`);
        }
        if (!isWorker && wasRunning) {
            if (startLinuxAntigravityApp(asarPath)) {
                console.log('[√] 已自动重新启动 Antigravity。');
            }
        }
        return;
    }

    // Windows 写入分支（保留 15 次重试防 EBUSY 逻辑，统一使用原子写入 writeAsarAtomic）
    let writeSuccess = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 15; attempt++) {
        try {
            writeAsarAtomic(asarPath, patchedBuf);
            writeSuccess = true;
            break;
        } catch (err) {
            lastErr = err;
            killAntigravitySync();
            sleepSync(400);
        }
    }
    if (!writeSuccess) {
        throw new Error('写入 app.asar 失败 (请先手动关闭 Antigravity 再重试): ' + (lastErr && lastErr.message));
    }

    if (isUninstall) {
        console.log(`[√] 已无损移除底部栏能量胶囊钩子并还原原始 preload.js: ${asarPath}（耗时 ${elapsedMs}ms）。`);
        if (isClean) {
            const cleaned = cleanLocalPulseArtifacts(realHome);
            if (cleaned.length > 0) console.log(`[√] 已清理本地导出产物: ${cleaned.join(', ')}`);
        }
    } else {
        console.log(`[√] 底部栏「⚡ tok/s ➔ 💊 跑道胶囊 (v${INSTALLER_VERSION} 热加载版)」已独立注入: ${asarPath}（耗时 ${elapsedMs}ms）。`);
    }

    // 若非 --worker 模式（例如外部终端前台更新或 --sync 模式），按需重启客户端
    if (!isWorker && wasRunning && agyExe) {
        startAntigravityApp(agyExe);
        console.log('[√] 已自动重新启动 Antigravity。');
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    CAPSULE_START,
    CAPSULE_END,
    HOT_LOADER_TAG,
    INSTALLER_VERSION,
    WEB_ADAPTER_VERSION,
    sleepSync,
    resolveRealUserHome,
    normalizeMacArch,
    detectMachOArchFromFileOutput,
    validateMacArchCompatibility,
    detectHostCanArm64,
    detectAppBundleBinaryArch,
    parseArchArg,
    ensureDarwinPath,
    restoreRealUserOwnership,
    computeIntegrity,
    computeAsarHeaderHash,
    updatePlistAsarIntegrity,
    buildCapsuleSnippet,
    checkAsarStatusFast,
    cleanOldCapsuleFromPreload,
    patchAsarBufferInMemory,
    exportWebAdapters,
    validateCliArgs,
    parseAsarArg,
    isSkippedMacAppBundlePath,
    resolveAsarFromPath,
    findAsarPath,
    resolveMacAppBundleFromAsar,
    matchMacAntigravityCommOutput,
    isAntigravityRunning,
    stopLinuxAntigravityForRestart,
    startLinuxAntigravityApp,
    startAntigravityApp,
    ensureMacWritePermissionIfNeeded,
    writeAsarAtomic,
    writeAsarAtomicMac,
    backupOriginalBundleFiles,
    prepareTargetAsarBuffer,
    restoreMacOrigPlistIfMatched,
    cleanLocalPulseArtifacts,
    shouldUseDetachedDaemon,
    promptRestartConfirmation,
    executeMacDaemonRestartStep,
    cleanMacElectronCache,
    finalizeMacAppBundle,
    startMacAntigravityApp,
    main
};

