#!/usr/bin/env node
'use strict';

/**
 * Antigravity 客户端界面独立汉化补丁引擎 (方案 A: 极轻量纯净版)
 *
 * 功能说明：
 * 1. 彻底与 ContextViewer (上下文查看器) 解耦，不打包任何 meter-* 脚本或额外模块依赖；
 * 2. 仅提取 packages/viewer/i18n/ 目录下的 zh-CN.json 词典与 i18n-runtime.js 运行时；
 * 3. 采用内存级 ASAR 原位手术刀补丁，精准注入与剥离 app.asar 的 dist/preload.js；
 * 4. 严格使用 /* === AGY_CHINESE_START === *\/ 与 /* === AGY_CHINESE_END === *\/ 标记；
 * 5. 与 Pulse 能量胶囊完全兼容、同源并存，互不覆盖冲刷；
 * 6. 支持 --enable（开启汉化）、--disable / --uninstall（关闭汉化恢复原生英文）、--check / --status（巡检状态）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');
const vm = require('vm');

// 标记定义
const CHINESE_START = '/* === AGY_CHINESE_START === */';
const CHINESE_END   = '/* === AGY_CHINESE_END === */';
const LEGACY_CHINESE_START = '// --- Antigravity Chinese Localization Injection Start ---';
const LEGACY_CHINESE_END   = '// --- Antigravity Chinese Localization Injection End ---';
const METER_PRELOAD_START  = '// --- Antigravity Context Meter preload Injection Start ---';
const METER_PRELOAD_END    = '// --- Antigravity Context Meter preload Injection End ---';
const CAPSULE_START        = '/* === AGY_CONTEXT_CAPSULE_START === */';
const CAPSULE_END          = '/* === AGY_CONTEXT_CAPSULE_END === */';

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 寻找并读取 i18n 资源文件 (zh-CN.json 与 i18n-runtime.js)
 */
function resolveI18nAssets(customDir) {
  const searchDirs = [
    customDir,
    path.join(__dirname, '..', 'packages', 'viewer', 'i18n'),
    path.join(__dirname, 'i18n'),
    path.join(__dirname, '..', 'i18n')
  ].filter(Boolean);

  let dictPath = null;
  let runtimePath = null;

  for (const d of searchDirs) {
    const dp = path.join(d, 'zh-CN.json');
    const rp = path.join(d, 'i18n-runtime.js');
    if (!dictPath && fs.existsSync(dp)) dictPath = dp;
    if (!runtimePath && fs.existsSync(rp)) runtimePath = rp;
    if (dictPath && runtimePath) break;
  }

  if (!dictPath || !runtimePath) {
    throw new Error('未找到汉化资源文件 (zh-CN.json 或 i18n-runtime.js)，请确保 packages/viewer/i18n/ 目录完整。');
  }

  const dictRaw = fs.readFileSync(dictPath, 'utf8');
  const runtimeJs = fs.readFileSync(runtimePath, 'utf8');

  // 校验字典 JSON 合法性
  let dictJson = null;
  try {
    dictJson = JSON.parse(dictRaw);
  } catch (jsonErr) {
    throw new Error(`zh-CN.json 解析失败: ${jsonErr.message}`);
  }

  // 校验运行时 JavaScript 语法合法性
  try {
    new vm.Script(runtimeJs, { filename: 'i18n-runtime.js' });
  } catch (rtErr) {
    throw new Error(`i18n-runtime.js 语法校验失败: ${rtErr.message}`);
  }

  return {
    dictPath,
    runtimePath,
    dictJson,
    dictRaw: JSON.stringify(dictJson),
    runtimeJs
  };
}

/**
 * 生成纯净汉化注入代码块 (方案 A: 极轻量、纯净无外部依赖)
 */
function buildChineseSnippet(dictRaw, runtimeJs) {
  const dictStr = typeof dictRaw === 'string' ? dictRaw.trim() : JSON.stringify(dictRaw);
  return `\n${CHINESE_START}\n` +
    `(function() {\n` +
    `  try {\n` +
    `    var _i18nConfig = { enabled: true, language: 'zh-CN', brandTitle: 'english' };\n` +
    `    var _dictData = ${dictStr};\n` +
    `    if (typeof window !== 'undefined') {\n` +
    `      window.__AGY_I18N_CONFIG__ = _i18nConfig;\n` +
    `      window.__AGY_I18N_DATA__ = _dictData;\n` +
    `    }\n` +
    `    if (typeof globalThis !== 'undefined') {\n` +
    `      globalThis.__AGY_I18N_CONFIG__ = _i18nConfig;\n` +
    `      globalThis.__AGY_I18N_DATA__ = _dictData;\n` +
    `    }\n` +
    `    ${runtimeJs.trim()}\n` +
    `  } catch (e) {\n` +
    `    if (typeof console !== 'undefined' && console.warn) {\n` +
    `      console.warn('[AGY-i18n] Runtime Injection Error:', e);\n` +
    `    }\n` +
    `  }\n` +
    `})();\n` +
    `${CHINESE_END}\n`;
}

