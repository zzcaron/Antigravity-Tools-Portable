const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

async function triggerHotReload() {
    try {
        const appData = process.env.APPDATA || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support')
            : path.join(os.homedir(), '.config'));
        const portFile = path.join(appData, 'Antigravity', 'DevToolsActivePort');
        if (!fs.existsSync(portFile)) {
            return { ok: false, reason: '未找到 DevToolsActivePort 端口文件 (客户端未运行或未开启调试端口)' };
        }
        const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
        if (!port || isNaN(port)) {
            return { ok: false, reason: '端口文件无效' };
        }

        const pages = await new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}/json/list`, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                });
            });
            req.setTimeout(2500, () => req.destroy(new Error('timeout')));
            req.on('error', reject);
        });

        const targets = pages.filter(p => p.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\//.test(p.url));
        if (!targets.length) {
            return { ok: false, reason: '未找到活动的 Antigravity 前端窗口' };
        }

        let reloaded = 0;
        for (const target of targets) {
            try {
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('ws_timeout')), 2500);
                    ws.addEventListener('open', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                    ws.addEventListener('error', (err) => {
                        clearTimeout(timer);
                        reject(err);
                    }, { once: true });
                });

                ws.send(JSON.stringify({ id: 999, method: 'Page.reload' }));
                reloaded++;
                await new Promise(r => setTimeout(r, 300));
                try { ws.close(); } catch(e) {}
            } catch (wsErr) {}
        }

        return { ok: reloaded > 0, reloadedCount: reloaded };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function main() {
    const res = await triggerHotReload();
    if (res.ok) {
        console.log(`✅ [热重载] 成功向 ${res.reloadedCount} 个活动窗口发送刷新指令，汉化与UI配置已秒级即时生效！`);
    } else {
        console.log(`⚪ [热重载] 当前未检测到运行中的窗口 (${res.reason || res.error || '跳过'})。`);
        // 若没有活动窗口，检查并尝试启动客户端
        const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const agyCandidates = [
            path.join(localApp, 'Programs', 'antigravity', 'Antigravity.exe'),
            path.join(localApp, 'Programs', 'Antigravity', 'Antigravity.exe')
        ];
        const agyExe = agyCandidates.find(p => fs.existsSync(p));
        if (agyExe) {
            console.log(`🚀 [自动拉起] 正在启动 Antigravity 客户端: ${agyExe}`);
            try {
                const child = child_process.spawn(agyExe, [], { detached: true, stdio: 'ignore' });
                child.unref();
            } catch (e) {
                console.log(`⚠️ 自动启动失败: ${e.message}，请手动打开客户端。`);
            }
        }
    }
}

main().catch(err => {
    console.error('执行出错:', err);
});
