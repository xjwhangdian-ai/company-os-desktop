import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// ============ 数据目录骨架 ============
// 「初始化目录」把安装包内置模板（.claude/CLAUDE.md/knowledge/tools）拷过去之后，
// 由这里补齐全部空目录骨架——打包器会过滤 .gitkeep 隐藏文件导致空目录进不了安装包，
// 所以骨架不依赖模板本身，代码建目录最稳。

const LEGACY_INPUT_DIR = 'inbox'
const INPUT_DIR = 'input'
const LEGACY_GUIDE_DIR = '使用说明'
const GUIDE_DIR = 'docs/使用说明'

const LEGACY_LIBRARY_DIRS = [
  ['销售', 'libraries/01_销售_sales'],
  ['解决方案', 'libraries/02_解决方案_solution'],
  ['bidding', 'libraries/03_招投标_bidding'],
  ['法务', 'libraries/04_法务_legal'],
  ['财务', 'libraries/08_财务_finance']
] as const

function migrateLegacyInputDir(dataDir: string): void {
  const legacyDir = join(dataDir, LEGACY_INPUT_DIR)
  const inputDir = join(dataDir, INPUT_DIR)
  if (existsSync(legacyDir) && !existsSync(inputDir)) renameSync(legacyDir, inputDir)
}

/** v0.1.20 起将根目录的跨项目资料库集中到 libraries/；旧目录只在目标不存在时原子迁移。 */
function migrateLegacyLibraryDirs(dataDir: string): void {
  for (const [legacyRel, nextRel] of LEGACY_LIBRARY_DIRS) {
    const legacyDir = join(dataDir, legacyRel)
    const nextDir = join(dataDir, nextRel)
    if (!existsSync(legacyDir) || existsSync(nextDir)) continue
    mkdirSync(join(dataDir, 'libraries'), { recursive: true })
    renameSync(legacyDir, nextDir)
  }
}

function migrateLegacyGuideDir(dataDir: string): void {
  const legacyDir = join(dataDir, LEGACY_GUIDE_DIR)
  const nextDir = join(dataDir, GUIDE_DIR)
  if (!existsSync(legacyDir) || existsSync(nextDir)) return
  mkdirSync(join(dataDir, 'docs'), { recursive: true })
  renameSync(legacyDir, nextDir)
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
  'libraries/03_招投标_bidding/_素材库/产品资料',
  'libraries/03_招投标_bidding/_素材库/产品检测报告',
  'libraries/03_招投标_bidding/_素材库/产品解决方案',
  'libraries/03_招投标_bidding/_素材库/人员资质',
  'libraries/03_招投标_bidding/_素材库/类似项目合同',
  'libraries/03_招投标_bidding/_模板',
  'libraries/02_解决方案_solution/基础产品库',
  'libraries/02_解决方案_solution/基础解决方案库',
  'libraries/02_解决方案_solution/政策文件库',
  'libraries/02_解决方案_solution/行业趋势库',
  'libraries/02_解决方案_solution/_模板/解决方案模板',
  'libraries/04_法务_legal/_模板/合同模板/销售合同',
  'libraries/04_法务_legal/_模板/合同模板/工程合同',
  'libraries/04_法务_legal/_模板/合同模板/其他',
  'libraries/01_销售_sales/产品库/_待入库',
  'libraries/01_销售_sales/产品库/图片库',
  'libraries/01_销售_sales/_模板/报价模板',
  'libraries/08_财务_finance'
]

export function ensureCompanySkeleton(dataDir: string): void {
  migrateLegacyInputDir(dataDir)
  migrateLegacyLibraryDirs(dataDir)
  migrateLegacyGuideDir(dataDir)
  for (const rel of SKELETON_DIRS) {
    mkdirSync(join(dataDir, rel), { recursive: true })
  }
}