/**
 * 清洗 preload.js 中的汉化注入代码，同时顺带清理可能存在的 ContextViewer 注入残留
 * 注意：必须严格保留 Pulse 能量胶囊代码块
 */
function cleanChineseFromPreload(preloadStr) {
  if (!preloadStr || typeof preloadStr !== 'string') return '';
  let str = preloadStr;

  // 1. 移除成对的标准汉化标记块
  const stdRe = new RegExp(`\\r?\\n?\\s*${escapeRegex(CHINESE_START)}[\\s\\S]*?${escapeRegex(CHINESE_END)}\\r?\\n?`, 'g');
  str = str.replace(stdRe, '\n');

  // 2. 移除成对的旧版汉化标记块
  const legacyRe = new RegExp(`\\r?\\n?\\s*${escapeRegex(LEGACY_CHINESE_START)}[\\s\\S]*?${escapeRegex(LEGACY_CHINESE_END)}\\r?\\n?`, 'g');
  str = str.replace(legacyRe, '\n');

  // 3. 顺带清理可能遗留的 ContextViewer preload 标记注入（确保纯净无残留）
  const meterRe = new RegExp(`\\r?\\n?\\s*${escapeRegex(METER_PRELOAD_START)}[\\s\\S]*?${escapeRegex(METER_PRELOAD_END)}\\r?\\n?`, 'g');
  str = str.replace(meterRe, '\n');

  // 4. 清理旧版无标记的 ContextViewer API 注入
  const legacyMeterRe = /\r?\n?\/\/ Context Meter v2: narrow read-only conversation scan API\r?\nelectron_1\.contextBridge\.exposeInMainWorld\("contextMeterAPI",\s*\{[\s\S]*?\}\);\r?\n?/g;
  str = str.replace(legacyMeterRe, '\n');

  // 5. 防御性处理：未闭合的汉化起始标记（例如被异常截断或损坏）
  if (str.includes(CHINESE_START)) {
    const unclosedStdRe = new RegExp(`\\r?\\n?\\s*${escapeRegex(CHINESE_START)}[\\s\\S]*?(?=${escapeRegex(CAPSULE_START)}|$)`, 'g');
    str = str.replace(unclosedStdRe, '\n');
  }
  if (str.includes(LEGACY_CHINESE_START)) {
    const unclosedLegacyRe = new RegExp(`\\r?\\n?\\s*${escapeRegex(LEGACY_CHINESE_START)}[\\s\\S]*?(?=${escapeRegex(CAPSULE_START)}|$)`, 'g');
    str = str.replace(unclosedLegacyRe, '\n');
  }

  // 6. 防御性处理：孤立的结束标记
  if (str.includes(CHINESE_END)) {
    str = str.replace(new RegExp(`\\r?\\n?\\s*${escapeRegex(CHINESE_END)}\\r?\\n?`, 'g'), '\n');
  }
  if (str.includes(LEGACY_CHINESE_END)) {
    str = str.replace(new RegExp(`\\r?\\n?\\s*${escapeRegex(LEGACY_CHINESE_END)}\\r?\\n?`, 'g'), '\n');
  }

  return str.trimEnd() + '\n';
}

/**
 * 计算 ASAR 条目的 SHA-256 integrity 属性
 */
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
 * 计算 ASAR 头部 JSON 字符串的 SHA-256 十六进制摘要（macOS 校验使用）
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
 * 更新 macOS Info.plist 中的 ElectronAsarIntegrity 校验值
 */
function updatePlistAsarIntegrity(plistContent, headerHash) {
  if (!plistContent || !headerHash) return plistContent;
  const normalizedHash = String(headerHash).toLowerCase().trim();
  const integrityRegex = /(<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<key>Resources\/app\.asar<\/key>\s*<dict>(?:(?!<\/dict>)[\s\S])*?<key>hash<\/key>\s*<string>)[a-fA-F0-9]{64}(<\/string>)/;
  if (!integrityRegex.test(plistContent)) {
    return plistContent;
  }
  return plistContent.replace(integrityRegex, `$1${normalizedHash}$2`);
}

