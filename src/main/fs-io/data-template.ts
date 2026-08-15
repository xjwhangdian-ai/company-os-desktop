import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// ============ 数据目录骨架 ============
// 「初始化目录」把安装包内置模板（.claude/CLAUDE.md/knowledge/tools）拷过去之后，
// 由这里补齐全部空目录骨架——打包器会过滤 .gitkeep 隐藏文件导致空目录进不了安装包，
// 所以骨架不依赖模板本身，代码建目录最稳。

const LEGACY_INPUT_DIR = 'inbox'
const INPUT_DIR = 'input'

function migrateLegacyInputDir(dataDir: string): void {
  const legacyDir = join(dataDir, LEGACY_INPUT_DIR)
  const inputDir = join(dataDir, INPUT_DIR)
  if (existsSync(legacyDir) && !existsSync(inputDir)) renameSync(legacyDir, inputDir)
}

const SKELETON_DIRS = [
  'input/01_销售_sales/供应商资料',
  'input/02_解决方案_solution/需求文件',
  'input/03_招投标_bidding',
  'input/04_法务_legal',
  'input/05_运营_operation',
  'input/06_品牌_brand',
  'input/07_行政人力_ops-policy',
  'input/08_财务_finance/票据',
  'input/09_情报_intel',
  'input/10_MBA学习_mba',
  'outputs/01_销售_sales',
  'outputs/02_解决方案_solution',
  'outputs/03_招投标_bidding',
  'outputs/04_法务_legal',
  'outputs/05_运营_operation',
  'outputs/06_品牌_brand',
  'outputs/07_行政人力_ops-policy/01_未审核',
  'outputs/07_行政人力_ops-policy/02_初审',
  'outputs/07_行政人力_ops-policy/03_终审',
  'outputs/07_行政人力_ops-policy/04_定稿',
  'outputs/08_财务_finance',
  'outputs/09_情报_intel',
  'outputs/10_MBA学习_mba',
  'bidding/_素材库/产品资料',
  'bidding/_素材库/产品检测报告',
  'bidding/_素材库/产品解决方案',
  'bidding/_素材库/人员资质',
  'bidding/_素材库/类似项目合同',
  'bidding/_模板',
  '解决方案/基础产品库',
  '解决方案/基础解决方案库',
  '解决方案/政策文件库',
  '解决方案/行业趋势库',
  '解决方案/_模板/解决方案模板',
  '法务/_模板/合同模板/销售合同',
  '法务/_模板/合同模板/工程合同',
  '法务/_模板/合同模板/其他',
  '销售/产品库/_待入库',
  '销售/产品库/图片库',
  '销售/_模板/报价模板',
  '财务'
]

export function ensureCompanySkeleton(dataDir: string): void {
  migrateLegacyInputDir(dataDir)
  for (const rel of SKELETON_DIRS) {
    mkdirSync(join(dataDir, rel), { recursive: true })
  }
}
