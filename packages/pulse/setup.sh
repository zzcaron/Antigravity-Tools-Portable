#!/usr/bin/env bash
# Antigravity Pulse - setup for macOS (Apple Silicon ARM64 / Intel x86_64 + Web) & Linux (Web / Desktop)
# Antigravity 能量胶囊 macOS（Apple Silicon ARM64 / Intel x86_64 + 网页版）与 Linux 安装配置脚本
#
# Usage / 用法:
#   bash setup.sh --arch arm64   install/update on Apple Silicon Mac / Apple Silicon 安装或更新
#   bash setup.sh --arch intel   install/update on Intel Mac / Intel Mac 安装或更新
#   bash setup.sh --confirm      ask before restarting Antigravity / 重启客户端前询问确认
#   bash setup.sh --check        read-only status check / 只读巡检
#   bash setup.sh --uninstall    remove hook, restore backup & clean local Pulse files / 卸载还原并清理本地组件
#   bash setup.sh --web          only export browser extension & userscript / 仅导出网页版
#   bash setup.sh --offline      use the .js files next to this script / 使用脚本同目录本地文件
#   bash setup.sh --asar PATH    custom .app or app.asar path / 自定义路径
set -euo pipefail

ORIG_ARGS=("$@")
BASE="https://github.com/akelabs/antigravity-pulse/releases/latest/download"
MIN_NODE=18
HERE="$(cd "$(dirname "$0")" && pwd)"
OS_NAME="$(uname -s)"

# Resolve real user home directory (compatible with sudo)
resolve_sudo_user_home() {
  local u="$1"
  case "$u" in
    ""|root|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  if [ "$OS_NAME" = "Darwin" ]; then
    if [ -d "/Users/$u" ]; then
      printf '%s\n' "/Users/$u"
      return 0
    fi
    if command -v dscl >/dev/null 2>&1; then
      local dh
      dh="$(dscl . -read "/Users/$u" NFSHomeDirectory 2>/dev/null | awk '/NFSHomeDirectory:/ {print $2; exit}')"
      if [ -n "$dh" ] && [ -d "$dh" ]; then
        printf '%s\n' "$dh"
        return 0
      fi
    fi
  else
    if [ -d "/home/$u" ]; then
      printf '%s\n' "/home/$u"
      return 0
    fi
    if command -v getent >/dev/null 2>&1; then
      local gh
      gh="$(getent passwd "$u" 2>/dev/null | cut -d: -f6)"
      if [ -n "$gh" ] && [ -d "$gh" ]; then
        printf '%s\n' "$gh"
        return 0
      fi
    fi
  fi
  return 1
}

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  if USER_HOME="$(resolve_sudo_user_home "$SUDO_USER")"; then
    REAL_HOME="$USER_HOME"
  else
    REAL_HOME="$HOME"
  fi
else
  REAL_HOME="$HOME"
fi

DIR="$REAL_HOME/.gemini/tools"

prepend_path() {
  [ -d "$1" ] || return 0
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
}

force_prepend_path() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  local new_path="" part
  local old_ifs="$IFS"
  IFS=":"
  for part in $PATH; do
    [ -n "$part" ] || continue
    [ "$part" = "$dir" ] && continue
    if [ -z "$new_path" ]; then
      new_path="$part"
    else
      new_path="$new_path:$part"
    fi
  done
  IFS="$old_ifs"
  if [ -z "$new_path" ]; then
    PATH="$dir"
  else
    PATH="$dir:$new_path"
  fi
}

append_path() {
  [ -d "$1" ] || return 0
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$PATH:$1" ;;
  esac
}

