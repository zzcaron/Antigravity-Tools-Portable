# Antigravity 便携式增强工具箱 (全离线·免配置·绿色自包含)

专为 **Google Antigravity 2.x** 打造的全离线增强工具箱，已内嵌便携版 Node.js 运行环境与核心工具全部离线资源。复制到任何白板 Windows 电脑上直接双击批处理脚本即可使用。

---

## 一、项目来源与鸣谢

1. **[Antigravity 对话上下文查看器与 Token 用量看板 (Context Viewer)](https://github.com/elviscjn-cjn/antigravity-context-viewer)**
   - 核心功能：52周活跃热力图、长周期用量统计、API账单折算、系统提示词 0至4 档精简、上下文上限解锁、界面汉化等
   - 社区鸣谢：Linux.do 社区 (`@23375`, `@anyu0804`, `@Jia131313` 等)
   - 本地目录：`packages/viewer/` (v0.8.3)

2. **[Antigravity Pulse (能量胶囊)](https://github.com/akelabs/antigravity-pulse)**
   - 核心功能：原生输入框底部 `Turbo` 旁呈现实时 `tok/s` 速度、莫兰迪容量跑道胶囊、5小时配额重置倒计时、临界压缩感知 (>=85%)
   - 开发团队：Ake Labs (`@akelabs` / `@codavidgarcia`)
   - 本地目录：`packages/pulse/` (v1.3.1)

---

## 二、目录结构

```text
Antigravity-Tools-Portable/
├── bin/
│   ├── node/
│   │   └── node.exe                                 # 内置便携版 Node.js (v26.4.0)，免全局安装
│   └── hot-reload.js                                # 基于 CDP 的即时热重载引擎 (免杀进程)
├── packages/
│   ├── viewer/                                      # Context Viewer 完整离线源码与引擎
│   └── pulse/                                       # Pulse 能量胶囊离线载荷与补丁核心
├── 一键安装全部工具.bat                               # 【推荐】黄金顺序（先 Viewer 后 Pulse）一键安装
├── 一键卸载全部工具.bat                               # 【推荐】逆序（先 Pulse 后 Viewer）恢复官方原版
├── 1-安装-ContextViewer(上下文查看器).bat             # 单独安装/更新 Context Viewer
├── 1-卸载-ContextViewer(上下文查看器).bat             # 单独卸载 Context Viewer 并还原备份
├── 2-安装-Pulse(能量胶囊).bat                         # 单独安装/更新 Pulse 能量胶囊
├── 2-卸载-Pulse(能量胶囊).bat                         # 单独精确剥离 Pulse 能量胶囊
├── 【汉化】开启客户端界面中文.bat                     # 开启界面汉化，内置自动热重载，秒级生效
├── 【汉化】关闭客户端界面中文(恢复英文).bat          # 关闭界面汉化，恢复原生英文界面
├── 【标题】开启自动中文会话标题.bat                   # 新开对话自动生成简短中文标题 (4至10字)
├── 【标题】关闭自动中文会话标题(恢复英文).bat        # 恢复官方英文会话标题规则
├── 【上下文】0-查看解锁状态.bat                       # 查看 language_server.exe 解锁状态
├── 【上下文】1-解锁为1M动态模式(跟随模型上限).bat     # 突破 256K 限制，跟随模型物理上限 (1M)
├── 【上下文】2-解锁为512K固定模式.bat                 # 自动压缩阈值固定翻倍至 512,000 Tokens
├── 【上下文】3-恢复官方原版256K.bat                  # 100% 还原为官方 256K 二进制
├── 【工具】即时热重载窗口(免重启刷新).bat            # 1秒内免重启热重载所有活动窗口
└── README.txt / README.md                           # 跨电脑使用说明与完整文档
```

---

## 三、脚本功能全览

| 分类 | 脚本名称 | 功能说明 |
| :--- | :--- | :--- |
| **快捷联动** | `一键安装全部工具.bat` | 自动按照黄金顺序（先 Viewer 后 Pulse）一键完成注入与重启 |
| | `一键卸载全部工具.bat` | 逆序（先剥离 Pulse 后还原 Viewer）完全恢复为官方原版 `app.asar` |
| **独立控制** | `1-安装-ContextViewer(上下文查看器).bat` | 单独安装/更新顶栏 Context Viewer |
| | `1-卸载-ContextViewer(上下文查看器).bat` | 单独卸载 Context Viewer 并恢复原始备份 |
| | `2-安装-Pulse(能量胶囊).bat` | 单独安装/更新输入框底部 Pulse 能量胶囊 |
| | `2-卸载-Pulse(能量胶囊).bat` | 单独精确剥离 Pulse 能量胶囊 |
| **本地化增强** | `【汉化】开启客户端界面中文.bat` | 独立纯净汉化 (方案 A)，零 ContextViewer 残留，内置 Pulse 共存守护与热重载 |
| | `【汉化】关闭客户端界面中文(恢复英文).bat` | 精准剥离汉化补丁，恢复原生英文界面，保留 Pulse 能量胶囊 |
| | `【标题】开启自动中文会话标题.bat` | 改写内核提示词，后续新建的对话自动生成简短中文标题 |
| | `【标题】关闭自动中文会话标题(恢复英文).bat` | 恢复为官方英文标题命名规则 |
| **上下文突破** | `【上下文】0-查看解锁状态.bat` | 检查当前机器后端二进制的解锁状态与备份 |
| | `【上下文】1-解锁为1M动态模式(跟随模型上限).bat` | 突破 256K 限制，对齐模型真实的 1,000,000 Tokens 物理上限 |
| | `【上下文】2-解锁为512K固定模式.bat` | 将自动压缩阈值固定为 512,000 Tokens |
| | `【上下文】3-恢复官方原版256K.bat` | 恢复为官方原始 256,000 阈值 |
| **维护工具** | `【工具】即时热重载窗口(免重启刷新).bat` | 基于 CDP 协议 1 秒内免重启热刷新所有活动窗口 |

> [!WARNING]
> **⚠️ 性能与卸载注意事项**
> 1. **性能与流畅度提示**：`Context Viewer (上下文查看器)` 由于包含高频会话扫描、长周期 Token 统计与复杂看板 DOM 挂载，在长会话或特定设备上可能会导致 Antigravity 客户端界面出现**卡顿、掉帧或响应延迟**。若您在日常使用中感知到明显卡顿，建议使用 `1-卸载-ContextViewer(上下文查看器).bat` 将其卸载，仅保留极其轻量原生化的 `Pulse (能量胶囊)`。
> 2. **关于单独卸载 Context Viewer 导致 Pulse 连带失效的说明**：
>    - **根本原因**：Context Viewer 与 Pulse 能量胶囊均修改同一个客户端核心文件 `app.asar`。执行 `1-卸载-ContextViewer(上下文查看器).bat` 时，其还原机制会将 `app.asar` 整体恢复为安装前备份的**官方纯净原版**，因此会一并覆盖还原 Pulse 的挂载钩子。
>    - **推荐规范**：
>      - **完全恢复原版**：推荐使用 `一键卸载全部工具.bat`（自动按照逆序：先精准剥离 Pulse，再还原 Context Viewer）。
>      - **仅卸载 Context Viewer 并保留 Pulse**：在执行完 `1-卸载-ContextViewer(上下文查看器).bat` 后，只需重新双击运行一次 `2-安装-Pulse(能量胶囊).bat`（约 20 毫秒即可重新挂载钩子），即可恢复输入框底部的能量胶囊。

---

## 四、跨电脑使用方法

1. 将本文件夹完整打包为 zip 或直接复制到 U 盘 / 网盘。
2. 拷贝到另一台 Windows 电脑的任意位置。
3. 确保该电脑已安装 Antigravity 客户端（默认路径：`%LOCALAPPDATA%\Programs\antigravity`）。
4. 直接双击 `一键安装全部工具.bat`，数秒后客户端自动拉起，即可直接使用！
   - 目标电脑**不需要**安装 Node.js、**不需要**安装 Git、**不需要**联网下载任何依赖。