/**
 * 内存级直接修改 ASAR 缓冲区，注入或移除汉化补丁
 */
function patchAsarBufferInMemory(asarBuf, options = {}) {
  const enable = options.enable !== false; // 默认值为 true (开启)
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

  // 1. 清洗既有汉化代码与 ContextViewer preload 残留
  const cleanedPreloadStr = cleanChineseFromPreload(oldPreloadStr);

  let newPreloadStr = cleanedPreloadStr;
  if (enable) {
    const assets = options.assets || resolveI18nAssets();
    const snippet = buildChineseSnippet(assets.dictRaw, assets.runtimeJs);
    newPreloadStr = cleanedPreloadStr.trimEnd() + '\n' + snippet;
  }

  // 2. 对最终 JavaScript 语法做严格校验断言
  try {
    new vm.Script(newPreloadStr, { filename: 'dist/preload.js' });
  } catch (synErr) {
    throw new Error(`注入后 dist/preload.js 语法校验失败: ${synErr.message}`);
  }

  const newPreloadBuf = Buffer.from(newPreloadStr, 'utf8');
  const newSize = newPreloadBuf.length;
  const delta = newSize - oldSize;

  // 3. 递归更新位于 preload.js 后续所有条目的 offset
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

  // 4. 重建 ASAR 头部，执行 4 字节对其填充
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

/**
 * 极速只读巡检 app.asar 内部的汉化与 Pulse 状态（耗时通常小于 5ms）
 */
function checkAsarChineseStatus(asarPath) {
  const t0 = Date.now();
  let fd = null;
  try {
    fd = fs.openSync(asarPath, 'r');
    const prefix = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, prefix, 0, 16, 0);
    if (bytesRead < 16 || prefix.readUInt32LE(0) !== 4) {
      return { installed: false, error: '无效的 ASAR 头部格式', elapsedMs: Date.now() - t0 };
    }
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    const dataOffsetBase = 8 + headerSize;

    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const headerObj = JSON.parse(jsonBuf.toString('utf8'));
    const preloadEntry = headerObj.files && headerObj.files.dist && headerObj.files.dist.files && headerObj.files.dist.files['preload.js'];
    if (!preloadEntry || preloadEntry.unpacked || preloadEntry.offset === undefined) {
      return { installed: false, error: '未找到 dist/preload.js 条目', elapsedMs: Date.now() - t0 };
    }
    const pOffset = Number(preloadEntry.offset);
    const pSize = Number(preloadEntry.size);
    const pBuf = Buffer.alloc(pSize);
    fs.readSync(fd, pBuf, 0, pSize, dataOffsetBase + pOffset);
    const pStr = pBuf.toString('utf8');

    const installed = pStr.includes(CHINESE_START) || pStr.includes(LEGACY_CHINESE_START);
    const pulseInstalled = pStr.includes(CAPSULE_START);

    // 全面深度检测 ContextViewer 残留（包括文件树残留与 preload 残留）
    const distFiles = (headerObj.files && headerObj.files.dist && headerObj.files.dist.files)
      ? Object.keys(headerObj.files.dist.files)
      : [];
    const hasViewerFiles = distFiles.some(f => f.startsWith('meter-') || f === 'modules-config.js' || f === 'modular-installer.js' || f === 'local-api.js');
    const nonPulsePreload = pStr.replace(/\/\* === AGY_CONTEXT_CAPSULE_START === \*\/[\s\S]*?\/\* === AGY_CONTEXT_CAPSULE_END === \*\//g, '');
    const hasViewerPreload = nonPulsePreload.includes(METER_PRELOAD_START) || nonPulsePreload.includes('contextMeterAPI') || nonPulsePreload.includes('AntigravityContextMeter');
    const contextViewerInstalled = hasViewerFiles || hasViewerPreload;

    return {
      installed,
      pulseInstalled,
      contextViewerInstalled,
      preloadSize: pSize,
      elapsedMs: Date.now() - t0
    };
  } catch (err) {
    return {
      installed: false,
      error: err && err.message ? err.message : String(err),
      elapsedMs: Date.now() - t0
    };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) {}
    }
  }
}

/**
 * 自动定位宿主客户端 app.asar 路径
 */
