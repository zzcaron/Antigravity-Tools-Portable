'use strict';

/**
 * patch-chinese.js 单元测试与端到端注入验证
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const {
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
  patchAsarBufferInMemory
} = require('./patch-chinese');

/**
 * 辅助函数：构造一个内存中的最小标准 ASAR 二进制缓冲区
 */
function createMockAsar(filesMap) {
  const headerObj = { files: { dist: { files: {} } } };
  const dataChunks = [];
  let currentOffset = 0;

  for (const [relPath, content] of Object.entries(filesMap)) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const integrity = computeIntegrity(buf);
    const fileName = path.basename(relPath);

    headerObj.files.dist.files[fileName] = {
      size: buf.length,
      offset: String(currentOffset),
      integrity
    };

    dataChunks.push(buf);
    currentOffset += buf.length;
  }

  const jsonBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const jsonSize = jsonBuf.length;
  const alignedJsonSize = Math.ceil(jsonSize / 4) * 4;
  const headerSize = 8 + alignedJsonSize;

  const headerPrefix = Buffer.alloc(16 + alignedJsonSize, 0);
  headerPrefix.writeUInt32LE(4, 0);
  headerPrefix.writeUInt32LE(headerSize, 4);
  headerPrefix.writeUInt32LE(headerSize - 4, 8);
  headerPrefix.writeUInt32LE(jsonSize, 12);
  jsonBuf.copy(headerPrefix, 16);

  return {
    buffer: Buffer.concat([headerPrefix, ...dataChunks]),
    headerObj
  };
}

/**
 * 辅助函数：从 ASAR 缓冲区提取指定文件内容
 */
function extractMockAsarFile(asarBuf, relPath) {
  const headerSize = asarBuf.readUInt32LE(4);
  const jsonSize = asarBuf.readUInt32LE(12);
  const dataOffsetBase = 8 + headerSize;
  const headerObj = JSON.parse(asarBuf.subarray(16, 16 + jsonSize).toString('utf8'));

  const fileName = path.basename(relPath);
  const entry = headerObj.files && headerObj.files.dist && headerObj.files.dist.files && headerObj.files.dist.files[fileName];
  if (!entry) return null;

  const off = Number(entry.offset);
  const sz = Number(entry.size);
  return asarBuf.subarray(dataOffsetBase + off, dataOffsetBase + off + sz).toString('utf8');
}

test('1. 汉化资源加载与语法校验', () => {
  const assets = resolveI18nAssets();
  assert.ok(assets.dictJson, '字典对象必须存在');
  assert.ok(assets.dictJson.exact, '字典必须包含 exact 字段');
  assert.ok(Object.keys(assets.dictJson.exact).length > 500, '词条数量应充实');
  assert.ok(assets.runtimeJs && assets.runtimeJs.length > 1000, '运行时脚本内容必须有效');
});

test('2. 纯净汉化代码块生成与标记校验', () => {
  const assets = resolveI18nAssets();
  const snippet = buildChineseSnippet(assets.dictRaw, assets.runtimeJs);

  assert.ok(snippet.includes(CHINESE_START), '必须包含 CHINESE_START 标记');
  assert.ok(snippet.includes(CHINESE_END), '必须包含 CHINESE_END 标记');
  assert.equal(snippet.includes('ContextViewer'), false, '绝不能含有 ContextViewer');
  assert.equal(snippet.includes('ContextMeter'), false, '绝不能含有 ContextMeter');
  assert.equal(snippet.includes('modules.json'), false, '绝不能含有 modules.json');
  assert.equal(snippet.includes('contextMeterAPI'), false, '绝不能含有 contextMeterAPI');

  // 必须通过 JavaScript 语法编译断言
  assert.doesNotThrow(() => {
    new vm.Script(snippet, { filename: 'test-chinese-snippet.js' });
  }, '生成的代码块必须通过 JavaScript 语法校验');
});

