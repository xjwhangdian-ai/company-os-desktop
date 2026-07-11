#!/bin/bash
# 从 ../company-os 快照生成安装包内置的数据目录模板（resources/company-os-template）。
# 排除：knowledge/internal 敏感内容（只留 README）、settings.local.json、一切运行数据（inbox/outputs/库文件）。
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

# 公众号排版引擎
mkdir -p "$DST/tools"
cp -R "$SRC/tools/gzh" "$DST/tools/gzh"

# 目录骨架（空桶 + .gitkeep）
BUCKETS=(
  "inbox/01_销售_sales/供应商资料" "inbox/02_解决方案_solution/需求文件" "inbox/03_招投标_bidding"
  "inbox/04_法务_legal" "inbox/05_运营_operation" "inbox/06_品牌_brand" "inbox/07_行政人力_ops-policy"
  "inbox/08_财务_finance/票据" "inbox/09_情报_intel"
  "outputs/01_销售_sales" "outputs/02_解决方案_solution" "outputs/03_招投标_bidding" "outputs/04_法务_legal"
  "outputs/05_运营_operation" "outputs/06_品牌_brand"
  "outputs/07_行政人力_ops-policy/01_未审核" "outputs/07_行政人力_ops-policy/02_初审"
  "outputs/07_行政人力_ops-policy/03_终审" "outputs/07_行政人力_ops-policy/04_定稿"
  "outputs/08_财务_finance" "outputs/09_情报_intel"
  "bidding/_素材库/产品资料" "bidding/_素材库/产品检测报告" "bidding/_素材库/产品解决方案"
  "bidding/_素材库/人员资质" "bidding/_素材库/类似项目合同" "bidding/_模板"
  "解决方案/基础产品库" "解决方案/基础解决方案库" "解决方案/政策文件库" "解决方案/行业趋势库" "解决方案/_模板/解决方案模板"
  "法务/_模板/合同模板/销售合同" "法务/_模板/合同模板/工程合同" "法务/_模板/合同模板/其他"
  "销售/产品库/_待入库" "销售/产品库/图片库" "销售/_模板/报价模板" "财务"
)
for b in "${BUCKETS[@]}"; do
  mkdir -p "$DST/$b"
  touch "$DST/$b/.gitkeep"
done

# 清理系统垃圾文件
find "$DST" -name ".DS_Store" -delete

echo "模板已生成: $DST"
du -sh "$DST"
