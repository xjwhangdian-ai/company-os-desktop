import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AgentName, BiddingUploadResult } from '@shared/agent-types'
import { AGENT_OUTPUT_FOLDER } from './outputs-scanner'
import { extractCompanion } from './doc-extract'

// ============ 统一约定（v3）============
// 专属工作流的"输入"统一进 inbox/{编号_分身}/，"产出"统一进 outputs/{编号_分身}/{项目}/：
//   招投标：inbox/03_招投标_bidding/{日期_项目}/（招标原件） ⇄ outputs/03_招投标_bidding/{日期_项目}/（解析/质疑/投标）
//   法务：  inbox/04_法务_legal/【类型】合同（处理完移 已处理/） → 意见书进 outputs/04_法务_legal/{日期_合同}/
//   销售：  inbox/01_销售_sales/供应商资料/ → 报价进 outputs/01_销售_sales/{日期_客户_报价}/
//   方案：  inbox/02_解决方案_solution/需求文件/ → 方案进 outputs/02_解决方案_solution/{日期_项目}/
// 跨项目复用的"库"不属于输入也不属于产出，留在各工作区：bidding/_素材库、销售/产品库+图片库+模板、
// 解决方案/基础产品库+基础解决方案库+模板、法务/_模板。

function uniqueDestPath(destDir: string, fileName: string): string {
  mkdirSync(destDir, { recursive: true })
  let dest = join(destDir, fileName)
  if (!existsSync(dest)) return dest
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let i = 1
  while (existsSync(dest)) {
    dest = join(destDir, `${stem}_${i}${ext}`)
    i++
  }
  return dest
}

/**
 * 通用聊天上传：按分身落到 inbox/{编号_分身}/ 子文件夹（与 outputs/ 的分身文件夹同名镜像），
 * 避免所有分身的上传混在一个平铺 inbox 里。返回相对数据目录的路径供拼进聊天 prompt。
 */
export function uploadToInbox(
  dataDir: string,
  agentName: AgentName,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const folder = AGENT_OUTPUT_FOLDER[agentName]
  const destDir = join(dataDir, 'inbox', folder)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/${folder}/${basename(dest)}` }
}

function todayStr(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 从招标文件名派生项目文件夹名：日期_清理后的文件名主干（App 机械决定，不靠 AI 起名） */
function deriveBiddingFolder(sourcePath: string): string {
  const stem = basename(sourcePath, extname(sourcePath))
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 60)
  return `${todayStr()}_${stem || '未命名项目'}`
}

/** 项目内分桶（参考"投标项目管理"系统的分类结构，按输入/产出拆到 inbox/outputs 两侧） */
export const BIDDING_INBOX_BUCKETS = ['01_招标文件', '02_答疑澄清', '03_供应商信息', '04_资质材料', '99_往来沟通'] as const
export const BIDDING_OUTPUT_BUCKETS = ['01_招标解析', '02_报价文件', '03_技术方案', '04_投标文件成稿', '05_合同与履约'] as const

/** 新建/补齐项目的两侧分桶骨架（人往里放文件不用自己记该建哪些文件夹） */
export function ensureBiddingProjectSkeleton(dataDir: string, projectFolder: string): void {
  for (const bucket of BIDDING_INBOX_BUCKETS) {
    mkdirSync(join(dataDir, 'inbox', '03_招投标_bidding', projectFolder, bucket), { recursive: true })
  }
  for (const bucket of BIDDING_OUTPUT_BUCKETS) {
    mkdirSync(join(dataDir, 'outputs', '03_招投标_bidding', projectFolder, bucket), { recursive: true })
  }
}

/**
 * bidding 专属：招标原文件落 inbox/03_招投标_bidding/{日期_项目}/01_招标文件/，
 * 并同时建好两侧完整分桶骨架（两侧同名配对）。
 * 同一天重复上传同名文件会进同一个项目文件夹（追加而不是另开项目）。
 */
export function uploadToBiddingProject(dataDir: string, sourcePath: string): BiddingUploadResult {
  const projectFolder = deriveBiddingFolder(sourcePath)
  ensureBiddingProjectSkeleton(dataDir, projectFolder)
  const destDir = join(dataDir, 'inbox', '03_招投标_bidding', projectFolder, '01_招标文件')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return {
    absPath: dest,
    relativePath: `inbox/03_招投标_bidding/${projectFolder}/01_招标文件/${basename(dest)}`,
    projectFolder,
    outputsDirRelative: `outputs/03_招投标_bidding/${projectFolder}`
  }
}

/** bidding 专属：人工下载的招标文件导入既有项目 inbox 侧的 01_招标文件/（网站需登录验证，自动下载已改人工） */
export function uploadToBiddingTenderFile(
  dataDir: string,
  projectFolder: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'inbox', '03_招投标_bidding', projectFolder, '01_招标文件')
  mkdirSync(destDir, { recursive: true })
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/03_招投标_bidding/${projectFolder}/01_招标文件/${basename(dest)}` }
}

/** bidding 专属：答疑/澄清/变更公告落到项目 inbox 侧的 02_答疑澄清/ 分桶（追加解析时分身要读） */
export function uploadToBiddingClarification(
  dataDir: string,
  projectFolder: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'inbox', '03_招投标_bidding', projectFolder, '02_答疑澄清')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/03_招投标_bidding/${projectFolder}/02_答疑澄清/${basename(dest)}` }
}

/** bidding 专属：素材库 5 分类各自的上传入口 */
export function uploadToMaterialLibrary(
  dataDir: string,
  category: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'bidding', '_素材库', category)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `bidding/_素材库/${category}/${basename(dest)}` }
}

/**
 * 法务专属：待审合同落 inbox/04_法务_legal/（处理完由"标记已审"移进 已处理/ 子文件夹）。
 * 合同类型（销售合同/工程合同/其他）编码进文件名前缀【类型】——待审队列保持平铺，
 * 一份合同一个文件，"每合同再套一层文件夹"只添点击不添信息；产出侧（审核意见书）
 * 才按项目建文件夹（outputs/04_法务_legal/{日期_合同名}/）。
 */
export function uploadToLegalPending(
  dataDir: string,
  sourcePath: string,
  category: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'inbox', '04_法务_legal')
  const fileName = `【${category}】${basename(sourcePath)}`
  const dest = uniqueDestPath(destDir, fileName)
  copyFileSync(sourcePath, dest)
  // 生成伴生提取文本：分身审 docx/doc 时能读到全文，修订清单的"原文"引用才能逐字对上
  if (/\.(docx|doc)$/i.test(dest)) {
    void extractCompanion(dest).catch(() => null)
  }
  return { absPath: dest, relativePath: `inbox/04_法务_legal/${basename(dest)}` }
}

/** 法务专属：合同模板按类型存进 法务/_模板/合同模板/{category}/，供"与模板对比"功能匹配 */
export function uploadToLegalTemplate(
  dataDir: string,
  category: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, '法务', '_模板', '合同模板', category)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `法务/_模板/合同模板/${category}/${basename(dest)}` }
}

/** 销售专属：供应商产品资料/投标报价文件落 inbox/01_销售_sales/供应商资料/（喂产品库的原料，属输入侧） */
export function uploadToSalesRawDoc(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'inbox', '01_销售_sales', '供应商资料')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/01_销售_sales/供应商资料/${basename(dest)}` }
}

/** 销售专属：报价文件模板落 销售/_模板/报价模板/ */
export function uploadToSalesTemplate(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, '销售', '_模板', '报价模板')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `销售/_模板/报价模板/${basename(dest)}` }
}