test('3. preload 清洗逻辑：精准剥离汉化并清理残留，严格保留 Pulse 胶囊', () => {
  const originalPreload = 'console.log("original preload code");\n';
  const pulseSnippet = '\n/* === AGY_CONTEXT_CAPSULE_START === */\n// Pulse Hook Code\n/* === AGY_CONTEXT_CAPSULE_END === */\n';
  const chineseSnippet = `\n${CHINESE_START}\n// Chinese Runtime Code\n${CHINESE_END}\n`;
  const legacyChinese = `\n${LEGACY_CHINESE_START}\n// Legacy Chinese Code\n${LEGACY_CHINESE_END}\n`;
  const viewerResidual = `\n${METER_PRELOAD_START}\n// Old Viewer Residual Code\n${METER_PRELOAD_END}\n`;

  // 组合含有全部内容的脏 preload
  const dirtyPreload = originalPreload + pulseSnippet + chineseSnippet + legacyChinese + viewerResidual;

  const cleaned = cleanChineseFromPreload(dirtyPreload);

  // 验证：Pulse 胶囊被完整保留
  assert.ok(cleaned.includes('/* === AGY_CONTEXT_CAPSULE_START === */'), 'Pulse 胶囊起始标记必须保留');
  assert.ok(cleaned.includes('// Pulse Hook Code'), 'Pulse 内部载荷必须保留');
  assert.ok(cleaned.includes('/* === AGY_CONTEXT_CAPSULE_END === */'), 'Pulse 胶囊结束标记必须保留');
  assert.ok(cleaned.includes('original preload code'), '原始 preload 代码必须保留');

  // 验证：汉化标记与 ContextViewer 残留被全部彻底移除
  assert.equal(cleaned.includes(CHINESE_START), false, '标准汉化起始标记必须移除');
  assert.equal(cleaned.includes(CHINESE_END), false, '标准汉化结束标记必须移除');
  assert.equal(cleaned.includes(LEGACY_CHINESE_START), false, '旧版汉化起始标记必须移除');
  assert.equal(cleaned.includes(LEGACY_CHINESE_END), false, '旧版汉化结束标记必须移除');
  assert.equal(cleaned.includes(METER_PRELOAD_START), false, '旧版 ContextViewer 注入标记必须移除');
  assert.equal(cleaned.includes(METER_PRELOAD_END), false, '旧版 ContextViewer 注入标记必须移除');
});

test('4. 内存级 ASAR 注入与还原端到端测试（含 Pulse 共存）', () => {
  const assets = resolveI18nAssets();
  const mockFiles = {
    'dist/main.js': 'console.log("host main");',
    'dist/preload.js': 'console.log("host preload");\n/* === AGY_CONTEXT_CAPSULE_START === */\n// Pulse payload active\n/* === AGY_CONTEXT_CAPSULE_END === */',
    'dist/utils.js': 'function setup() { return true; }'
  };

  const { buffer: originalAsarBuf } = createMockAsar(mockFiles);

  // A. 开启汉化
  const patchedBuf = patchAsarBufferInMemory(originalAsarBuf, { enable: true, assets });
  assert.ok(patchedBuf.length > originalAsarBuf.length, '注入汉化后 ASAR 缓冲区应当增大');

  const patchedPreload = extractMockAsarFile(patchedBuf, 'dist/preload.js');
  assert.ok(patchedPreload.includes(CHINESE_START), 'preload 必须包含 CHINESE_START 标记');
  assert.ok(patchedPreload.includes(CHINESE_END), 'preload 必须包含 CHINESE_END 标记');
  assert.ok(patchedPreload.includes('/* === AGY_CONTEXT_CAPSULE_START === */'), 'Pulse 胶囊必须完整共存');
  assert.ok(patchedPreload.includes('// Pulse payload active'), 'Pulse 载荷内容必须完整共存');

  // 验证 utils.js 与 main.js 内容未受破坏
  const utilsContent = extractMockAsarFile(patchedBuf, 'dist/utils.js');
  assert.equal(utilsContent, 'function setup() { return true; }', 'utils.js 必须保持原始未破坏');

  const mainContent = extractMockAsarFile(patchedBuf, 'dist/main.js');
  assert.equal(mainContent, 'console.log("host main");', 'main.js 必须保持原始未破坏');

  // B. 关闭汉化 (恢复英文)
  const restoredBuf = patchAsarBufferInMemory(patchedBuf, { enable: false });
  const restoredPreload = extractMockAsarFile(restoredBuf, 'dist/preload.js');

  assert.equal(restoredPreload.includes(CHINESE_START), false, '还原后不能包含汉化起始标记');
  assert.equal(restoredPreload.includes(CHINESE_END), false, '还原后不能包含汉化结束标记');
  assert.ok(restoredPreload.includes('/* === AGY_CONTEXT_CAPSULE_START === */'), '还原汉化后 Pulse 胶囊依然完好共存');
  assert.ok(restoredPreload.includes('// Pulse payload active'), '还原汉化后 Pulse 载荷依然完好共存');
});