function findAsarPath(customPath) {
  if (customPath) {
    const p = path.resolve(customPath);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const candidate = path.join(p, 'resources', 'app.asar');
        if (fs.existsSync(candidate)) return candidate;
      } else if (p.endsWith('app.asar')) {
        return p;
      }
    }
    throw new Error(`指定的路径不存在或不包含有效 app.asar: ${customPath}`);
  }

  const candidates = [];

  // 1. Windows: 优先通过当前运行中的 Antigravity.exe 反查资源路径
  if (process.platform === 'win32') {
    try {
      const exeOut = child_process.execSync(
        'powershell.exe -NoProfile -Command "(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (exeOut && fs.existsSync(exeOut)) {
        candidates.push(path.join(path.dirname(exeOut), 'resources', 'app.asar'));
      }
    } catch (e) {}
  }

  // 2. 常用默认安装路径检查
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  candidates.push(path.join(localApp, 'Programs', 'antigravity', 'resources', 'app.asar'));
  candidates.push(path.join(localApp, 'Programs', 'Antigravity', 'resources', 'app.asar'));
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Antigravity', 'resources', 'app.asar'));
  }

  // 3. macOS 路径检查
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Antigravity.app/Contents/Resources/app.asar');
    candidates.push(path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar'));
  }

  // 4. Linux 路径检查
  if (process.platform === 'linux') {
    candidates.push('/opt/Antigravity/resources/app.asar');
    candidates.push('/opt/antigravity/resources/app.asar');
    candidates.push('/usr/share/antigravity/resources/app.asar');
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  throw new Error('未找到 Antigravity app.asar，已检索候选路径: \n' + candidates.join('\n'));
}

/**
 * 安全持久化写回 app.asar（含备份机制、原子性与 Windows 句柄保护）
 */
function safeWriteAsar(asarPath, patchedBuf) {
  const asarDir = path.dirname(asarPath);

  // 1. 自动维护原始纯净金标备份（若尚不存在）
  const goldBackup = path.join(asarDir, 'app.asar.orig.bak');
  if (!fs.existsSync(goldBackup)) {
    try {
      fs.copyFileSync(asarPath, goldBackup);
    } catch (e) {}
  }

  // 2. 写入模式：优先原地 r+ 打开写回（Windows 下运行中客户端通常允许 r+ 打开共享写并截断）
  let written = false;
  let lastErr = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const fd = fs.openSync(asarPath, 'r+');
      try {
        fs.writeSync(fd, patchedBuf, 0, patchedBuf.length, 0);
        fs.ftruncateSync(fd, patchedBuf.length);
        written = true;
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (err) {
      lastErr = err;
      // 备选方案：尝试临时文件重命名写入
      const tmpPath = path.join(asarDir, `.app.asar.agy-zh-${process.pid}-${Date.now()}.tmp`);
      try {
        fs.writeFileSync(tmpPath, patchedBuf);
        fs.renameSync(tmpPath, asarPath);
        written = true;
        break;
      } catch (renameErr) {
        lastErr = renameErr;
      } finally {
        try {
          if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
          }
        } catch (cleanErr) {}
      }
      // 短暂休眠后重试
      const waitEnd = Date.now() + 200;
      while (Date.now() < waitEnd) {}
    }
  }

  if (!written) {
    throw new Error(`写入 app.asar 失败 (文件可能被独占锁定，请先退出 Antigravity 客户端后重试): ${lastErr && lastErr.message}`);
  }

  // 3. macOS 环境自动同步 Info.plist 摘要与签名
  if (process.platform === 'darwin') {
    try {
      let cur = path.resolve(asarPath);
      let appBundle = '';
      for (let i = 0; i < 5; i++) {
        if (cur.endsWith('.app')) { appBundle = cur; break; }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      if (appBundle) {
        const plistPath = path.join(appBundle, 'Contents', 'Info.plist');
        if (fs.existsSync(plistPath)) {
          const plistContent = fs.readFileSync(plistPath, 'utf8');
          const headerHash = computeAsarHeaderHash(patchedBuf);
          const updated = updatePlistAsarIntegrity(plistContent, headerHash);
          if (updated !== plistContent) {
            fs.writeFileSync(plistPath, updated, 'utf8');
          }
        }
      }
    } catch (macErr) {}
  }
}

/**
 * 协同维护 modules.json 状态（若存在本地配置）
 */
function syncModulesConfig(enable) {
  try {
    const localApp = process.platform === 'win32'
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
      : (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.local', 'state'));
    const cfgPath = path.join(localApp, 'AntigravityContextMeter', 'modules.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.modules && cfg.modules.chinese) {
        cfg.modules.chinese.enabled = enable;
        cfg.modules.chinese.language = enable ? 'zh-CN' : 'en';
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
      }
    }
  } catch (e) {}
}