# Complete Node.js / Homebrew paths (especially for macOS non-login shells & Finder)
for nvm_bin in "$REAL_HOME"/.nvm/versions/node/*/bin; do
  [ -d "$nvm_bin" ] && prepend_path "$nvm_bin"
done
prepend_path "$REAL_HOME/Library/Application Support/fnm/aliases/default/bin"
prepend_path "$REAL_HOME/.local/share/fnm/aliases/default/bin"
prepend_path "$REAL_HOME/.fnm/current/bin"
prepend_path "$REAL_HOME/.local/bin"
prepend_path "$REAL_HOME/.local/share/mise/shims"
prepend_path "$REAL_HOME/.asdf/shims"
prepend_path "$REAL_HOME/.volta/bin"
prepend_path "/opt/local/bin"
prepend_path "/usr/local/sbin"
prepend_path "/usr/local/bin"
prepend_path "/opt/homebrew/sbin"
prepend_path "/opt/homebrew/bin"
append_path "/usr/bin"
append_path "/bin"
append_path "/usr/sbin"
append_path "/sbin"
export PATH

show_help() {
  cat <<'EOF'
Antigravity Pulse - Setup Script (macOS / Linux)
Antigravity 能量胶囊配置脚本 (macOS / Linux)

Usage / 用法:
  bash setup.sh [options]

Options / 参数:
  (default)               Install or update (macOS Desktop + Web; Linux auto-detects Desktop or falls back to Web)
                          安装或更新（macOS 桌面端 + 网页版；Linux 自动检测桌面端或回退网页版）
  --arch arm64            Target macOS Apple Silicon (M1/M2/M3/M4) / 指定 macOS Apple Silicon (ARM64)
  --arch intel            Target macOS Intel (x86_64) / 指定 macOS Intel (x86_64)
  --arch auto             Auto-detect chip architecture (default) / 自动识别芯片架构（默认）
  --confirm               Ask for confirmation before closing Antigravity / 关闭重启客户端前询问确认
  --check, check          Read-only status check (<5ms) / 只读巡检安装状态
  --uninstall, uninstall  Remove hook, restore backup if present, and clean local Pulse files / 卸载还原并清理本地组件
  --keep-files            Keep local .js files in ~/.gemini/tools/ during uninstall / 卸载时保留本地脚本文件
  --web, --web-only, web  Only export Chrome/Edge extension & Tampermonkey userscript to ~/.gemini/tools/antigravity-pulse-web/
                          仅导出网页版扩展与油猴脚本
  --offline               Use local .js files next to setup.sh / 使用脚本同目录下的本地 .js 文件
  --asar <path>           Custom .app or app.asar path / 指定自定义 .app 或 app.asar 路径
  -Action <act>           PowerShell-style alias (install|check|uninstall|web) / 兼容 PowerShell 风格参数
  -h, --help              Show this help and exit / 显示本帮助信息
EOF
}

normalize_arch() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    ""|auto) echo "auto" ;;
    arm64|aarch64|apple) echo "arm64" ;;
    intel|x64|x86_64) echo "intel" ;;
    *) return 1 ;;
  esac
}

ACTION="install"
OFFLINE=0
ASAR_PATH=""
ARCH_MODE="auto"
ARCH_SPECIFIED=0
CONFIRM_FLAG=0
YES_FLAG=0
CLEAN_FLAG=0
KEEP_FILES=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    --arch)
      if [ $# -lt 2 ]; then
        echo "Missing value for --arch / 缺少 --arch 参数值" >&2
        exit 2
      fi
      if ! ARCH_MODE="$(normalize_arch "$2")"; then
        echo "Invalid --arch value: $2 (expected arm64|intel|x64|x86_64|auto) / 无效的 --arch 参数：$2" >&2
        exit 2
      fi
      ARCH_SPECIFIED=1
      shift 2
      ;;
    --arch=*)
      if ! ARCH_MODE="$(normalize_arch "${1#*=}")"; then
        echo "Invalid --arch value: ${1#*=} (expected arm64|intel|x64|x86_64|auto) / 无效的 --arch 参数：${1#*=}" >&2
        exit 2
      fi
      ARCH_SPECIFIED=1
      shift
      ;;
    --check|check)
      ACTION="check"
      shift
      ;;
    --uninstall|uninstall)
      ACTION="uninstall"
      shift
      ;;
    --web|--web-only|web)
      ACTION="web"
      shift
      ;;
    --install|install)
      ACTION="install"
      shift
      ;;
    --confirm|-Confirm)
      CONFIRM_FLAG=1
      shift
      ;;
    --yes|-y)
      YES_FLAG=1
      shift
      ;;
    --clean|-Clean)
      CLEAN_FLAG=1
      shift
      ;;
    --keep-files|-KeepFiles)
      KEEP_FILES=1
      shift
      ;;
    -Action|-action|--action)
      if [ $# -lt 2 ]; then
        echo "Missing value for $1 / 缺少 $1 参数值" >&2
        exit 2
      fi
      act_val="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
      case "$act_val" in
        install) ACTION="install" ;;
        check) ACTION="check" ;;
        uninstall) ACTION="uninstall" ;;
        web|web-only) ACTION="web" ;;
        *)
          echo "Unknown action: $2 / 未知动作：$2" >&2
          exit 2
          ;;
      esac
      shift 2
      ;;
    -Action=*|-action=*|--action=*)
      act_val="$(printf '%s' "${1#*=}" | tr '[:upper:]' '[:lower:]')"
      case "$act_val" in
        install) ACTION="install" ;;
        check) ACTION="check" ;;
        uninstall) ACTION="uninstall" ;;
        web|web-only) ACTION="web" ;;
        *)
          echo "Unknown action: ${1#*=} / 未知动作：${1#*=}" >&2
          exit 2
          ;;
      esac
      shift
      ;;
    --offline|-Offline)
      OFFLINE=1
      shift
      ;;
    --online)
      OFFLINE=0
      shift
      ;;
    --asar|-Asar)
      if [ $# -lt 2 ]; then
        echo "Missing value for $1 / 缺少 $1 参数值" >&2
        exit 2
      fi
      ASAR_PATH="$2"
      shift 2
      ;;
    --asar=*|-Asar=*)
      ASAR_PATH="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1 (use --help for usage) / 未知参数：$1（使用 --help 查看用法）" >&2
      exit 2
      ;;
  esac
done

# macOS architecture verification, Rosetta 2 native ARM64 re-exec, and PATH prioritization
if [ "$OS_NAME" = "Darwin" ]; then
  if [ "$ARCH_MODE" = "arm64" ]; then
    HOST_MACHINE="$(uname -m 2>/dev/null || echo "")"
    CAN_ARM64="$(sysctl -n hw.optional.arm64 2>/dev/null || echo "0")"
    if [ "$HOST_MACHINE" != "arm64" ] && [ "$CAN_ARM64" != "1" ]; then
      echo "This Mac is Intel (x86_64) and does not support Apple Silicon (--arch arm64). Please use --arch intel instead." >&2
      echo "当前 Mac 为 Intel (x86_64) 架构，不支持 Apple Silicon (--arch arm64)，请改用 --arch intel。" >&2
      exit 1
    fi
    if [ "$HOST_MACHINE" = "x86_64" ] && [ "$CAN_ARM64" = "1" ] && [ -z "${AGY_PULSE_ARCH_REEXEC:-}" ] && [ -x "/usr/bin/arch" ]; then
      AGY_PULSE_ARCH_REEXEC=1 exec /usr/bin/arch -arm64 bash "$0" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
    fi
    force_prepend_path "/opt/homebrew/sbin"
    force_prepend_path "/opt/homebrew/bin"
  elif [ "$ARCH_MODE" = "intel" ]; then
    force_prepend_path "/usr/local/sbin"
    force_prepend_path "/usr/local/bin"
  fi
  export PATH
fi

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local ver major
  ver="$(node --version 2>/dev/null | sed 's/^v//')"
  major="${ver%%.*}"
  case "$major" in
    ''|*[!0-9]*) echo "0" ;;
    *) echo "$major" ;;
  esac
}

MAJOR="$(get_node_major)"
if [ "$MAJOR" -lt "$MIN_NODE" ]; then
  if [ "$MAJOR" -gt 0 ]; then
    echo "Node.js v$MAJOR is too old (need $MIN_NODE or newer). / Node.js v$MAJOR 版本过旧（需要 $MIN_NODE 及以上）。"
  else
    echo "Node.js was not found. / 未检测到 Node.js。"
  fi

  BREW_BIN=""
  if [ "$OS_NAME" = "Darwin" ]; then
    if [ "$ARCH_MODE" = "arm64" ] && [ -x "/opt/homebrew/bin/brew" ]; then
      BREW_BIN="/opt/homebrew/bin/brew"
    elif [ "$ARCH_MODE" = "intel" ] && [ -x "/usr/local/bin/brew" ]; then
      BREW_BIN="/usr/local/bin/brew"
    elif command -v brew >/dev/null 2>&1; then
      BREW_BIN="$(command -v brew)"
    fi
  fi

  if [ -n "$BREW_BIN" ] && [ -t 0 ]; then
    printf "Install Node.js LTS with Homebrew now? [Y/n] "
    read -r ans || ans="n"
    if [ -z "$ans" ] || printf '%s' "$ans" | grep -Eq '^[Yy]'; then
      if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        sudo -u "$SUDO_USER" "$BREW_BIN" install node
      else
        "$BREW_BIN" install node
      fi
      if [ "$ARCH_MODE" = "arm64" ]; then
        force_prepend_path "/opt/homebrew/sbin"
        force_prepend_path "/opt/homebrew/bin"
      elif [ "$ARCH_MODE" = "intel" ]; then
        force_prepend_path "/usr/local/sbin"
        force_prepend_path "/usr/local/bin"
      fi
      export PATH
      hash -r 2>/dev/null || true
      MAJOR="$(get_node_major)"
    fi
  fi

  if [ "$MAJOR" -lt "$MIN_NODE" ]; then
    echo "Please install Node.js LTS (>= $MIN_NODE) from https://nodejs.org/ (macOS: brew install node) and run again."
    echo "请先从 https://nodejs.org/ 安装 Node.js LTS（macOS 也可运行: brew install node），再重新运行本脚本。"
    exit 1
  fi
fi
echo "[OK] Node.js v$MAJOR"

install_tool_file() {
  local fname="$1"
  local dest="$DIR/$fname"
  local tmp="$dest.download"
  local size

  if [ "$OFFLINE" -eq 1 ]; then
    if [ ! -f "$HERE/$fname" ]; then
      echo "Missing local file next to setup.sh: $HERE/$fname / 同目录下缺少本地文件：$HERE/$fname" >&2
      exit 1
    fi
    cp "$HERE/$fname" "$tmp"
  else
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$BASE/$fname" -o "$tmp"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$tmp" "$BASE/$fname"
    else
      echo "Neither curl nor wget was found to download $fname. / 未检测到 curl 或 wget，无法下载 $fname。" >&2
      exit 1
    fi
  fi

  size="$(wc -c < "$tmp" | tr -d '[:space:]')"
  if [ "$size" -lt 1024 ]; then
    rm -f "$tmp"
    echo "Download looks broken: $fname ($size bytes) / 下载异常：$fname（$size 字节）" >&2
    exit 1
  fi

  [ -f "$dest" ] && cp "$dest" "$dest.bak"
  mv "$tmp" "$dest"
  echo "[OK] $dest"
}

mkdir -p "$DIR"
if [ "$ACTION" = "check" ] || [ "$ACTION" = "uninstall" ]; then
  if { [ "$OFFLINE" -eq 1 ] && [ -f "$HERE/install-context-capsule.js" ]; } || [ ! -f "$DIR/install-context-capsule.js" ]; then
    install_tool_file "install-context-capsule.js"
  fi
else
  install_tool_file "install-context-capsule.js"
  install_tool_file "context-capsule-payload.js"
fi

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  REAL_GROUP="$(id -gn "$SUDO_USER" 2>/dev/null || true)"
  if [ -n "$REAL_GROUP" ]; then
    chown "$SUDO_USER:$REAL_GROUP" "$REAL_HOME/.gemini" 2>/dev/null || true
    chown -R "$SUDO_USER:$REAL_GROUP" "$DIR" 2>/dev/null || true
  else
    chown "$SUDO_USER" "$REAL_HOME/.gemini" 2>/dev/null || true
    chown -R "$SUDO_USER" "$DIR" 2>/dev/null || true
  fi
fi

FINAL_ACTION="$ACTION"
if [ "$OS_NAME" = "Linux" ] && [ "$ACTION" = "install" ] && [ -z "$ASAR_PATH" ]; then
  if [ ! -f "/opt/Antigravity/resources/app.asar" ] && \
     [ ! -f "/opt/antigravity/resources/app.asar" ] && \
     [ ! -f "/usr/share/antigravity/resources/app.asar" ]; then
    echo "[INFO] Desktop Antigravity app.asar not found on Linux; falling back to --web-only (pass --asar <path> for custom desktop installs)."
    echo "[提示] Linux 未检测到默认桌面版 app.asar，自动回退为 --web-only（仅导出网页版扩展与油猴脚本；如需安装自定义桌面路径请传 --asar <path>）。"
    FINAL_ACTION="web"
  fi
fi

NODE_ARGS=()
case "$FINAL_ACTION" in
  install) ;;
  check) NODE_ARGS+=("--check") ;;
  uninstall)
    NODE_ARGS+=("--uninstall")
    if [ "$KEEP_FILES" -eq 0 ]; then
      NODE_ARGS+=("--clean")
    fi
    ;;
  web) NODE_ARGS+=("--web-only") ;;
esac
if [ "$CLEAN_FLAG" -eq 1 ] && [ "$FINAL_ACTION" != "uninstall" ]; then
  NODE_ARGS+=("--clean")
fi
if [ "$CONFIRM_FLAG" -eq 1 ]; then
  NODE_ARGS+=("--confirm")
fi
if [ "$YES_FLAG" -eq 1 ]; then
  NODE_ARGS+=("--yes")
fi
if [ "$ARCH_SPECIFIED" -eq 1 ]; then
  NODE_ARGS+=("--arch" "$ARCH_MODE")
fi
if [ -n "$ASAR_PATH" ]; then
  NODE_ARGS+=("--asar" "$ASAR_PATH")
fi

node "$DIR/install-context-capsule.js" ${NODE_ARGS[@]+"${NODE_ARGS[@]}"}