test('5. 纯净性断言：绝不引入 ContextViewer 代码与依赖文件', () => {
  const assets = resolveI18nAssets();
  const mockFiles = {
    'dist/preload.js': 'console.log("base preload");'
  };
  const { buffer: origBuf } = createMockAsar(mockFiles);

  const patchedBuf = patchAsarBufferInMemory(origBuf, { enable: true, assets });

  // 读取 patch 后的 ASAR Header
  const headerSize = patchedBuf.readUInt32LE(4);
  const jsonSize = patchedBuf.readUInt32LE(12);
  const headerObj = JSON.parse(patchedBuf.subarray(16, 16 + jsonSize).toString('utf8'));
  const distFiles = Object.keys(headerObj.files.dist.files);

  // 仅应包含原本的 preload.js，绝不引入 meter-*、local-api 等任何 ContextViewer 依赖文件
  assert.deepEqual(distFiles, ['preload.js'], 'ASAR 中只能含有 preload.js，绝不能引入任何 ContextViewer 文件');

  const forbiddenKeywords = ['meter-main', 'meter-core', 'meter-renderer', 'installContextMeter', 'ContextViewer', 'ContextMeter', 'modules.json'];
  const patchedPreload = extractMockAsarFile(patchedBuf, 'dist/preload.js');
  for (const kw of forbiddenKeywords) {
    assert.equal(patchedPreload.includes(kw), false, `preload.js 中不得包含关键字 "${kw}"`);
  }
});

test('6. 幂等性断言：连续重复开启或关闭绝不造成代码重复膨胀', () => {
  const assets = resolveI18nAssets();
  const mockFiles = {
    'dist/preload.js': 'console.log("preload-init");'
  };
  const { buffer: origBuf } = createMockAsar(mockFiles);

  // 第一次开启
  const patch1 = patchAsarBufferInMemory(origBuf, { enable: true, assets });
  // 第二次开启 (重复执行)
  const patch2 = patchAsarBufferInMemory(patch1, { enable: true, assets });

  const p1Str = extractMockAsarFile(patch1, 'dist/preload.js');
  const p2Str = extractMockAsarFile(patch2, 'dist/preload.js');

  const countOccurrences = (str, sub) => (str.split(sub).length - 1);
  assert.equal(countOccurrences(p2Str, CHINESE_START), 1, '重复开启后起始标记只应出现 1 次');
  assert.equal(countOccurrences(p2Str, CHINESE_END), 1, '重复开启后结束标记只应出现 1 次');
  assert.equal(p1Str, p2Str, '重复开启生成的 preload 内容应当完全一致');

  // 连续两次关闭
  const close1 = patchAsarBufferInMemory(patch2, { enable: false });
  const close2 = patchAsarBufferInMemory(close1, { enable: false });
  const c1Str = extractMockAsarFile(close1, 'dist/preload.js');
  const c2Str = extractMockAsarFile(close2, 'dist/preload.js');

  assert.equal(countOccurrences(c2Str, CHINESE_START), 0, '关闭后起始标记应当彻底消失');
  assert.equal(c1Str, c2Str, '重复关闭后 preload 内容应当保持稳定');
  assert.equal(c2Str.trim(), 'console.log("preload-init");', '最终应完美恢复原始代码');
});

test('7. 复杂 ASAR 文件树结构完整性与前置/后置文件数据检验', () => {
  const assets = resolveI18nAssets();
  const fileA = 'A'.repeat(500);
  const filePreload = 'console.log("mid");';
  const fileZ = 'Z'.repeat(1200);

  const mockFiles = {
    'dist/alpha.js': fileA,
    'dist/preload.js': filePreload,
    'dist/omega.js': fileZ
  };
  const { buffer: origBuf } = createMockAsar(mockFiles);

  // 开启汉化
  const patched = patchAsarBufferInMemory(origBuf, { enable: true, assets });

  // 验证前置文件 alpha.js 未受影响
  assert.equal(extractMockAsarFile(patched, 'dist/alpha.js'), fileA, '位于 preload 之前的文件数据必须 100% 完整一致');
  // 验证后置文件 omega.js 未受影响
  assert.equal(extractMockAsarFile(patched, 'dist/omega.js'), fileZ, '位于 preload 之后的文件数据必须 100% 完整一致');

  // 关闭汉化
  const restored = patchAsarBufferInMemory(patched, { enable: false });
  assert.equal(extractMockAsarFile(restored, 'dist/alpha.js'), fileA, '还原后前置文件依然完整一致');
  assert.equal(extractMockAsarFile(restored, 'dist/omega.js'), fileZ, '还原后后置文件依然完整一致');
  assert.equal(extractMockAsarFile(restored, 'dist/preload.js').trim(), filePreload, '还原后 preload 恢复原状');
});