/**
 * 核心执行函数
 */
async function runChinesePatch(options = {}) {
  const isEnable = options.enable !== false;
  const asarPath = options.path || findAsarPath();

  const origBuf = fs.readFileSync(asarPath);
  const patchedBuf = patchAsarBufferInMemory(origBuf, { enable: isEnable });

  safeWriteAsar(asarPath, patchedBuf);
  syncModulesConfig(isEnable);

  const status = checkAsarChineseStatus(asarPath);
  return {
    success: true,
    enabled: isEnable,
    asarPath,
    preloadSize: status.preloadSize,
    pulsePreserved: status.pulseInstalled
  };
}

/**
 * 命令行主入口
 */
async function main() {
  const args = process.argv.slice(2);
  let customPath = null;
  let mode = 'enable'; // 默认开启

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--enable' || a === 'enable' || a === 'install' || a === 'on') {
      mode = 'enable';
    } else if (a === '--disable' || a === 'disable' || a === '--uninstall' || a === 'uninstall' || a === 'off' || a === 'restore') {
      mode = 'disable';
    } else if (a === '--check' || a === '--status' || a === 'status') {
      mode = 'check';
    } else if (a === '--path' || a === '-p') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        throw new Error('未指定 --path 参数的目标路径。用法: --path <app.asar>');
      }
      customPath = args[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(`用法:
  node patch-chinese.js [命令] [选项]

命令:
  --enable               开启客户端界面简体中文 (默认)
  --disable              关闭客户端界面简体中文 (恢复官方英文)
  --check                巡检当前客户端 app.asar 的汉化与胶囊挂载状态

选项:
  --path <app.asar>      指定自定义 app.asar 路径
  --help, -h             显示帮助信息
`);
      return;
    }
  }

  const asarPath = findAsarPath(customPath);

  if (mode === 'check') {
    const s = checkAsarChineseStatus(asarPath);
    console.log(`[巡检报告] 耗时: ${s.elapsedMs}ms | 路径: ${asarPath}`);
    console.log(`  - 界面简体中文: ${s.installed ? '🟢 已注入启用' : '⚪ 未启用 (官方原生英文)'}`);
    console.log(`  - Pulse 能量胶囊: ${s.pulseInstalled ? '🟢 已共存挂载' : '⚪ 未安装'}`);
    console.log(`  - ContextViewer 残留: ${s.contextViewerInstalled ? '⚠️ 存在残留' : '✅ 0 残留 (纯净)'}`);
    console.log(`  - preload.js 尺寸: ${s.preloadSize ? s.preloadSize.toLocaleString() + ' 字节' : '未知'}`);
    return;
  }

  const isEnable = mode === 'enable';
  console.log(`[*] 正在${isEnable ? '开启' : '关闭'} Antigravity 界面简体中文 (独立纯净方案)...`);
  console.log(`[*] 目标文件: ${asarPath}`);

  const res = await runChinesePatch({ enable: isEnable, path: asarPath });

  if (res.enabled) {
    console.log(`✅ 客户端界面简体中文已成功注入 app.asar (dist/preload.js 大小: ${res.preloadSize.toLocaleString()} 字节)！`);
    if (res.pulsePreserved) {
      console.log('✅ 检测到已安装的 Pulse 能量胶囊，已完整保留共存，互不干扰！');
    }
  } else {
    console.log(`✅ 客户端界面汉化已彻底剥离，已恢复为官方原生英文界面！`);
    if (res.pulsePreserved) {
      console.log('✅ 检测到已安装的 Pulse 能量胶囊，已完整保留共存！');
    }
  }
}

module.exports = {
  CHINESE_START,
  CHINESE_END,
  LEGACY_CHINESE_START,
  LEGACY_CHINESE_END,
  METER_PRELOAD_START,
  METER_PRELOAD_END,
  resolveI18nAssets,
  buildChineseSnippet,
  cleanChineseFromPreload,
  computeIntegrity,
  computeAsarHeaderHash,
  updatePlistAsarIntegrity,
  patchAsarBufferInMemory,
  checkAsarChineseStatus,
  findAsarPath,
  safeWriteAsar,
  runChinesePatch
};

if (require.main === module) {
  main().catch(err => {
    console.error(`❌ 执行失败: ${err.message}`);
    process.exit(1);
  });
}
