#!/usr/bin/env node
'use strict';

/**
 * Pulse 能量胶囊上限独立同步与注入引擎
 * 作用：在不安装 Context Viewer 的情况下，将后端的上下文解锁上限直接注入到 Pulse 的内存载荷并写入 app.asar
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

function getResolvedTargetLimit(arg) {
  if (arg && !arg.startsWith('-')) {
    const parsed = Number(arg);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 自动从 context-mode.json 探测当前解锁模式
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const modeFile = path.join(localAppData, 'AntigravityContextMeter', 'context-mode.json');
    if (fs.existsSync(modeFile)) {
      const data = JSON.parse(fs.readFileSync(modeFile, 'utf8'));
      if (data.effectiveMode === 'dynamic' || data.mode === '983k' || data.mode === 'dynamic') {
        return 1000000;
      }
      if (data.effectiveMode === 'fixed' && Number(data.limitTokens) > 0) {
        return Number(data.limitTokens);
      }
    }
  } catch {}

  return 256000;
}

function findAsarPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
    path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app.asar')
  ];
  return candidates.find(p => fs.existsSync(p));
}

async function triggerHotReload() {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const portFile = path.join(appData, 'Antigravity', 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) return false;
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    if (!port || isNaN(port)) return false;

    const pages = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json/list`, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      });
      req.setTimeout(2000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });

    const targets = pages.filter(p => p.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\//.test(p.url));
    for (const target of targets) {
      try {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('ws_timeout')), 2000);
          ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
          ws.addEventListener('error', (err) => { clearTimeout(timer); reject(err); }, { once: true });
        });
        ws.send(JSON.stringify({ id: 888, method: 'Page.reload' }));
        await new Promise(r => setTimeout(r, 200));
        try { ws.close(); } catch(e) {}
      } catch (e) {}
    }
    return targets.length > 0;
  } catch {
    return false;
  }
}

async function syncPulseLimit() {
  const args = process.argv.slice(2);
  const targetLimit = getResolvedTargetLimit(args[0]);
  const targetMode = targetLimit >= 1000000 ? 'dynamic' : (targetLimit > 256000 ? 'fixed' : 'default');

  const templateFile = path.join(__dirname, '..', 'packages', 'pulse', 'context-capsule-payload.js');
  if (!fs.existsSync(templateFile)) {
    console.error('未找到 Pulse 载荷模板文件:', templateFile);
    process.exitCode = 1;
    return;
  }

  let content = fs.readFileSync(templateFile, 'utf8');

  // 1. 替换默认上限常量
  content = content.replace(/const DEFAULT_LIMIT = \d+;/, `const DEFAULT_LIMIT = ${targetLimit};`);

  // 2. 注入轻量解锁状态桩（确保未安装 Context Viewer 时 Pulse 也能精准联动）
  const stubCode = `
    // [Antigravity Tools] 独立模式解锁状态桩
    if (!window.contextMeterAPI) {
        window.contextMeterAPI = {
            getContextUnlockStatus: async () => ({
                ok: true,
                data: {
                    configuredMode: '${targetMode}',
                    configuredLimitTokens: ${targetLimit}
                }
            })
        };
    }
`;
  content = content.replace(
    "window.__AGY_CTX_CAPSULE_ACTIVE__ = true;",
    "window.__AGY_CTX_CAPSULE_ACTIVE__ = true;" + stubCode
  );

  // 3. 写入用户主目录备用热载荷
  const targetDir = path.join(os.homedir(), '.gemini', 'tools');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const hotPayloadFile = path.join(targetDir, 'context-capsule-payload.js');
  fs.writeFileSync(hotPayloadFile, content, 'utf8');

  // 4. 将最新载荷原子注入客户端 app.asar
  const asarPath = findAsarPath();
  if (asarPath && fs.existsSync(asarPath)) {
    try {
      const pulseInstaller = require(path.join(__dirname, '..', 'packages', 'pulse', 'install-context-capsule.js'));
      const origBuf = fs.readFileSync(asarPath);
      const patched = pulseInstaller.patchAsarBufferInMemory(origBuf, content, {});
      fs.writeFileSync(asarPath, patched);
      console.log(`[Pulse 同步] 已成功将 ${targetLimit.toLocaleString()} tokens 固化写入 app.asar`);
    } catch (e) {
      console.log(`[Pulse 同步] app.asar 写入提示: ${e.message}`);
    }
  }

  const label = targetLimit >= 1000000
    ? (targetLimit / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    : (targetLimit / 1000).toFixed(1).replace(/\.0$/, '') + 'k';

  console.log(`[Pulse 同步] 能量胶囊显示上限已就绪: ${label}`);

  // 5. 触发免重启刷新
  await triggerHotReload();
}

syncPulseLimit().catch(e => {
  console.error('同步失败:', e);
  process.exitCode = 1;
});
