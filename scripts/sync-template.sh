#!/bin/bash
# 从 ../company-os 快照生成安装包内置的数据目录模板（resources/company-os-template）。
# 排除：knowledge/internal 敏感内容（只留 README）、settings.local.json、一切运行数据（input/outputs/库文件）。
# 改了 分身定义/CLAUDE.md/knowledge 后想让新安装包带上，重跑本脚本再提交。
set -e
SRC="$HOME/Code/company-os"
DST="$(cd "$(dirname "$0")/.." && pwd)/resources/company-os-template"

[ -d "$DST" ] && rm -r "$DST"
mkdir -p "$DST"

# 大脑：分身定义/快捷命令/权限配置/统一口径
mkdir -p "$DST/.claude"
cp -R "$SRC/.claude/agents" "$DST/.claude/agents"
cp -R "$SRC/.claude/commands" "$DST/.claude/commands"
cp "$SRC/.claude/settings.json" "$DST/.claude/settings.json"
cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md"

# 知识库（internal 只留 README，敏感内容绝不进安装包）
mkdir -p "$DST/knowledge/internal"
for d in company products brand bidding; do
  cp -R "$SRC/knowledge/$d" "$DST/knowledge/$d"
done
[ -f "$SRC/knowledge/internal/README.md" ] && cp "$SRC/knowledge/internal/README.md" "$DST/knowledge/internal/README.md"

# 跨项目模板属于安装所需的长期资料库；运行数据仍不随安装包分发。
for rel in "libraries/03_招投标_bidding/_模板" "libraries/04_法务_legal/_模板" "libraries/02_解决方案_solution/_模板" "libraries/01_销售_sales/_模板"; do
  [ -d "$SRC/$rel" ] || continue
  mkdir -p "$DST/$(dirname "$rel")"
  cp -R "$SRC/$rel" "$DST/$(dirname "$rel")"
done

# 公众号排版引擎
mkdir -p "$DST/tools"
for tool in gzh pdf-catalog invoice-ocr video-gen intel-reports bidding-intel; do
  [ -d "$SRC/tools/$tool" ] && cp -R "$SRC/tools/$tool" "$DST/tools/$tool"
done

# 工具目录只带程序与配置，不把历史抓取结果、状态文件或日志打进安装包。
find "$DST/tools/bidding-intel" -type f \( -name "*_report_*.txt" -o -name "*_data_*.json" -o -name "*_state.json" \) -delete 2>/dev/null || true
find "$DST/tools/intel-reports" -type f \( -name "*_report_*.txt" -o -name "*_data_*.json" -o -name "*_state.json" \) -delete 2>/dev/null || true
find "$DST/tools/bidding-intel" -type f -exec perl -pi -e 's/[[:space:]]+$//' {} + 2>/dev/null || true
rm -rf "$DST/tools/bidding-intel/scripts/downloads" "$DST/tools/bidding-intel/scripts/logs" "$DST/tools/intel-reports/scripts/downloads" "$DST/tools/intel-reports/scripts/logs"
find "$DST/tools" -type f -name "*.sync-conflict-*" -delete 2>/dev/null || true

[ -f "$SRC/tools/windows-env-setup.bat" ] && cp "$SRC/tools/windows-env-setup.bat" "$DST/tools/windows-env-setup.bat"

# 成员首次使用手册随安装模板提供。
[ -d "$SRC/docs/使用说明" ] && mkdir -p "$DST/docs" && cp -R "$SRC/docs/使用说明" "$DST/docs/使用说明"

# 目录骨架（空桶 + .gitkeep）
BUCKETS=(
  "input/01_销售_sales/供应商资料" "input/02_解决方案_solution/需求文件" "input/03_招投标_bidding"
  "input/04_法务_legal" "input/05_运营_operation" "input/06_品牌_brand" "input/07_行政人力_ops-policy"
  "input/08_财务_finance/票据" "input/09_情报_intel" "input/10_MBA学习_mba"
  "outputs/01_销售_sales" "outputs/02_解决方案_solution" "outputs/03_招投标_bidding" "outputs/04_法务_legal"
  "outputs/05_运营_operation" "outputs/06_品牌_brand"
  "outputs/07_行政人力_ops-policy/01_未审核" "outputs/07_行政人力_ops-policy/02_初审"
  "outputs/07_行政人力_ops-policy/03_终审" "outputs/07_行政人力_ops-policy/04_定稿"
  "outputs/08_财务_finance" "outputs/09_情报_intel" "outputs/10_MBA学习_mba"
  "libraries/03_招投标_bidding/_素材库/产品资料" "libraries/03_招投标_bidding/_素材库/产品检测报告" "libraries/03_招投标_bidding/_素材库/产品解决方案"
  "libraries/03_招投标_bidding/_素材库/人员资质" "libraries/03_招投标_bidding/_素材库/类似项目合同" "libraries/03_招投标_bidding/_模板"
  "libraries/02_解决方案_solution/基础产品库" "libraries/02_解决方案_solution/基础解决方案库" "libraries/02_解决方案_solution/政策文件库" "libraries/02_解决方案_solution/行业趋势库" "libraries/02_解决方案_solution/_模板/解决方案模板"
  "libraries/04_法务_legal/_模板/合同模板/销售合同" "libraries/04_法务_legal/_模板/合同模板/工程合同" "libraries/04_法务_legal/_模板/合同模板/其他"
  "libraries/01_销售_sales/产品库/_待入库" "libraries/01_销售_sales/产品库/图片库" "libraries/01_销售_sales/_模板/报价模板" "libraries/08_财务_finance"
)
for b in "${BUCKETS[@]}"; do
  mkdir -p "$DST/$b"
  touch "$DST/$b/.gitkeep"
done
[ -f "$SRC/input/README.md" ] && cp "$SRC/input/README.md" "$DST/input/README.md"

# 清理系统垃圾文件
find "$DST" -name ".DS_Store" -delete

# 产品库是运行数据，只保留空目录占位；即使以后上方同步逻辑调整，也不能进入安装模板。
find "$DST/libraries/01_销售_sales/产品库" -type f ! -name ".gitkeep" -delete

echo "模板已生成: $DST"
du -sh "$DST"
