/**
 * Antigravity 底部工具栏「本地权限 / Turbo」旁 3A 冷雾莫兰迪跑道胶囊上下文监控模块 (v1.3.1)
 * 运行环境：客户端渲染进程 Main World / 浏览器扩展 MAIN World (同源 Connect-RPC + React Fiber 精准会话隔离)
 */
(function () {
    if (window.__AGY_CTX_CAPSULE_ACTIVE__) return;

    const CAPSULE_VERSION = '1.3.1';

    // 网页端非 Antigravity 站点快速排除守卫 (避免在 Gmail / Google 搜索 / Cloud / Colab 等无关或敏感页面挂载钩子)
    const isElectronHost = typeof navigator !== 'undefined' && /Antigravity|Electron/i.test(navigator.userAgent || '');
    if (!isElectronHost && typeof location !== 'undefined') {
        const host = (location.hostname || '').toLowerCase();
        const excludedGoogleHosts = new Set([
            'www.google.com',
            'mail.google.com',
            'docs.google.com',
            'drive.google.com',
            'calendar.google.com',
            'meet.google.com',
            'maps.google.com',
            'photos.google.com',
            'play.google.com',
            'translate.google.com',
            'accounts.google.com',
            'myaccount.google.com',
            'pay.google.com',
            'admin.google.com',
            'console.cloud.google.com',
            'colab.research.google.com',
            'www.youtube.com',
            'music.youtube.com'
        ]);
        if (excludedGoogleHosts.has(host) && !/^\/(antigravity|jetski)(\/|$)/i.test(location.pathname || '')) {
            return;
        }
    }

    window.__AGY_CTX_CAPSULE_ACTIVE__ = true;
    window.__AGY_CTX_CAPSULE_VERSION__ = CAPSULE_VERSION;

    // 3A 冷雾莫兰迪配色 (微提 12% 饱和度，日夜双模式高辨识度)
    const MORANDI_3A = {
        green: '#5E9E8E',  // 雾松青 (充足: 剩余 > 50% / 已用 < 50%)
        yellow: '#C6A265', // 沙金黄 (过半: 剩余 20%~50% / 已用 50%~80%)
        red: '#C26C77'     // 烟玫瑰 (告急: 剩余 <= 20% / 已用 >= 80%)
    };

    const COMPRESSION_MIN_DROP = 5000; // 连续快照含缓存输入下降 > 5000 tokens 判定为自动压缩
    const DEFAULT_LIMIT = 256000;      // Gemini 4 Argon / Flash 3.8 / Claude 5.5 官方自动压缩上限 256k
    const GPT_OSS_LIMIT = 80000;       // GPT-OSS 120B 官方自动压缩上限 80k

    // 已知共享 5 小时配额池映射 (对齐官方 LanguageServer 配额池划分)
    const KNOWN_QUOTA_POOLS = {
        MODEL_PLACEHOLDER_M417: 'gemini',
        MODEL_PLACEHOLDER_M418: 'gemini',
        MODEL_PLACEHOLDER_M419: 'gemini',
        MODEL_PLACEHOLDER_M318: 'gemini',
        MODEL_PLACEHOLDER_M319: 'gemini',
        MODEL_PLACEHOLDER_M320: 'gemini',
        MODEL_PLACEHOLDER_M322: 'gemini',
        MODEL_PLACEHOLDER_M298: 'gemini',
        MODEL_PLACEHOLDER_M299: 'gemini',
        MODEL_PLACEHOLDER_M300: 'gemini',
        MODEL_PLACEHOLDER_M71: 'gemini',
        MODEL_PLACEHOLDER_M72: 'gemini',
        MODEL_PLACEHOLDER_M73: 'gemini',
        MODEL_PLACEHOLDER_M84: 'gemini',
        MODEL_PLACEHOLDER_M20: 'gemini',
        MODEL_PLACEHOLDER_M187: 'gemini',
        MODEL_PLACEHOLDER_M16: 'gemini',
        MODEL_PLACEHOLDER_M36: 'gemini',
        MODEL_PLACEHOLDER_M37: 'gemini',
        MODEL_PLACEHOLDER_M18: 'gemini',
        MODEL_PLACEHOLDER_M47: 'gemini',
        MODEL_PLACEHOLDER_M400: 'premium',
        MODEL_PLACEHOLDER_M401: 'premium',
        MODEL_PLACEHOLDER_M402: 'premium',
        MODEL_PLACEHOLDER_M403: 'premium',
        MODEL_PLACEHOLDER_M404: 'premium',
        MODEL_PLACEHOLDER_M405: 'premium',
        MODEL_PLACEHOLDER_M35: 'premium',
        MODEL_PLACEHOLDER_M26: 'premium',
        MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'premium'
    };

    // 状态缓存
    const sessionCache = new Map();     // cascadeId -> { stepCount, lastModifiedTime, status, steps, usage }
    const sniffedStepsMap = new Map();  // cascadeId -> steps[] (通过 fetch/XHR 旁路嗅探捕获的本地或云端步骤)
    const domStreamTracker = new Map(); // panelKey -> { lastTokens, lastTime, lastSpeed, avgTokensSum, avgDurSum }
    let trajectoriesMap = new Map();    // cascadeId -> summary
    let sniffedCsrfToken = '';
    let panelAutoIdCounter = 0;
    let userStatusCache = {
        fetchedAt: 0,
        planName: '',
        tierName: '',
        modelConfigs: []
    };
    let isPolling = false;
    let isFetchingUserStatus = false;
    let activeTooltipTarget = null;
    let tooltipEl = null;
    let engineActivated = false;

    // 有界缓存写入辅助函数：已存在键先删除以刷新顺序，超出 maxSize 时淘汰最早插入键
    function setBoundedMap(map, key, value, maxSize = 30) {
        if (!map) return;
        if (map.has(key)) {
            map.delete(key);
        }
        map.set(key, value);
        while (map.size > maxSize) {
            const oldestKey = map.keys().next().value;
            if (oldestKey === undefined && !map.has(undefined)) break;
            map.delete(oldestKey);
        }
    }

    // 语言模式：优先读取用户手动切换过的 localStorage，未设置时按系统 navigator.language 自动匹配 ('zh' | 'en')
    function getLangMode() {
        try {
            const saved = localStorage.getItem('__agy_ctx_lang__');
            if (saved === 'en' || saved === 'zh') return saved;
        } catch (e) {}
        try {
            const sysLang = (
                (typeof navigator !== 'undefined' && navigator.language) ||
                (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ||
                'zh'
            ).toLowerCase();
            return sysLang.startsWith('zh') ? 'zh' : 'en';
        } catch (e) {
            return 'zh';
        }
    }

    function toggleLangMode() {
        try {
            const next = getLangMode() === 'zh' ? 'en' : 'zh';
            localStorage.setItem('__agy_ctx_lang__', next);
        } catch (e) {}
        renderAllFooters();
        if (activeTooltipTarget) {
            updateTooltipContent(activeTooltipTarget);
        }
    }

    // 格式化 Token 数字 (如 45231 -> "45.2k", 256000 -> "256k", 1000000 -> "1M")
    function formatTokenValue(value) {
        const safe = Math.max(0, Math.round(Number(value) || 0));
        if (safe >= 1000000) {
            return (safe / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (safe >= 1000) {
            return (safe / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return String(safe);
    }

    // 字符级 Token 估算：ASCII ~4 chars/token，非 ASCII (中文等) ~1.5 chars/token
    function estimateTokensFromText(text) {
        if (!text || typeof text !== 'string') return 0;
        let ascii = 0;
        let nonAscii = 0;
        const len = Math.min(text.length, 250000);
        for (let i = 0; i < len; i++) {
            if (text.charCodeAt(i) < 128) ascii++;
            else nonAscii++;
        }
        return Math.ceil(ascii / 4 + nonAscii / 1.5);
    }

    // 判断是否为后台影子模型或图片生成模型 (防篡改主对话模型与分母)
    function isShadowOrImageModel(modelId) {
        if (!modelId) return false;
        const s = String(modelId).toUpperCase();
        // M50 = Gemini Flash Lite 子智能体; M21 = Nano Banana 2 生图模型
        if (s.includes('_M50') || s === 'M50' || s.includes('FLASH_LITE')) return true;
        if (s.includes('_M21') || s === 'M21' || s.includes('IMAGE') || s.includes('BANANA')) return true;
        return false;
    }

    // 动态同步上下文解锁模式与上限 (支持与 Context Viewer 解锁工具联动)
    let _dynamicUnlockedLimit = null;
    function syncUnlockedLimitFromHost() {
        try {
            if (window.contextMeterAPI && typeof window.contextMeterAPI.getContextUnlockStatus === 'function') {
                window.contextMeterAPI.getContextUnlockStatus().then(res => {
                    if (res && res.ok && res.data) {
                        if (res.data.configuredMode === 'fixed' && res.data.configuredLimitTokens > 0) {
                            _dynamicUnlockedLimit = res.data.configuredLimitTokens;
                        } else if (res.data.configuredMode === 'dynamic') {
                            _dynamicUnlockedLimit = 1000000;
                        } else if (res.data.configuredMode === 'default') {
                            _dynamicUnlockedLimit = null;
                        }
                    }
                }).catch(() => {});
            }
        } catch (e) {}
    }
    syncUnlockedLimitFromHost();

    // 根据模型 ID 或显示名称动态获取官方压缩上限 (支持联动解锁上限)
    function getContextLimitForModel(modelId, label) {
        syncUnlockedLimitFromHost();
        if (_dynamicUnlockedLimit && _dynamicUnlockedLimit > 0) {
            return _dynamicUnlockedLimit;
        }
        const combined = ((modelId || '') + ' ' + (label || '')).toUpperCase();
        if (combined.includes('GPT_OSS') || combined.includes('GPT-OSS') || combined.includes('120B')) {
            return GPT_OSS_LIMIT;
        }
        return DEFAULT_LIMIT;
    }

    // 识别模型所属的 5 小时配额池 ('gemini' | 'premium' | '')
    function getQuotaPoolForModel(modelId, label) {
        if (modelId && KNOWN_QUOTA_POOLS[modelId]) {
            return KNOWN_QUOTA_POOLS[modelId];
        }
        const combined = ((modelId || '') + ' ' + (label || '')).toUpperCase();
        if (combined.includes('GEMINI') || combined.includes('ARGON') || combined.includes('FLASH')) {
            return 'gemini';
        }
        if (combined.includes('CLAUDE') || combined.includes('OPUS') || combined.includes('SONNET') || combined.includes('GPT') || combined.includes('OSS')) {
            return 'premium';
        }
        return '';
    }

    // 美化模型名称
    function resolveModelDisplayName(modelId, fallbackLabel) {
        if (fallbackLabel) return fallbackLabel;
        if (!modelId) return getLangMode() === 'en' ? 'Default Model' : '默认模型';
        for (const c of userStatusCache.modelConfigs) {
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || '';
            if (cid === modelId || c.modelId === modelId) {
                return c.label || modelId;
            }
        }
        const m = String(modelId);
        if (m.includes('M419')) return 'Gemini 4 Argon (Low)';
        if (m.includes('M418')) return 'Gemini 4 Argon (Medium)';
        if (m.includes('M417')) return 'Gemini 4 Argon (High)';
        if (m.includes('M320')) return 'Gemini 3.8 Flash (Low)';
        if (m.includes('M319')) return 'Gemini 3.8 Flash (Medium)';
        if (m.includes('M318')) return 'Gemini 3.8 Flash (High)';
        if (m.includes('M400')) return 'Claude Opus 5.5 (Low)';
        if (m.includes('M401')) return 'Claude Opus 5.5 (Medium)';
        if (m.includes('M402')) return 'Claude Opus 5.5 (High)';
        if (m.includes('M403')) return 'Claude Sonnet 5.5 (Low)';
        if (m.includes('M404')) return 'Claude Sonnet 5.5 (Medium)';
        if (m.includes('M405')) return 'Claude Sonnet 5.5 (High)';
        if (m.includes('M35')) return 'Claude Sonnet 4.6 (Thinking)';
        if (m.includes('M26')) return 'Claude Opus 4.6 (Thinking)';
        if (m.includes('GPT_OSS')) return 'GPT-OSS 120B (Medium)';
        return m.replace(/^MODEL_PLACEHOLDER_/, '').replace(/^MODEL_/, '');
    }

    // 归一化会话 ID 尾缀 (兼容本地 UUID 与云端 v1/default/jetski_remote_agents_3p/<uuid>)
    function normalizeCidKey(cid) {
        if (!cid || typeof cid !== 'string') return '';
        const trimmed = cid.trim();
        const parts = trimmed.split('/');
        return parts[parts.length - 1] || trimmed;
    }

    // 判断请求目标是否为同源 URL (支持 string / URL / Request 对象；相对路径或同 location.origin 返回 true)
    function isSameOriginUrl(input) {
        try {
            let rawUrl = '';
            if (typeof input === 'string') {
                rawUrl = input.trim();
            } else if (typeof URL !== 'undefined' && input instanceof URL) {
                rawUrl = input.href;
            } else if (input && typeof input === 'object') {
                if (typeof input.url === 'string') {
                    rawUrl = input.url.trim();
                } else if (typeof input.href === 'string') {
                    rawUrl = input.href.trim();
                }
            }
            if (!rawUrl) return false;
            if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl) && !rawUrl.startsWith('//')) {
                return true;
            }
            if (typeof location === 'undefined' || !location.origin || location.origin === 'null') {
                return false;
            }
            const resolved = new URL(rawUrl, location.href || location.origin);
            return resolved.origin === location.origin;
        } catch (e) {
            return false;
        }
    }

    // 安装无损网络旁路嗅探器：仅针对同源请求捕获本地与云端项目 (Remote Agent / Web 端) 的步骤、轨迹与配额响应
    function installNetworkSniffer() {
        if (window.__AGY_CTX_FETCH_SNIFFED__) return;
        window.__AGY_CTX_FETCH_SNIFFED__ = true;
        const origFetch = window.fetch;
        if (typeof origFetch !== 'function') return;

        window.fetch = async function (...args) {
            if (!isSameOriginUrl(args[0])) {
                return origFetch.apply(this, args);
            }

            let reqBodyCid = '';
            try {
                const init = args[1];
                if (init && init.headers) {
                    if (typeof init.headers.get === 'function') {
                        const t = init.headers.get('x-codeium-csrf-token');
                        if (t) sniffedCsrfToken = t;
                    } else if (typeof init.headers === 'object') {
                        const t = init.headers['x-codeium-csrf-token'] || init.headers['X-Codeium-Csrf-Token'];
                        if (t) sniffedCsrfToken = t;
                    }
                }
                if (init && typeof init.body === 'string' && init.body.length <= 65536 && init.body.startsWith('{')) {
                    const parsedReq = JSON.parse(init.body);
                    reqBodyCid = parsedReq.cascadeId || parsedReq.conversationId || parsedReq.id || '';
                }
            } catch (e) {}

            const resp = await origFetch.apply(this, args);
            try {
                const hasHeadersGet = Boolean(resp && resp.headers && typeof resp.headers.get === 'function');
                const ct = hasHeadersGet ? (resp.headers.get('content-type') || '') : '';
                const cl = hasHeadersGet ? resp.headers.get('content-length') : null;
                const clAllowed = cl === null || cl === undefined || cl === '' || Number(cl) <= 5 * 1024 * 1024;
                if (ct.toLowerCase().includes('application/json') && clAllowed) {
                    const clone = resp.clone();
                    clone.json().then((data) => {
                        if (!data || typeof data !== 'object') return;
                        // 1. 捕获 GetUserStatus 或模型配额列表
                        const us = data.userStatus || (data.cascadeModelConfigData ? data : null);
                        if (us && us.cascadeModelConfigData && Array.isArray(us.cascadeModelConfigData.clientModelConfigs)) {
                            userStatusCache.fetchedAt = Date.now();
                            userStatusCache.modelConfigs = us.cascadeModelConfigData.clientModelConfigs;
                        }
                        // 2. 捕获会话摘要字典
                        if (data.trajectorySummaries && typeof data.trajectorySummaries === 'object') {
                            for (const [k, v] of Object.entries(data.trajectorySummaries)) {
                                trajectoriesMap.set(k, v);
                            }
                        }
                        // 3. 捕获本地或云端项目的轨迹步骤 (steps / trajectory.steps / messages / turns)
                        const stepsArr = Array.isArray(data.steps) ? data.steps
                            : (data.trajectory && Array.isArray(data.trajectory.steps) ? data.trajectory.steps
                            : (Array.isArray(data.turns) ? data.turns
                            : (Array.isArray(data.messages) ? data.messages : null)));
                        if (stepsArr && stepsArr.length > 0) {
                            const cid = data.cascadeId || data.conversationId || (data.trajectory && (data.trajectory.cascadeId || data.trajectory.conversationId)) || reqBodyCid || '__latest_sniffed__';
                            setBoundedMap(sniffedStepsMap, cid, stepsArr);
                            const shortKey = normalizeCidKey(cid);
                            if (shortKey && shortKey !== cid) {
                                setBoundedMap(sniffedStepsMap, shortKey, stepsArr);
                            }
                        }
                    }).catch(() => {});
                }
            } catch (e) {}
            return resp;
        };
    }

    // 获取当前页面同源 CSRF Token (支持 __APP_CONFIG__ 与网络嗅探回退)
    function getCsrfToken() {
        try {
            if (window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken) {
                return window.__APP_CONFIG__.csrfToken;
            }
        } catch (e) {}
        return sniffedCsrfToken || '';
    }

    // 调用本地或同源 Connect-RPC 接口 (网页端无 csrfToken 时亦允许尝试携带同源 Cookie 请求)
    async function callLsRpc(method, body, timeoutMs = 6000) {
        const csrf = getCsrfToken();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1'
            };
            if (csrf) {
                headers['x-codeium-csrf-token'] = csrf;
            }
            const resp = await fetch('/exa.language_server_pb.LanguageServerService/' + method, {
                method: 'POST',
                headers,
                credentials: 'same-origin',
                body: JSON.stringify(body || {}),
                signal: ctrl.signal
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // 刷新 GetUserStatus 缓存
    async function refreshUserStatus(force = false) {
        const now = Date.now();
        if (!force && (isFetchingUserStatus || (now - userStatusCache.fetchedAt < 30000 && userStatusCache.modelConfigs.length > 0))) {
            return;
        }
        isFetchingUserStatus = true;
        try {
            const usResp = await callLsRpc('GetUserStatus', {
                metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
            });
            if (usResp && usResp.userStatus) {
                const us = usResp.userStatus;
                userStatusCache.fetchedAt = Date.now();
                userStatusCache.planName = (us.planStatus && us.planStatus.planInfo && us.planStatus.planInfo.planName) || '';
                userStatusCache.tierName = (us.userTier && us.userTier.name) || '';
                userStatusCache.modelConfigs = (us.cascadeModelConfigData && us.cascadeModelConfigData.clientModelConfigs) || [];
            }
        } catch (e) {
        } finally {
            isFetchingUserStatus = false;
        }
    }

    // 从步骤对象提取用于估算的文本内容 (兼容本地 LanguageServer 步骤与云端 Remote Agent / 网页端步骤结构)
    function extractStepEstimateText(step) {
        if (!step || typeof step !== 'object') return '';
        const parts = [];
        try {
            // 1. 本地标准结构 userInput / plannerResponse
            if (step.userInput) {
                const ui = step.userInput;
                if (typeof ui.userResponse === 'string') parts.push(ui.userResponse);
                if (typeof ui.text === 'string') parts.push(ui.text);
                if (Array.isArray(ui.items)) {
                    for (const it of ui.items) {
                        if (it && typeof it.text === 'string') parts.push(it.text);
                    }
                }
            }
            if (step.plannerResponse) {
                const pr = step.plannerResponse;
                if (typeof pr.response === 'string') parts.push(pr.response);
                if (typeof pr.thinking === 'string') parts.push(pr.thinking);
                if (typeof pr.text === 'string') parts.push(pr.text);
            }
            if (step.metadata && step.metadata.toolCall && typeof step.metadata.toolCall.argumentsJson === 'string') {
                parts.push(step.metadata.toolCall.argumentsJson);
            }
            // 2. 云端项目 (jetski_remote_agents_3p) 与网页端常见步骤字段
            if (typeof step.content === 'string') parts.push(step.content);
            else if (Array.isArray(step.content)) {
                for (const c of step.content) {
                    if (typeof c === 'string') parts.push(c);
                    else if (c && typeof c.text === 'string') parts.push(c.text);
                }
            }
            if (typeof step.text === 'string' && !parts.includes(step.text)) parts.push(step.text);
            if (typeof step.thinking === 'string' && !parts.includes(step.thinking)) parts.push(step.thinking);
            if (typeof step.response === 'string' && !parts.includes(step.response)) parts.push(step.response);
            if (typeof step.message === 'string') parts.push(step.message);
            const toolCalls = step.toolCalls || step.tool_calls;
            if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls) {
                    if (!tc) continue;
                    const args = tc.arguments || tc.args || tc.argumentsJson || (tc.function && tc.function.arguments);
                    if (typeof args === 'string') parts.push(args);
                    else if (args && typeof args === 'object') parts.push(JSON.stringify(args));
                }
            }
        } catch (e) {}
        return parts.join('\n');
    }

    // 核心计算函数：精确快照 + 字符级尾差估算 + 云端无 modelUsage 步骤自适应测速与容量拆解
    function analyzeSteps(steps, preferredModelId, preferredModelLabel, totalStepCount) {
        let baseTokens = 0;
        let inputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        let outputTokens = 0;
        let estimatedDelta = 0;
        let estInputSum = 0;
        let estOutputSum = 0;
        let prevCacheInclusiveInput = 0;
        let compressionDetected = false;
        let compressionBefore = 0;
        let compressionAfter = 0;
        let compressionDrop = 0;
        let activeModelId = preferredModelId || '';
        let shadowModelId = '';
        let hasPreciseSnapshot = false;
        let lastTokPerSec = 0;
        let lastDurationSec = 0;
        let timedOutTokensSum = 0;
        let timedDurationSum = 0;

        if (Array.isArray(steps)) {
            for (const st of steps) {
                if (!st || typeof st !== 'object') continue;
                const meta = st.metadata || st;
                const mu = meta.modelUsage || st.modelUsage || (st.checkpoint && st.checkpoint.modelUsage) || (st.usage) || null;
                const stepModel = (mu && (mu.model || mu.modelId)) || meta.generatorModel || st.model || '';

                // 尝试从用户输入配置中识别初始选中的模型
                if (!activeModelId && st.userInput && st.userInput.userConfig && st.userInput.userConfig.plannerConfig) {
                    const pc = st.userInput.userConfig.plannerConfig;
                    const userPicked = pc.planModel || pc.modelName || (pc.requestedModel && pc.requestedModel.model) || '';
                    if (userPicked && !isShadowOrImageModel(userPicked)) {
                        activeModelId = userPicked;
                    }
                }

                if (mu && (mu.inputTokens !== undefined || mu.outputTokens !== undefined || mu.cacheReadTokens !== undefined || mu.promptTokens !== undefined)) {
                    if (isShadowOrImageModel(stepModel)) {
                        shadowModelId = stepModel;
                        continue;
                    }
                    const inTok = Math.max(0, parseInt(mu.inputTokens || mu.promptTokens || '0', 10) || 0);
                    const cacheRead = Math.max(0, parseInt(mu.cacheReadTokens || mu.cachedTokens || '0', 10) || 0);
                    const cacheCreate = Math.max(0, parseInt(mu.cacheCreationTokens || '0', 10) || 0);
                    const outTok = Math.max(0, parseInt(mu.outputTokens || mu.completionTokens || '0', 10) || 0);
                    const cacheInclusiveInput = inTok + cacheRead + cacheCreate;
                    const snapshotTotal = cacheInclusiveInput + outTok;

                    // 计算本步端到端每秒输出 Token 速度 (tok/s)
                    const tStart = parseResetTimeMs(meta.createdAt || meta.created_at || meta.startedAt || st.createdAt || st.created_at);
                    const tEndRaw = meta.finishedGeneratingAt || meta.completedAt || meta.updatedAt || st.finishedGeneratingAt || st.completedAt || st.updatedAt || meta.viewableAt || '';
                    const tEnd = parseResetTimeMs(tEndRaw);
                    const durSec = (tStart > 0 && tEnd > tStart) ? (tEnd - tStart) / 1000 : 0;
                    if (outTok > 0 && durSec >= 0.15 && durSec < 600) {
                        lastTokPerSec = Math.round(outTok / durSec);
                        lastDurationSec = Number(durSec.toFixed(1));
                        timedOutTokensSum += outTok;
                        timedDurationSum += durSec;
                    }

                    if (snapshotTotal > 0) {
                        if (prevCacheInclusiveInput > 0 && (prevCacheInclusiveInput - cacheInclusiveInput) > COMPRESSION_MIN_DROP) {
                            compressionDetected = true;
                            compressionBefore = prevCacheInclusiveInput;
                            compressionAfter = cacheInclusiveInput;
                            compressionDrop = prevCacheInclusiveInput - cacheInclusiveInput;
                        }
                        prevCacheInclusiveInput = cacheInclusiveInput;
                        baseTokens = snapshotTotal;
                        inputTokens = inTok;
                        cacheReadTokens = cacheRead;
                        cacheCreationTokens = cacheCreate;
                        outputTokens = outTok;
                        estimatedDelta = 0;
                        hasPreciseSnapshot = true;
                        if (stepModel && !preferredModelId) {
                            activeModelId = stepModel;
                        }
                        continue;
                    }
                }

                // 快照之后的步骤 (或云端无 modelUsage 的步骤) 累加字符级估算并测速
                const estText = extractStepEstimateText(st);
                if (estText) {
                    const stepTok = estimateTokensFromText(estText);
                    estimatedDelta += stepTok;
                    const stepType = String(st.type || st.role || (st.plannerResponse ? 'PLANNER_RESPONSE' : (st.userInput ? 'USER_INPUT' : ''))).toUpperCase();
                    const isPlanner = stepType.includes('PLANNER') || stepType.includes('MODEL') || stepType.includes('ASSISTANT') || Boolean(st.plannerResponse);
                    if (isPlanner) {
                        estOutputSum += stepTok;
                        const tStart = parseResetTimeMs(meta.createdAt || meta.created_at || meta.startedAt || st.createdAt || st.created_at);
                        const tEnd = parseResetTimeMs(meta.finishedGeneratingAt || meta.completedAt || meta.updatedAt || st.finishedGeneratingAt || st.completedAt || st.updatedAt);
                        const durSec = (tStart > 0 && tEnd > tStart) ? (tEnd - tStart) / 1000 : 0;
                        if (stepTok > 5 && durSec >= 0.2 && durSec < 600) {
                            lastTokPerSec = Math.round(stepTok / durSec);
                            lastDurationSec = Number(durSec.toFixed(1));
                            timedOutTokensSum += stepTok;
                            timedDurationSum += durSec;
                        }
                    } else {
                        estInputSum += stepTok;
                    }
                }
            }
        }

        // 若为云端项目步骤 (有步骤但服务端未下发底层 modelUsage 快照)，基于系统基础开销 + 历史上下文构建容量拆解
        const actualStepCount = totalStepCount || (Array.isArray(steps) ? steps.length : 0);
        if (!hasPreciseSnapshot && (estimatedDelta > 0 || actualStepCount > 0)) {
            const sysPromptOverhead = actualStepCount > 0 ? 12500 : 0; // 云端环境系统提示词与工具声明基线
            const totalEst = sysPromptOverhead + estimatedDelta;
            baseTokens = totalEst;
            estimatedDelta = 0;
            cacheReadTokens = Math.round(sysPromptOverhead + estInputSum * 0.75);
            inputTokens = Math.max(0, totalEst - cacheReadTokens - estOutputSum);
            outputTokens = estOutputSum;
            hasPreciseSnapshot = totalEst > 0;
        }

        const finalLimit = getContextLimitForModel(activeModelId || preferredModelId, preferredModelLabel);
        const contextUsed = baseTokens + estimatedDelta;
        const usagePercent = finalLimit > 0 ? (contextUsed / finalLimit) * 100 : 0;
        const remainPercent = Math.max(0, 100 - usagePercent);
        const totalInputWithCache = inputTokens + cacheReadTokens + cacheCreationTokens;
        const cacheHitRate = totalInputWithCache > 0 ? (cacheReadTokens / totalInputWithCache) * 100 : 0;
        const avgTokPerSec = timedDurationSum > 0 ? Math.round(timedOutTokensSum / timedDurationSum) : lastTokPerSec;

        return {
            contextUsed,
            contextLimit: finalLimit,
            usagePercent,
            remainPercent,
            inputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            outputTokens,
            estimatedDelta,
            hasPreciseSnapshot,
            cacheHitRate,
            tokPerSec: lastTokPerSec,
            avgTokPerSec,
            lastDurationSec,
            compressionDetected,
            compressionBefore,
            compressionAfter,
            compressionDrop,
            modelId: activeModelId || preferredModelId || '',
            modelDisplayName: resolveModelDisplayName(activeModelId || preferredModelId, preferredModelLabel),
            shadowModelId,
            stepCount: actualStepCount
        };
    }

    // 判断数组是否为会话步骤/消息列表
    function isLikelyStepsArray(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return false;
        const sample = arr[arr.length - 1] || arr[0];
        if (!sample || typeof sample !== 'object') return false;
        return Boolean(
            sample.userInput ||
            sample.plannerResponse ||
            sample.metadata ||
            sample.modelUsage ||
            sample.stepIndex !== undefined ||
            sample.step_index !== undefined ||
            (typeof sample.type === 'string' && (sample.content !== undefined || sample.thinking !== undefined || sample.tool_calls !== undefined)) ||
            (typeof sample.role === 'string' && (sample.content !== undefined || sample.text !== undefined || sample.parts !== undefined))
        );
    }

    // 从单个对象 (memoizedProps 或 memoizedState.memoizedState) 抽取会话上下文、配额与步骤
    function inspectObjectForContext(obj, result, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 2) return;
        try {
            if (!result.conversationId) {
                const cid = obj.conversationId || obj.cascadeId || obj.trajectoryId ||
                    (obj.value && (obj.value.conversationId || obj.value.cascadeId)) ||
                    (obj.conversation && (obj.conversation.id || obj.conversation.conversationId || obj.conversation.cascadeId)) ||
                    (obj.trajectory && (obj.trajectory.cascadeId || obj.trajectory.conversationId || obj.trajectory.trajectoryId)) || '';
                if (typeof cid === 'string' && cid.length > 3) {
                    result.conversationId = cid;
                }
            }
            const mc = obj.currentModelConfig || obj.selectedModelConfig || obj.modelConfig ||
                (obj.value && (obj.value.currentModelConfig || obj.value.selectedModelConfig || obj.value.modelConfig)) || null;
            if (mc && typeof mc === 'object') {
                const mid = (mc.modelOrAlias && mc.modelOrAlias.model) || mc.modelId || mc.model || '';
                if (!result.modelId && mid) {
                    result.modelId = mid;
                    result.modelLabel = mc.label || mc.displayName || '';
                }
                if (mc.quotaInfo && (!result.quotaInfo || parseResetTimeMs(mc.quotaInfo.resetTime || mc.quotaInfo.reset_time) > 0)) {
                    result.quotaInfo = mc.quotaInfo;
                }
            }
            if (obj.quotaInfo && typeof obj.quotaInfo === 'object' && (!result.quotaInfo || parseResetTimeMs(obj.quotaInfo.resetTime || obj.quotaInfo.reset_time) > 0)) {
                result.quotaInfo = obj.quotaInfo;
            }
            if (!result.fiberModelConfigs) {
                const cfgList = obj.clientModelConfigs || obj.modelConfigs ||
                    (obj.cascadeModelConfigData && obj.cascadeModelConfigData.clientModelConfigs) ||
                    (obj.userStatus && obj.userStatus.cascadeModelConfigData && obj.userStatus.cascadeModelConfigData.clientModelConfigs) ||
                    (obj.value && (obj.value.clientModelConfigs || obj.value.modelConfigs));
                if (Array.isArray(cfgList) && cfgList.length > 0) {
                    result.fiberModelConfigs = cfgList;
                }
            }
            // 提取云端项目 / 网页端在 React 树中持有的当前会话步骤数组
            const candidateSteps = obj.steps || obj.trajectorySteps || obj.messages || obj.turns ||
                (obj.trajectory && obj.trajectory.steps) ||
                (obj.conversation && (obj.conversation.steps || obj.conversation.messages || obj.conversation.turns)) ||
                (obj.value && (obj.value.steps || (obj.value.trajectory && obj.value.trajectory.steps) || obj.value.messages));
            if (isLikelyStepsArray(candidateSteps)) {
                if (!result.fiberSteps || candidateSteps.length >= result.fiberSteps.length) {
                    result.fiberSteps = candidateSteps;
                }
            } else if (isLikelyStepsArray(obj)) {
                if (!result.fiberSteps || obj.length >= result.fiberSteps.length) {
                    result.fiberSteps = obj;
                }
            }
            if (typeof obj.isRunning === 'boolean' && obj.isRunning) {
                result.isRunning = true;
            }
            if (typeof obj.stepCount === 'number' && obj.stepCount > result.fiberStepCount) {
                result.fiberStepCount = obj.stepCount;
            }
        } catch (e) {}
    }

    // 查找当前底部栏所属的独立对话面板根容器 (用于多聊天窗隔离与 DOM 扫描)
    function findChatPanelContainer(footerEl) {
        let cur = footerEl ? footerEl.parentElement : null;
        let depth = 0;
        let best = footerEl ? footerEl.parentElement : null;
        while (cur && cur !== document.body && depth < 18) {
            depth++;
            const footersInside = cur.querySelectorAll ? cur.querySelectorAll('.agy-composer-footer').length : 0;
            if (footersInside > 1) {
                break;
            }
            best = cur;
            cur = cur.parentElement;
        }
        return best || document.body;
    }

    // 从 DOM 节点的 React Fiber 树 (含 memoizedProps 与 Hooks memoizedState) 提取会话上下文与云端步骤
    function extractComposerContext(footerEl) {
        const result = {
            conversationId: '',
            modelId: '',
            modelLabel: '',
            quotaInfo: null,
            fiberModelConfigs: null,
            fiberSteps: null,
            fiberStepCount: 0,
            isRunning: false
        };
        if (!footerEl) return result;

        const findFiber = (dom) => {
            if (!dom) return null;
            const keys = Object.keys(dom);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
                    return dom[k];
                }
            }
            return null;
        };

        const panelEl = findChatPanelContainer(footerEl);
        const permBtn = footerEl.querySelector('button[data-testid="permissions-selector-trigger"]');
        const allBtns = Array.from(footerEl.querySelectorAll('button'));
        const panelChildren = panelEl ? Array.from(panelEl.querySelectorAll('[data-scroll-container], [role="log"], [role="list"], .overflow-y-auto')).slice(0, 6) : [];
        const startNodes = [permBtn, ...allBtns, footerEl, footerEl.parentElement, panelEl, ...panelChildren].filter(Boolean);
        const visitedFibers = new Set();

        for (const node of startNodes) {
            let cur = findFiber(node);
            let depth = 0;
            while (cur && depth < 75) {
                depth++;
                if (visitedFibers.has(cur)) {
                    cur = cur.return;
                    continue;
                }
                visitedFibers.add(cur);
                if (cur.memoizedProps && typeof cur.memoizedProps === 'object') {
                    inspectObjectForContext(cur.memoizedProps, result, 0);
                }
                // 遍历 React Hooks 链表 (useState / useMemo / useReducer 等)
                let hookState = cur.memoizedState;
                let hookDepth = 0;
                while (hookState && typeof hookState === 'object' && hookDepth < 25) {
                    hookDepth++;
                    if (hookState.memoizedState && typeof hookState.memoizedState === 'object') {
                        inspectObjectForContext(hookState.memoizedState, result, 0);
                    }
                    hookState = hookState.next;
                }
                cur = cur.return;
            }
        }

        // 若界面模型按钮上有可读模型名，作为 fallback label
        if (!result.modelLabel) {
            for (const b of allBtns) {
                if (b.getAttribute('data-agy-context-capsule') === '1') continue;
                if (b.getAttribute('data-testid') === 'permissions-selector-trigger') continue;
                const txt = (b.textContent || '').trim();
                if (txt && (txt.includes('Gemini') || txt.includes('Claude') || txt.includes('GPT') || txt.includes('Argon') || txt.includes('Flash') || txt.includes('Opus') || txt.includes('Sonnet'))) {
                    result.modelLabel = txt;
                    break;
                }
            }
        }

        // 若 URL 路径或查询参数中含有云端会话 ID，自动提取
        if (!result.conversationId) {
            try {
                const href = String(window.location.href || '');
                const m = href.match(/(?:jetski_remote_agents_3p\/|conversations?\/|cascadeId=)([a-zA-Z0-9_-]{8,})/i);
                if (m && m[1]) {
                    result.conversationId = m[1];
                }
            } catch (e) {}
        }

        // 为每个对话框面板分配持久兜底 ID，确保云端项目或网页端即使无显式 cascadeId 也能稳定统计
        if (!result.conversationId) {
            if (!footerEl.__agyFallbackCid) {
                panelAutoIdCounter++;
                footerEl.__agyFallbackCid = '__agy_panel_' + panelAutoIdCounter + '__';
            }
            result.conversationId = footerEl.__agyFallbackCid;
        }

        return result;
    }

    // 轻量栈遍历提取对话面板文本：跳过 .agy-composer-footer、script 与 style 节点，限制在 260000 字符以内即停
    function extractPanelTextExcludingFooter(panelEl) {
        if (!panelEl) return '';
        const MAX_CHARS = 260000;
        const chunks = [];
        let totalLen = 0;
        const stack = [panelEl];

        const isExcludedElement = (el) => {
            const tag = String(el.tagName || el.nodeName || '').toUpperCase();
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true;
            if (el.id === '__agy_ctx_capsule_tooltip__') return true;
            if (el.classList && typeof el.classList.contains === 'function' && el.classList.contains('agy-composer-footer')) {
                return true;
            }
            if (typeof el.className === 'string' && el.className && (' ' + el.className + ' ').includes(' agy-composer-footer ')) {
                return true;
            }
            return false;
        };

        while (stack.length > 0 && totalLen < MAX_CHARS) {
            const node = stack.pop();
            if (!node) continue;
            const nType = node.nodeType;
            if (nType === 3) {
                const txt = node.nodeValue !== undefined && node.nodeValue !== null ? String(node.nodeValue) : (node.textContent || '');
                if (txt) {
                    const remain = MAX_CHARS - totalLen;
                    if (txt.length >= remain) {
                        chunks.push(txt.slice(0, remain));
                        totalLen += remain;
                        break;
                    }
                    chunks.push(txt);
                    totalLen += txt.length;
                }
                continue;
            }
            if (nType === 1 || (!nType && (node.tagName || node.childNodes))) {
                if (isExcludedElement(node)) {
                    continue;
                }
                const children = node.childNodes;
                if (children && children.length > 0) {
                    for (let i = children.length - 1; i >= 0; i--) {
                        stack.push(children[i]);
                    }
                } else if (typeof node.textContent === 'string' && node.textContent.length > 0) {
                    const txt = node.textContent;
                    const remain = MAX_CHARS - totalLen;
                    if (txt.length >= remain) {
                        chunks.push(txt.slice(0, remain));
                        totalLen += remain;
                        break;
                    }
                    chunks.push(txt);
                    totalLen += txt.length;
                }
            }
        }
        return chunks.join('').trim();
    }

    // 云端项目 / 网页端 DOM 实时感知兜底：当 RPC 与 Fiber 均未暴露原始 steps 数组时，直接扫描当前对话面板内的已渲染消息并实时测速
    function computeDomFallbackUsage(footerEl, cid, preferredModelId, preferredModelLabel) {
        const panelEl = findChatPanelContainer(footerEl);
        if (!panelEl) return null;

        const rawText = extractPanelTextExcludingFooter(panelEl);
        const textTokens = estimateTokensFromText(rawText);
        if (textTokens <= 15) return null;

        // 统计对话回合/步骤块数量
        const msgBlocks = panelEl.querySelectorAll
            ? panelEl.querySelectorAll('[data-message-id], [data-step-index], [data-testid*="message"], [data-testid*="turn"], .prose, .markdown-body, pre')
            : [];
        const estSteps = Math.max(1, msgBlocks.length > 0 ? msgBlocks.length : Math.ceil(textTokens / 350));

        // 实时流式输出测速 (tok/s)
        const now = Date.now();
        let tracker = domStreamTracker.get(cid);
        if (!tracker) {
            tracker = { lastTokens: textTokens, lastTime: now, lastSpeed: 0, avgTokensSum: 0, avgDurSum: 0, compressionDetected: false, compressionBefore: 0, compressionAfter: 0, compressionDrop: 0 };
            setBoundedMap(domStreamTracker, cid, tracker);
        } else {
            const dtSec = (now - tracker.lastTime) / 1000;
            const dTok = textTokens - tracker.lastTokens;
            if (dTok > 4 && dtSec >= 0.25 && dtSec <= 12) {
                const spd = Math.round(dTok / dtSec);
                if (spd > 0 && spd < 500) {
                    tracker.lastSpeed = spd;
                    tracker.avgTokensSum += dTok;
                    tracker.avgDurSum += dtSec;
                }
            }
            if (tracker.lastTokens > 0 && (tracker.lastTokens - textTokens) > COMPRESSION_MIN_DROP) {
                tracker.compressionDetected = true;
                tracker.compressionBefore = tracker.lastTokens;
                tracker.compressionAfter = textTokens;
                tracker.compressionDrop = tracker.lastTokens - textTokens;
            }
            if (dtSec >= 0.8) {
                tracker.lastTokens = textTokens;
                tracker.lastTime = now;
            }
        }

        const sysOverhead = 12500; // 云端 Agent 系统指令与工具声明基线
        const contextUsed = sysOverhead + textTokens;
        const finalLimit = getContextLimitForModel(preferredModelId, preferredModelLabel);
        const usagePercent = finalLimit > 0 ? (contextUsed / finalLimit) * 100 : 0;
        const remainPercent = Math.max(0, 100 - usagePercent);
        const cacheReadTokens = Math.round(sysOverhead + textTokens * 0.68);
        const outputTokens = Math.round(textTokens * 0.22);
        const inputTokens = Math.max(0, contextUsed - cacheReadTokens - outputTokens);
        const totalInputWithCache = inputTokens + cacheReadTokens;
        const cacheHitRate = totalInputWithCache > 0 ? (cacheReadTokens / totalInputWithCache) * 100 : 0;
        const avgTokPerSec = tracker.avgDurSum > 0 ? Math.round(tracker.avgTokensSum / tracker.avgDurSum) : tracker.lastSpeed;

        return {
            contextUsed,
            contextLimit: finalLimit,
            usagePercent,
            remainPercent,
            inputTokens,
            cacheReadTokens,
            cacheCreationTokens: 0,
            outputTokens,
            estimatedDelta: 0,
            hasPreciseSnapshot: true,
            cacheHitRate,
            tokPerSec: tracker.lastSpeed,
            avgTokPerSec,
            lastDurationSec: 0,
            compressionDetected: tracker.compressionDetected,
            compressionBefore: tracker.compressionBefore,
            compressionAfter: tracker.compressionAfter,
            compressionDrop: tracker.compressionDrop,
            modelId: preferredModelId || '',
            modelDisplayName: resolveModelDisplayName(preferredModelId, preferredModelLabel),
            shadowModelId: '',
            stepCount: estSteps
        };
    }

    // 兼容解析各种格式的 resetTime (ISO字符串 / Protobuf Timestamp {seconds, nanos} / Date / 数字时间戳)
    // 过滤 1970-01-01 哨兵值 (<= 2000-01-01 视为未开启倒计时)
    function parseResetTimeMs(val) {
        if (!val) return 0;
        if (typeof val === 'number') {
            const ms = val < 1e11 ? val * 1000 : val;
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'bigint') {
            const num = Number(val);
            const ms = num < 1e11 ? num * 1000 : num;
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed || trimmed.startsWith('1970-01-01') || trimmed.startsWith('0001-01-01')) return 0;
            if (/^\d+$/.test(trimmed)) {
                const num = Number(trimmed);
                const ms = num < 1e11 ? num * 1000 : num;
                return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
            }
            const normalized = trimmed.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:?\d{2})$/, '$1$2');
            const ms = Date.parse(normalized);
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'object') {
            if (val instanceof Date) {
                const ms = val.getTime();
                return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
            }
            if (typeof val.toDate === 'function') {
                try {
                    const d = val.toDate();
                    if (d instanceof Date && Number.isFinite(d.getTime()) && d.getTime() > 946684800000) {
                        return d.getTime();
                    }
                } catch (e) {}
            }
            if (typeof val.toJsonString === 'function') {
                try {
                    return parseResetTimeMs(val.toJsonString());
                } catch (e) {}
            }
            if (typeof val.toJSON === 'function') {
                try {
                    const j = val.toJSON();
                    if (typeof j === 'string') return parseResetTimeMs(j);
                } catch (e) {}
            }
            const secRaw = val.seconds !== undefined ? val.seconds
                : (val.unixSeconds !== undefined ? val.unixSeconds
                : (val.secs !== undefined ? val.secs : undefined));
            if (secRaw !== undefined && secRaw !== null) {
                const sec = Number(secRaw);
                const nanos = Number(val.nanos || 0);
                if (Number.isFinite(sec) && sec > 946684800) {
                    return Math.round(sec * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0));
                }
            }
        }
        return 0;
    }

    // 规范化配额对象 (处理 Proto3 省略 0.0 默认值及多种字段命名)
    function normalizeQuotaInfo(qi) {
        if (!qi || typeof qi !== 'object') return null;
        const rawReset = qi.resetTime !== undefined ? qi.resetTime
            : (qi.reset_time !== undefined ? qi.reset_time
            : (qi.resetsAt !== undefined ? qi.resetsAt
            : (qi.resets_at !== undefined ? qi.resets_at
            : (qi.refreshTime !== undefined ? qi.refreshTime : qi.refresh_time))));
        const resetTimeMs = parseResetTimeMs(rawReset);
        const rawFrac = qi.remainingFraction !== undefined ? qi.remainingFraction : qi.remaining_fraction;
        let remainingFraction;
        if (typeof rawFrac === 'number' && Number.isFinite(rawFrac)) {
            remainingFraction = Math.max(0, Math.min(1, rawFrac));
        } else if (typeof rawFrac === 'string' && rawFrac.trim() !== '' && Number.isFinite(Number(rawFrac))) {
            remainingFraction = Math.max(0, Math.min(1, Number(rawFrac)));
        } else {
            remainingFraction = (resetTimeMs > Date.now()) ? 0 : 1;
        }
        return {
            remainingFraction,
            resetTimeMs,
            resetTime: resetTimeMs > 0 ? new Date(resetTimeMs).toISOString() : ''
        };
    }

    // 格式化重置倒计时文案 (完整返回 "2h 40m 后重置" 或 "Resets in 2h 40m"，彻底避免重复拼接 "后重置")
    function formatResetText(resetTimeMs, lang) {
        const ms = typeof resetTimeMs === 'number' ? resetTimeMs : parseResetTimeMs(resetTimeMs);
        if (!ms || ms <= 0) return '';
        const diffMs = ms - Date.now();
        if (!Number.isFinite(diffMs) || diffMs <= 0) {
            if (diffMs > -120000) {
                return lang === 'en' ? 'Resets soon' : '即将重置';
            }
            return '';
        }
        const totalMins = Math.floor(diffMs / 60000);
        if (totalMins <= 0) {
            return lang === 'en' ? 'Resets in <1m' : '<1m 后重置';
        }
        const days = Math.floor(totalMins / (24 * 60));
        const hours = Math.floor((totalMins % (24 * 60)) / 60);
        const mins = totalMins % 60;
        let dur = '';
        if (days > 0) {
            dur = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
        } else if (hours > 0) {
            dur = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        } else {
            dur = `${mins}m`;
        }
        return lang === 'en' ? `Resets in ${dur}` : `${dur} 后重置`;
    }

    // 查找当前模型的 5 小时配额与重置时间 (合并 Fiber 与 GetUserStatus，并支持同配额池回退)
    function findQuotaForModel(modelId, modelLabel, fiberQuotaInfo, fiberModelConfigs) {
        const now = Date.now();
        const normFiber = normalizeQuotaInfo(fiberQuotaInfo);
        const allConfigs = (userStatusCache.modelConfigs && userStatusCache.modelConfigs.length > 0)
            ? userStatusCache.modelConfigs
            : (Array.isArray(fiberModelConfigs) ? fiberModelConfigs : []);

        let matchedNorm = null;
        for (const c of allConfigs) {
            if (!c || !c.quotaInfo) continue;
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            if ((modelId && cid === modelId) || (modelLabel && c.label === modelLabel)) {
                matchedNorm = normalizeQuotaInfo(c.quotaInfo);
                if (matchedNorm) break;
            }
        }

        let primary = matchedNorm || normFiber;
        if (matchedNorm && normFiber) {
            const bestResetMs = (matchedNorm.resetTimeMs > now) ? matchedNorm.resetTimeMs
                : ((normFiber.resetTimeMs > now) ? normFiber.resetTimeMs : (matchedNorm.resetTimeMs || normFiber.resetTimeMs));
            primary = {
                remainingFraction: matchedNorm.remainingFraction,
                resetTimeMs: bestResetMs,
                resetTime: bestResetMs > 0 ? new Date(bestResetMs).toISOString() : ''
            };
        }

        if (primary && primary.resetTimeMs > now) {
            return primary;
        }

        const targetPool = getQuotaPoolForModel(modelId, modelLabel);
        let poolBestResetMs = 0;
        let poolMinFraction = primary ? primary.remainingFraction : 1;
        let foundInPool = false;

        for (const c of allConfigs) {
            if (!c || !c.quotaInfo) continue;
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            const cPool = getQuotaPoolForModel(cid, c.label);
            if (targetPool && cPool !== targetPool) continue;
            const nq = normalizeQuotaInfo(c.quotaInfo);
            if (!nq) continue;
            foundInPool = true;
            if (nq.remainingFraction < poolMinFraction) {
                poolMinFraction = nq.remainingFraction;
            }
            if (nq.resetTimeMs > now && (poolBestResetMs === 0 || nq.resetTimeMs < poolBestResetMs)) {
                poolBestResetMs = nq.resetTimeMs;
            }
        }

        if (primary) {
            const finalResetMs = poolBestResetMs > 0 ? poolBestResetMs : primary.resetTimeMs;
            return {
                remainingFraction: primary.remainingFraction < 1 ? primary.remainingFraction : poolMinFraction,
                resetTimeMs: finalResetMs,
                resetTime: finalResetMs > 0 ? new Date(finalResetMs).toISOString() : ''
            };
        }

        if (foundInPool) {
            return {
                remainingFraction: poolMinFraction,
                resetTimeMs: poolBestResetMs,
                resetTime: poolBestResetMs > 0 ? new Date(poolBestResetMs).toISOString() : ''
            };
        }

        return null;
    }

    // 获取 3A 冷雾莫兰迪颜色 (基于剩余健康度)
    function getMorandi3AColor(usagePercent) {
        if (usagePercent >= 80) return MORANDI_3A.red;    // 剩余 <= 20%
        if (usagePercent >= 50) return MORANDI_3A.yellow; // 剩余 20%~50%
        return MORANDI_3A.green;                          // 剩余 > 50%
    }

    // 拉取或合并指定会话的最新步骤并计算用量 (兼容本地项目 RPC、云端项目 Fiber/Fetch 嗅探、以及 DOM 实时兜底)
    async function refreshConversationUsage(cascadeId, summary, preferredModelId, preferredModelLabel, ctx, footerEl) {
        if (!cascadeId) return null;
        const shortCid = normalizeCidKey(cascadeId);
        const effectiveSummary = summary || trajectoriesMap.get(cascadeId) || (shortCid ? trajectoriesMap.get(shortCid) : null) || null;
        const stepCount = Number((effectiveSummary && effectiveSummary.stepCount) || (ctx && ctx.fiberStepCount) || 0);
        const status = (effectiveSummary && effectiveSummary.status) || (ctx && ctx.isRunning ? 'RUNNING' : '');
        const lastMod = (effectiveSummary && effectiveSummary.lastModifiedTime) || '';
        const isRunning = status.includes('RUNNING');

        const cached = sessionCache.get(cascadeId);
        if (cached && effectiveSummary && !isRunning && cached.stepCount === stepCount && cached.lastModifiedTime === lastMod && cached.steps && cached.steps.length > 0) {
            cached.usage = analyzeSteps(cached.steps, preferredModelId, preferredModelLabel, stepCount);
            cached.usage.title = (effectiveSummary.annotations && effectiveSummary.annotations.title) || effectiveSummary.summary || '';
            return cached.usage;
        }

        const isUndo = cached && stepCount > 0 && stepCount < cached.stepCount;
        let steps = (cached && !isUndo && Array.isArray(cached.steps)) ? cached.steps.slice() : [];
        let fetchOffset = 0;
        if (steps.length === 0) {
            fetchOffset = stepCount > 80 ? (stepCount - 80) : 0;
        } else {
            fetchOffset = Math.max(0, (cached.baseOffset || 0) + steps.length - 5);
        }
        const baseOffset = steps.length === 0 ? fetchOffset : (cached.baseOffset || 0);

        // 通道 1：尝试调用同源 GetCascadeTrajectorySteps (依次尝试原 ID 与短 UUID，适配本地客户端及支持同源 RPC 的环境)
        let resp = await callLsRpc('GetCascadeTrajectorySteps', {
            cascadeId,
            stepOffset: fetchOffset
        });
        if ((!resp || !Array.isArray(resp.steps) || resp.steps.length === 0) && shortCid && shortCid !== cascadeId) {
            resp = await callLsRpc('GetCascadeTrajectorySteps', {
                cascadeId: shortCid,
                stepOffset: fetchOffset
            });
        }

        if (resp && Array.isArray(resp.steps) && resp.steps.length > 0) {
            if (steps.length === 0) {
                steps = resp.steps;
            } else {
                const keepCount = Math.max(0, fetchOffset - baseOffset);
                steps = steps.slice(0, keepCount).concat(resp.steps);
            }
        } else {
            // 通道 2：云端项目 (Remote Agent) 或网页端 —— 从 React Fiber 树或网络嗅探缓存中提取步骤
            const fiberSteps = (ctx && Array.isArray(ctx.fiberSteps) && ctx.fiberSteps.length > 0) ? ctx.fiberSteps : null;
            const sniffed = sniffedStepsMap.get(cascadeId) || (shortCid ? sniffedStepsMap.get(shortCid) : null) || sniffedStepsMap.get('__latest_sniffed__') || null;
            if (fiberSteps && (!sniffed || fiberSteps.length >= sniffed.length)) {
                steps = fiberSteps;
            } else if (sniffed && sniffed.length > 0) {
                steps = sniffed;
            }
        }

        let usage = null;
        if (Array.isArray(steps) && steps.length > 0) {
            usage = analyzeSteps(steps, preferredModelId, preferredModelLabel, Math.max(stepCount, steps.length));
        }

        // 通道 3：若云端项目或网页端未在 RPC/Fiber 暴露原始 steps (或算出来 contextUsed 为 0)，启用 DOM 对话面板实时感知与流式测速兜底
        if ((!usage || usage.contextUsed === 0) && footerEl) {
            const domUsage = computeDomFallbackUsage(footerEl, cascadeId, preferredModelId, preferredModelLabel);
            if (domUsage && domUsage.contextUsed > 0) {
                usage = domUsage;
            }
        }

        if (!usage) {
            usage = analyzeSteps([], preferredModelId, preferredModelLabel, stepCount);
        }

        if (effectiveSummary) {
            usage.title = (effectiveSummary.annotations && effectiveSummary.annotations.title) || effectiveSummary.summary || '';
        }

        if (!isUndo && cached && cached.usage && !usage.compressionDetected) {
            const prevUsed = cached.usage.contextUsed || 0;
            if (prevUsed > 0 && (prevUsed - usage.contextUsed) > COMPRESSION_MIN_DROP && cached.usage.modelId === usage.modelId) {
                usage.compressionDetected = true;
                usage.compressionBefore = prevUsed;
                usage.compressionAfter = usage.contextUsed;
                usage.compressionDrop = prevUsed - usage.contextUsed;
            } else if (cached.usage.compressionDetected) {
                usage.compressionDetected = true;
                usage.compressionBefore = cached.usage.compressionBefore;
                usage.compressionAfter = cached.usage.compressionAfter;
                usage.compressionDrop = cached.usage.compressionDrop;
            }
        }

        setBoundedMap(sessionCache, cascadeId, {
            stepCount: Math.max(stepCount, usage.stepCount || 0),
            lastModifiedTime: lastMod,
            status,
            baseOffset,
            steps,
            usage
        });
        return usage;
    }

    // 创建或获取全局唯一的悬浮面板 (对齐官方 Turbo 下拉弹窗的 rounded-md / shadow-md / 字体粗细与色彩体系)
    function ensureTooltipEl() {
        if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.id = '__agy_ctx_capsule_tooltip__';
        tooltipEl.className = 'notranslate bg-popover text-popover-foreground border border-border rounded-md shadow-md';
        tooltipEl.setAttribute('translate', 'no');
        tooltipEl.style.cssText = [
            'position: fixed',
            'z-index: 999999',
            'pointer-events: none',
            'opacity: 0',
            'transition: opacity 0.12s ease',
            'padding: 8px 12px',
            'border-radius: 6px',
            'font-family: inherit',
            'font-size: 12px',
            'font-weight: 400',
            'line-height: 1.5',
            'font-variant-numeric: tabular-nums',
            'min-width: 240px',
            'max-width: 310px'
        ].join(';');
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    // 精准检测白天/黑夜模式 (支持 html/body class、data-theme、color-scheme 及面板真实背景色采样)
    function isLightMode(refEl) {
        const html = document.documentElement;
        const body = document.body;
        if (html.classList.contains('light') || (body && body.classList.contains('light'))) return true;
        if (html.classList.contains('dark') || (body && body.classList.contains('dark'))) return false;
        const themeAttr = (html.getAttribute('data-theme') || (body && body.getAttribute('data-theme')) || '').toLowerCase();
        if (themeAttr.includes('light')) return true;
        if (themeAttr.includes('dark')) return false;

        let cur = refEl || body || html;
        let depth = 0;
        while (cur && depth < 10) {
            depth++;
            try {
                const bg = getComputedStyle(cur).backgroundColor;
                const m = bg && bg.match(/\d+(\.\d+)?/g);
                if (m && m.length >= 3) {
                    const alpha = m.length >= 4 ? Number(m[3]) : 1;
                    if (alpha > 0.15) {
                        const lum = (0.299 * Number(m[0]) + 0.587 * Number(m[1]) + 0.114 * Number(m[2])) / 255;
                        return lum > 0.55;
                    }
                }
            } catch (e) {}
            cur = cur.parentElement;
        }
        try {
            const cs = getComputedStyle(html).colorScheme || '';
            if (cs.includes('light')) return true;
        } catch (e) {}
        return false;
    }

    function updateTooltipContent(capsuleBtn) {
        const el = ensureTooltipEl();
        const data = capsuleBtn.__ctxUsageData;
        if (!data) return;

        const lang = getLangMode();
        const isEn = lang === 'en';
        const light = isLightMode(capsuleBtn);

        // 对齐官方 Turbo 下拉菜单 (Radix Popover + Tailwind shadow-md) 的白天/黑夜双模式参数
        const bgColor = light ? '#FFFFFF' : '#18181B';
        const fgColor = light ? '#18181B' : '#E4E4E7';
        const mutedColor = light ? '#71717A' : '#A1A1AA';
        const borderColor = light ? '#E4E4E7' : '#27272A';
        const trackColor = light ? '#F4F4F5' : '#27272A';

        el.style.backgroundColor = bgColor;
        el.style.color = fgColor;
        el.style.border = `1px solid ${borderColor}`;
        // 官方 Tailwind shadow-md 标准参数 (日间 0.1/0.1 轻柔阴影，夜间匹配官方暗色浮层边框阴影)
        el.style.boxShadow = light
            ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
            : '0 4px 6px -1px rgba(0, 0, 0, 0.28), 0 2px 4px -2px rgba(0, 0, 0, 0.18)';

        const barColor = getMorandi3AColor(data.usagePercent);
        const remainingTokens = Math.max(0, data.contextLimit - data.contextUsed);
        const modelTitle = resolveModelDisplayName(data.modelId, data.modelDisplayName);

        const nodes = [];
        const createDivider = () => {
            const div = document.createElement('div');
            div.style.cssText = `border-top:1px solid ${borderColor};margin:6px 0;`;
            return div;
        };
        const createStandardRow = (labelText, valueText) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:1px 0;';
            const left = document.createElement('span');
            left.style.cssText = `color:${mutedColor};font-weight:400;`;
            left.textContent = labelText;
            const right = document.createElement('span');
            right.style.cssText = `color:${fgColor};font-weight:400;`;
            right.textContent = valueText;
            row.appendChild(left);
            row.appendChild(right);
            return row;
        };

        // 1. 顶部标题：模型名称 (font-weight: 500) + 已用百分比 (无任何表情符号或圆点)
        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;';
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = `font-weight:500;color:${fgColor};`;
        titleSpan.textContent = String(modelTitle || '');
        const pctSpan = document.createElement('span');
        pctSpan.style.cssText = `font-weight:400;color:${mutedColor};`;
        pctSpan.textContent = `${data.usagePercent.toFixed(1)}% ${isEn ? 'used' : '已用'}`;
        headerRow.appendChild(titleSpan);
        headerRow.appendChild(pctSpan);
        nodes.push(headerRow);

        // 2. 极细进度条
        const fillPct = Math.min(100, Math.max(2, data.usagePercent)).toFixed(1);
        const barTrack = document.createElement('div');
        barTrack.style.cssText = `width:100%;height:4px;border-radius:99px;background:${trackColor};overflow:hidden;margin-bottom:8px;`;
        const barFill = document.createElement('div');
        barFill.style.cssText = `width:${fillPct}%;height:100%;border-radius:99px;background:${barColor};`;
        barTrack.appendChild(barFill);
        nodes.push(barTrack);

        // 3. 当前上下文占用 & 剩余可用容量 (不用“电量”，统一用“容量”)
        nodes.push(createStandardRow(
            isEn ? 'Context Used' : '当前上下文占用',
            `${data.contextUsed.toLocaleString()} / ${data.contextLimit.toLocaleString()}`
        ));
        nodes.push(createStandardRow(
            isEn ? 'Remaining Capacity' : '剩余可用容量',
            `${remainingTokens.toLocaleString()} (${data.remainPercent.toFixed(1)}%)`
        ));

        // 4. 输出生成速度 & Prompt 缓存命中率 & Token 拆解 (去掉所有表情图标)
        if (data.hasPreciseSnapshot) {
            nodes.push(createDivider());
            if (data.tokPerSec > 0) {
                const avgLabel = isEn ? 'avg' : '均值';
                nodes.push(createStandardRow(
                    isEn ? 'Generation Speed' : '输出生成速度',
                    `${data.tokPerSec} tok/s (${avgLabel} ${data.avgTokPerSec || data.tokPerSec} tok/s)`
                ));
            }
            nodes.push(createStandardRow(
                isEn ? 'Prompt Cache Hit' : 'Prompt 缓存命中率',
                `${data.cacheHitRate.toFixed(1)}%`
            ));
            const breakdownRow = document.createElement('div');
            breakdownRow.style.cssText = `display:flex;justify-content:space-between;gap:12px;padding:1px 0;font-size:11px;color:${mutedColor};font-weight:400;`;
            const bdLeft = document.createElement('span');
            bdLeft.textContent = `${isEn ? 'Cache' : '缓存'}: ${formatTokenValue(data.cacheReadTokens)} · ${isEn ? 'Input' : '新入'}: ${formatTokenValue(data.inputTokens)}`;
            const bdRight = document.createElement('span');
            bdRight.textContent = `${isEn ? 'Output' : '输出'}: ${formatTokenValue(data.outputTokens)}`;
            breakdownRow.appendChild(bdLeft);
            breakdownRow.appendChild(bdRight);
            nodes.push(breakdownRow);
        }

        // 5. 快照后实时估算增量
        if (data.estimatedDelta > 0) {
            const deltaRow = document.createElement('div');
            deltaRow.style.cssText = `display:flex;justify-content:space-between;gap:12px;padding:1px 0;font-size:11px;color:${mutedColor};font-weight:400;`;
            const deltaLeft = document.createElement('span');
            deltaLeft.textContent = isEn ? 'Estimated Delta' : '实时估算增量';
            const deltaRight = document.createElement('span');
            deltaRight.style.cssText = `color:${fgColor};`;
            deltaRight.textContent = `+${data.estimatedDelta.toLocaleString()}`;
            deltaRow.appendChild(deltaLeft);
            deltaRow.appendChild(deltaRight);
            nodes.push(deltaRow);
        }

        // 6. 自动压缩详情或 >=85% 临近自动压缩阈值提示 (无表情符号，遵循官方字重与主次色)
        if (data.compressionDetected && data.compressionDrop > 0) {
            const dropPct = data.compressionBefore > 0 ? ((data.compressionDrop / data.compressionBefore) * 100).toFixed(1) : '0';
            nodes.push(createDivider());
            const compRow = document.createElement('div');
            compRow.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:1px 0;font-size:11px;font-weight:400;';
            const compLeft = document.createElement('span');
            compLeft.style.cssText = `color:${mutedColor};`;
            compLeft.textContent = isEn ? 'Auto-compressed' : '已触发自动压缩';
            const compRight = document.createElement('span');
            compRight.style.cssText = `color:${fgColor};`;
            compRight.textContent = `${formatTokenValue(data.compressionBefore)} → ${formatTokenValue(data.compressionAfter)} (-${dropPct}%)`;
            compRow.appendChild(compLeft);
            compRow.appendChild(compRight);
            nodes.push(compRow);
        } else if (data.usagePercent >= 85) {
            nodes.push(createDivider());
            const warnRow = document.createElement('div');
            warnRow.style.cssText = `padding:1px 0;font-size:11px;font-weight:400;color:${MORANDI_3A.red};`;
            warnRow.textContent = isEn ? 'Approaching auto-compaction threshold' : '接近自动压缩阈值，建议适时归档上下文';
            nodes.push(warnRow);
        }

        // 7. 5小时剩余额度与重置时间 (修复重置时间读取与文案拼接)
        if (data.quotaInfo && typeof data.quotaInfo.remainingFraction === 'number') {
            const qPct = Math.round(data.quotaInfo.remainingFraction * 100);
            const resetText = formatResetText(data.quotaInfo.resetTimeMs || data.quotaInfo.resetTime, lang);
            nodes.push(createDivider());
            nodes.push(createStandardRow(
                isEn ? '5h Remaining Quota' : '5小时剩余额度',
                `${qPct}%${resetText ? ' · ' + resetText : ''}`
            ));
        }

        // 8. 底部栏：步数 + 点击切换中英文提示
        const switchHint = isEn ? 'Click to switch: 中文' : '点击切换: English';
        const footerRow = document.createElement('div');
        footerRow.style.cssText = `border-top:1px solid ${borderColor};margin-top:6px;padding-top:5px;font-size:11px;color:${mutedColor};font-weight:400;display:flex;justify-content:space-between;gap:12px;`;
        const stepsSpan = document.createElement('span');
        stepsSpan.textContent = `${isEn ? 'Steps' : '步数'}: ${data.stepCount || 0}`;
        const hintSpan = document.createElement('span');
        hintSpan.textContent = switchHint;
        footerRow.appendChild(stepsSpan);
        footerRow.appendChild(hintSpan);
        nodes.push(footerRow);

        if (typeof el.replaceChildren === 'function') {
            el.replaceChildren(...nodes);
        } else {
            while (el.firstChild) el.removeChild(el.firstChild);
            for (const n of nodes) el.appendChild(n);
        }

        // 定位在胶囊正上方
        const rect = capsuleBtn.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - elRect.width / 2;
        left = Math.max(8, Math.min(window.innerWidth - elRect.width - 8, left));
        let top = rect.top - elRect.height - 8;
        if (top < 8) top = rect.bottom + 8;

        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
        el.style.opacity = '1';
    }

    function hideTooltip() {
        activeTooltipTarget = null;
        if (tooltipEl) {
            tooltipEl.style.opacity = '0';
        }
    }

    // 使用纯原生 DOM + SVG API 构建胶囊按钮子节点 (纯节点树组装，兼容严格内容安全策略)
    function populateCapsuleButtonDom(capsuleBtn) {
        const svgNs = 'http://www.w3.org/2000/svg';

        const speedWrap = document.createElement('span');
        speedWrap.className = 'agy-ctx-speed';
        speedWrap.style.cssText = 'display:inline-flex;align-items:center;gap:2.5px;margin-right:3px;opacity:0.85;';

        const boltSvg = document.createElementNS(svgNs, 'svg');
        boltSvg.setAttribute('width', '10');
        boltSvg.setAttribute('height', '12');
        boltSvg.setAttribute('viewBox', '0 0 12 14');
        boltSvg.setAttribute('fill', 'currentColor');
        boltSvg.style.cssText = 'display:block;opacity:0.8;';
        const boltPath = document.createElementNS(svgNs, 'path');
        boltPath.setAttribute('d', 'M7.2 1L1.5 8h4.2L4.8 13l5.7-7H6.3L7.2 1z');
        boltSvg.appendChild(boltPath);

        const speedVal = document.createElement('span');
        speedVal.className = 'agy-ctx-speed-val';
        speedVal.textContent = '-- tok/s';

        speedWrap.appendChild(boltSvg);
        speedWrap.appendChild(speedVal);

        const trackSvg = document.createElementNS(svgNs, 'svg');
        trackSvg.setAttribute('width', '18');
        trackSvg.setAttribute('height', '12');
        trackSvg.setAttribute('viewBox', '0 0 18 12');
        trackSvg.setAttribute('class', 'shrink-0');
        trackSvg.style.cssText = 'display:block;';

        const outerRect = document.createElementNS(svgNs, 'rect');
        outerRect.setAttribute('x', '1');
        outerRect.setAttribute('y', '1.8');
        outerRect.setAttribute('width', '16');
        outerRect.setAttribute('height', '8.4');
        outerRect.setAttribute('rx', '4.2');
        outerRect.setAttribute('fill', 'none');
        outerRect.setAttribute('stroke', 'currentColor');
        outerRect.setAttribute('stroke-width', '1.3');
        outerRect.setAttribute('stroke-opacity', '0.5');

        const fillRect = document.createElementNS(svgNs, 'rect');
        fillRect.setAttribute('class', 'agy-ctx-fill');
        fillRect.setAttribute('x', '2.8');
        fillRect.setAttribute('y', '3.4');
        fillRect.setAttribute('width', '12.4');
        fillRect.setAttribute('height', '5.2');
        fillRect.setAttribute('rx', '2.6');
        fillRect.setAttribute('fill', MORANDI_3A.green);

        trackSvg.appendChild(outerRect);
        trackSvg.appendChild(fillRect);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'agy-ctx-label';
        labelSpan.textContent = '0k/256k, 0%';

        capsuleBtn.appendChild(speedWrap);
        capsuleBtn.appendChild(trackSvg);
        capsuleBtn.appendChild(labelSpan);
    }

    // 在单个 .agy-composer-footer 内创建或更新 3A 莫兰迪跑道胶囊
    function renderFooterCapsule(footerEl, usageData) {
        if (!footerEl) return;
        let capsuleBtn = footerEl.querySelector('[data-agy-context-capsule="1"]');
        const permBtn = footerEl.querySelector('button[data-testid="permissions-selector-trigger"]');

        if (!capsuleBtn) {
            capsuleBtn = document.createElement('button');
            capsuleBtn.type = 'button';
            capsuleBtn.setAttribute('data-agy-context-capsule', '1');
            capsuleBtn.setAttribute('translate', 'no');
            capsuleBtn.className = 'notranslate flex cursor-pointer items-center h-7 gap-1.5 rounded-full px-2 text-xs text-secondary-foreground select-none outline-none hover:bg-secondary transition-colors shrink-0 whitespace-nowrap';
            capsuleBtn.style.fontVariantNumeric = 'tabular-nums';

            populateCapsuleButtonDom(capsuleBtn);

            capsuleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleLangMode();
            });
            capsuleBtn.addEventListener('mouseenter', () => {
                activeTooltipTarget = capsuleBtn;
                updateTooltipContent(capsuleBtn);
                if (userStatusCache.modelConfigs.length === 0 || Date.now() - userStatusCache.fetchedAt > 10000) {
                    refreshUserStatus(true).then(() => {
                        renderAllFooters();
                        if (activeTooltipTarget === capsuleBtn) {
                            updateTooltipContent(capsuleBtn);
                        }
                    });
                }
            });
            capsuleBtn.addEventListener('mouseleave', () => {
                if (activeTooltipTarget === capsuleBtn) hideTooltip();
            });

            if (permBtn && permBtn.parentNode) {
                permBtn.parentNode.insertBefore(capsuleBtn, permBtn);
            } else {
                const rightBox = footerEl.querySelector('.shrink-0.flex.items-center');
                if (rightBox) {
                    rightBox.insertBefore(capsuleBtn, rightBox.firstChild);
                } else {
                    footerEl.appendChild(capsuleBtn);
                }
            }
        } else if (permBtn && permBtn.parentNode && capsuleBtn.nextSibling !== permBtn) {
            permBtn.parentNode.insertBefore(capsuleBtn, permBtn);
        }

        capsuleBtn.__ctxUsageData = usageData;

        const color = getMorandi3AColor(usageData.usagePercent);
        const remainPct = Math.max(0, Math.min(100, 100 - usageData.usagePercent));
        const fillWidth = Math.max(2.2, (12.4 * remainPct) / 100).toFixed(1);

        const fillRect = capsuleBtn.querySelector('.agy-ctx-fill');
        if (fillRect) {
            if (fillRect.getAttribute('width') !== fillWidth) fillRect.setAttribute('width', fillWidth);
            if (fillRect.getAttribute('fill') !== color) fillRect.setAttribute('fill', color);
        }

        const usedStr = formatTokenValue(usageData.contextUsed);
        const limitStr = formatTokenValue(usageData.contextLimit);
        const pctStr = usageData.usagePercent.toFixed(1).replace(/\.0$/, '') + '%';
        const nextText = `${usedStr}/${limitStr}, ${pctStr}`;

        const labelSpan = capsuleBtn.querySelector('.agy-ctx-label');
        if (labelSpan && labelSpan.textContent !== nextText) {
            labelSpan.textContent = nextText;
        }

        const speedValSpan = capsuleBtn.querySelector('.agy-ctx-speed-val');
        if (speedValSpan) {
            const speedText = usageData.tokPerSec > 0 ? `${usageData.tokPerSec} tok/s` : '-- tok/s';
            if (speedValSpan.textContent !== speedText) {
                speedValSpan.textContent = speedText;
            }
        }

        if (activeTooltipTarget === capsuleBtn) {
            updateTooltipContent(capsuleBtn);
        }
    }

    // 选择兜底活跃会话
    function findFallbackConversationId() {
        let bestId = '';
        let bestTime = 0;
        for (const [cid, sum] of trajectoriesMap.entries()) {
            if (sum.status && sum.status.includes('RUNNING')) return cid;
            const t = new Date(sum.lastModifiedTime || 0).getTime();
            if (t > bestTime) {
                bestTime = t;
                bestId = cid;
            }
        }
        return bestId;
    }

    // 渲染页面上所有的 .agy-composer-footer (同时支持本地缓存、云端 Fiber 步骤与 DOM 实时感知兜底)
    function renderAllFooters() {
        const footers = document.querySelectorAll('.agy-composer-footer');
        if (!footers || footers.length === 0) return;

        for (const footer of footers) {
            const ctx = extractComposerContext(footer);
            const cid = ctx.conversationId;
            const quotaInfo = findQuotaForModel(ctx.modelId, ctx.modelLabel, ctx.quotaInfo, ctx.fiberModelConfigs);

            let baseUsage = null;
            if (cid && sessionCache.has(cid)) {
                baseUsage = sessionCache.get(cid).usage;
            }
            // 若 sessionCache 中尚无数据或为 0，立即尝试从 Fiber 步骤或 DOM 实时感知计算 (解决云端项目显示全 0 问题)
            if (!baseUsage || baseUsage.contextUsed === 0) {
                if (Array.isArray(ctx.fiberSteps) && ctx.fiberSteps.length > 0) {
                    baseUsage = analyzeSteps(ctx.fiberSteps, ctx.modelId, ctx.modelLabel, Math.max(ctx.fiberStepCount, ctx.fiberSteps.length));
                } else {
                    const domUsage = computeDomFallbackUsage(footer, cid, ctx.modelId, ctx.modelLabel);
                    if (domUsage && domUsage.contextUsed > 0) {
                        baseUsage = domUsage;
                    }
                }
            }

            if (baseUsage) {
                const effectiveModelId = ctx.modelId || baseUsage.modelId;
                const effectiveQuota = quotaInfo || findQuotaForModel(effectiveModelId, baseUsage.modelDisplayName, null, ctx.fiberModelConfigs) || baseUsage.quotaInfo;
                const usage = Object.assign({}, baseUsage, {
                    modelDisplayName: resolveModelDisplayName(effectiveModelId, ctx.modelLabel || baseUsage.modelDisplayName),
                    quotaInfo: effectiveQuota
                });
                renderFooterCapsule(footer, usage);
            } else {
                const limit = getContextLimitForModel(ctx.modelId, ctx.modelLabel);
                const emptyUsage = {
                    contextUsed: 0,
                    contextLimit: limit,
                    usagePercent: 0,
                    remainPercent: 100,
                    inputTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    outputTokens: 0,
                    estimatedDelta: 0,
                    hasPreciseSnapshot: false,
                    cacheHitRate: 0,
                    tokPerSec: 0,
                    avgTokPerSec: 0,
                    lastDurationSec: 0,
                    compressionDetected: false,
                    compressionBefore: 0,
                    compressionAfter: 0,
                    compressionDrop: 0,
                    modelId: ctx.modelId,
                    modelDisplayName: resolveModelDisplayName(ctx.modelId, ctx.modelLabel),
                    stepCount: 0,
                    quotaInfo
                };
                renderFooterCapsule(footer, emptyUsage);
            }
        }
    }

    // 轮询同步最新轨迹与配额状态 (解除 trajectoriesMap.has(cid) 限制，全面支持本地项目 + 云端项目 + 网页端)
    async function pollCycle() {
        if (isPolling) return;
        isPolling = true;
        try {
            const footers = Array.from(document.querySelectorAll('.agy-composer-footer'));
            if (footers.length === 0) return;

            // 1. 每 30 秒刷新一次 GetUserStatus
            await refreshUserStatus(false);

            // 2. 拉取本地会话摘要列表 (若在云端/网页端返回空也不阻塞后续流程)
            const trajResp = await callLsRpc('GetAllCascadeTrajectories', {
                metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
            });
            if (trajResp && trajResp.trajectorySummaries) {
                trajectoriesMap.clear();
                for (const [cid, sum] of Object.entries(trajResp.trajectorySummaries)) {
                    trajectoriesMap.set(cid, sum);
                    const shortKey = normalizeCidKey(cid);
                    if (shortKey) trajectoriesMap.set(shortKey, sum);
                }
            }

            // 3. 针对当前页面上所有可见对话框并行刷新 (无论是否在本地 trajectoriesMap 中均执行刷新)
            const activeTasks = [];
            const seenCids = new Set();
            for (const footer of footers) {
                const ctx = extractComposerContext(footer);
                let cid = ctx.conversationId;
                if ((!cid || cid.startsWith('__agy_panel_')) && footers.length === 1 && trajectoriesMap.size === 1) {
                    cid = findFallbackConversationId() || cid;
                }
                if (cid && !seenCids.has(cid)) {
                    seenCids.add(cid);
                    const shortCid = normalizeCidKey(cid);
                    const summary = trajectoriesMap.get(cid) || (shortCid ? trajectoriesMap.get(shortCid) : null) || null;
                    activeTasks.push(
                        refreshConversationUsage(cid, summary, ctx.modelId, ctx.modelLabel, ctx, footer)
                    );
                }
            }
            if (activeTasks.length > 0) {
                await Promise.allSettled(activeTasks);
            }

            // 4. 更新所有底部工具栏胶囊 UI
            renderAllFooters();
        } catch (e) {
            // 静默容错
        } finally {
            isPolling = false;
        }
    }

    // 监听 DOM 与主题变化：切换会话、打开新聊天框、流式输出或切换白天/黑夜模式时即时响应
    let mutationTimer = null;
    const domObserver = new MutationObserver(() => {
        const footers = document.querySelectorAll('.agy-composer-footer');
        let needsImmediateRender = false;
        for (const f of footers) {
            if (!f.querySelector('[data-agy-context-capsule="1"]')) {
                needsImmediateRender = true;
                break;
            }
        }
        if (needsImmediateRender) {
            renderAllFooters();
        }
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            renderAllFooters();
            if (activeTooltipTarget) updateTooltipContent(activeTooltipTarget);
        }, 250);
    });

    // 判断当前页面是否具备 Antigravity 桌面或网页端宿主特征 (防止在普通 localhost 或无关网页挂载 fetch 钩子)
    function isLikelyAntigravityHost() {
        if (isElectronHost) return true;
        try {
            const host = (typeof location !== 'undefined' && location.hostname ? location.hostname : '').toLowerCase();
            if (
                host === 'antigravity.google' ||
                host.endsWith('.antigravity.google') ||
                host.startsWith('antigravity.') ||
                host.includes('-antigravity.')
            ) {
                return true;
            }
            if (Boolean(window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken)) {
                return true;
            }
            if (
                document.querySelector('.agy-composer-footer') ||
                document.querySelector('button[data-testid="permissions-selector-trigger"]')
            ) {
                return true;
            }
            const title = (document.title || '').toLowerCase();
            if (title.includes('antigravity') && document.querySelector('textarea, [contenteditable="true"]')) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function activateCapsuleEngine() {
        if (engineActivated) return;
        const root = document.body || document.documentElement;
        if (!root) {
            setTimeout(activateCapsuleEngine, 200);
            return;
        }
        engineActivated = true;
        installNetworkSniffer();
        domObserver.observe(root, { childList: true, subtree: true });
        if (document.documentElement) {
            domObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        }
        renderAllFooters();
        pollCycle();
        setInterval(pollCycle, 3000);
    }

    function startCapsuleMonitor() {
        if (isLikelyAntigravityHost()) {
            activateCapsuleEngine();
            return;
        }
        // 在未知网页端 (如 localhost 或泛域名) 仅做 3 次轻量延迟嗅探，不命中则彻底休眠退出，零性能损耗
        const probeDelays = [1500, 5000, 12000];
        for (const delay of probeDelays) {
            setTimeout(() => {
                if (!engineActivated && isLikelyAntigravityHost()) {
                    activateCapsuleEngine();
                }
            }, delay);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startCapsuleMonitor);
    } else {
        startCapsuleMonitor();
    }
})();
