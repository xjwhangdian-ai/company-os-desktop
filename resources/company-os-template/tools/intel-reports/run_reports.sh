#!/bin/bash
# 研报情报每日抓取 — 行业趋势 + 政策文件（sgpjbg.com，仅抓元数据+下载页链接）
# 用法: run_reports.sh [YYYY-MM-DD]
# 产出: outputs/09_情报_intel/研报追踪/{日期}_研报信息流.json（工作台「行业情报」页读）

set -u
# 自定位：按脚本自身位置推导仓库根（兼容从 App/launchd/终端等任意目录调起，不再硬编码）
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SELF_DIR/../.." && pwd)"
SCRIPTS="$SELF_DIR/scripts"
PY="/usr/bin/python3"
DATE="${1:-$(date +%Y-%m-%d)}"
TRACK="$REPO/outputs/09_情报_intel/研报追踪"
LOG="$SCRIPTS/logs/run_reports_$DATE.log"

mkdir -p "$TRACK" "$SCRIPTS/logs"
if ! cd "$SCRIPTS"; then
  # 自诊断：把现场环境打给调用方（App 会展示这段），别只留一句 cd 失败
  echo "FAILED: scripts 目录不可达: $SCRIPTS"
  echo "诊断: SELF_DIR=$SELF_DIR user=$(id -un) pwd=$(pwd)"
  ls -la "$SELF_DIR" 2>&1 | head -5
  exit 1
fi
echo "===== run_reports $DATE 开始 $(date '+%H:%M:%S') =====" >> "$LOG"

# 乐采云/sgpjbg 都依赖 Chrome 调试端口 9222——不在就拉起（独立 profile，且需已登录 sgpjbg 会员）
if ! curl -s -m 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "[INFO] 9222 未响应，拉起 Chrome 调试实例" >> "$LOG"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port=9222 --no-proxy-server \
    --user-data-dir="$HOME/.openclaw/chrome-debug-profile" >> "$LOG" 2>&1 &
  sleep 8
fi

"$PY" sgpjbg_feed.py --date "$DATE" --out "$TRACK/${DATE}_研报信息流.json" >> "$LOG" 2>&1
RC=$?
echo "===== run_reports $DATE 结束 rc=$RC $(date '+%H:%M:%S') =====" >> "$LOG"
if [ $RC -eq 0 ]; then echo "OK: $TRACK/${DATE}_研报信息流.json"; else
  echo "FAILED rc=$RC（多为未登录 sgpjbg 或反爬验证，见 $LOG）"; fi