test('8. 异常容错测试：未闭合的汉化标记与孤立标记清洗，严格保留 Pulse 胶囊', () => {
  const pulseSnippet = '/* === AGY_CONTEXT_CAPSULE_START === */\n// Pulse Hook Active\n/* === AGY_CONTEXT_CAPSULE_END === */';

  // 场景 A: 汉化起始标记未闭合（文件末尾被截断），但后接 Pulse 胶囊
  const dirtyA = `console.log("init");\n${CHINESE_START}\nvar broken = true;\n${pulseSnippet}\n`;
  const cleanedA = cleanChineseFromPreload(dirtyA);
  assert.equal(cleanedA.includes(CHINESE_START), false, '未闭合的汉化起始标记必须被清除');
  assert.equal(cleanedA.includes('var broken = true;'), false, '未闭合标记内的损坏内容必须被清除');
  assert.ok(cleanedA.includes(pulseSnippet), 'Pulse 胶囊必须被严格保留');

  // 场景 B: 孤立的结束标记
  const dirtyB = `console.log("init");\n${CHINESE_END}\n${pulseSnippet}\n`;
  const cleanedB = cleanChineseFromPreload(dirtyB);
  assert.equal(cleanedB.includes(CHINESE_END), false, '孤立的汉化结束标记必须被清除');
  assert.ok(cleanedB.includes(pulseSnippet), 'Pulse 胶囊必须被严格保留');

  // 场景 C: 旧版汉化标记未闭合
  const dirtyC = `console.log("init");\n${LEGACY_CHINESE_START}\nvar oldBroken = 1;\n${pulseSnippet}\n`;
  const cleanedC = cleanChineseFromPreload(dirtyC);
  assert.equal(cleanedC.includes(LEGACY_CHINESE_START), false, '旧版未闭合标记必须被清除');
  assert.ok(cleanedC.includes(pulseSnippet), 'Pulse 胶囊必须被严格保留');
});

test('9. 语法错误写入拦截测试：非法 JavaScript 语法拒绝写入 app.asar', () => {
  const assets = resolveI18nAssets();
  // 构造带有非法语法的 mock preload
  const mockFiles = {
    'dist/preload.js': 'function brokenSyntax( { return ;;;'
  };
  const { buffer: brokenAsar } = createMockAsar(mockFiles);

  assert.throws(() => {
    patchAsarBufferInMemory(brokenAsar, { enable: true, assets });
  }, /语法校验失败/, '当 preload.js 语法非法时必须抛出异常拒绝写入');
});

test('10. 真实环境独立纯净注入验证：绝对不包含 ContextMeter 或 modules.json 运行时磁盘读取', () => {
  const assets = resolveI18nAssets();
  const mockFiles = {
    'dist/preload.js': 'console.log("clean host");'
  };
  const { buffer: origBuf } = createMockAsar(mockFiles);

  const patchedBuf = patchAsarBufferInMemory(origBuf, { enable: true, assets });
  const pStr = extractMockAsarFile(patchedBuf, 'dist/preload.js');

  // 断言绝对不含有 ContextMeter / AntigravityContextMeter / modules.json
  assert.equal(pStr.includes('AntigravityContextMeter'), false, '绝不得含有 AntigravityContextMeter');
  assert.equal(pStr.includes('ContextMeter'), false, '绝不得含有 ContextMeter');
  assert.equal(pStr.includes('modules.json'), false, '绝不得含有 modules.json');
  assert.equal(pStr.includes("require('fs')"), false, 'preload 绝不得在运行时同步引入 fs');
});

test('11. Pulse 卸载保护逻辑测试：当 app.asar 包含汉化时，Pulse 卸载不会以旧备份覆盖汉化', () => {
  const pulseInstaller = require('../packages/pulse/install-context-capsule');
  assert.ok(typeof pulseInstaller.prepareTargetAsarBuffer === 'function', 'prepareTargetAsarBuffer 必须存在');

  const mockPreloadWithChinese = 'console.log("host");\n/* === AGY_CHINESE_START === */\nvar zh = 1;\n/* === AGY_CHINESE_END === */\n/* === AGY_CONTEXT_CAPSULE_START === */\n// Pulse\n/* === AGY_CONTEXT_CAPSULE_END === */';
  const { buffer: asarWithChinese } = createMockAsar({ 'dist/preload.js': mockPreloadWithChinese });

  // 模拟执行卸载 Pulse
  const res = pulseInstaller.prepareTargetAsarBuffer(null, asarWithChinese, '', { uninstall: true });
  assert.equal(res.restoredFromOrigBak, false, '存在汉化时绝不得从无汉化的 origBak 覆盖还原');

  // 检查卸载后的 preload 是否完好保留了汉化标记
  const uninstalledPreload = extractMockAsarFile(res.patchedBuf, 'dist/preload.js');
  assert.ok(uninstalledPreload.includes(CHINESE_START), 'Pulse 卸载后汉化起始标记必须依然完整保留');
  assert.ok(uninstalledPreload.includes(CHINESE_END), 'Pulse 卸载后汉化结束标记必须依然完整保留');
  assert.equal(uninstalledPreload.includes('/* === AGY_CONTEXT_CAPSULE_START === */'), false, 'Pulse 标记必须被成功剥离');
});

