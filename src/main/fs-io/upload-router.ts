import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
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

// ============ 运营（公众号配图）专属 ============
// 痛点：手机/微信图是哈希名，谁也看不出内容，分身配图文全靠猜 → 图文不符。
// 解法：①按主题落 inbox/05_运营_operation/{主题}/ 并顺序重命名 {主题}_序号.ext（分组+编号）；
//       ②「AI 识别配图」让分身逐张看图写 _配图识别.json，App 据此把文件重命名成
//         {主题}_序号_{内容描述}.ext 并生成 配图清单.md，从此文件名自带内容、配文不再张冠李戴。

const OP_IMG_EXT = /\.(jpg|jpeg|png|gif|webp|heic)$/i
function sanitizeSeg(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|\n\r\t]/g, '').replace(/\s+/g, '').trim()
}

/** 运营专属：公众号素材按主题落 inbox/05_运营_operation/{主题}/；图片顺序重命名 {主题}_序号.ext */
export function uploadToOperationTheme(
  dataDir: string,
  theme: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const t = sanitizeSeg(theme).slice(0, 40) || todayStr()
  const destDir = join(dataDir, 'inbox', '05_运营_operation', t)
  mkdirSync(destDir, { recursive: true })
  const ext = extname(sourcePath).toLowerCase()
  let fileName: string
  if (OP_IMG_EXT.test(ext)) {
    const n = readdirSync(destDir).filter((f) => OP_IMG_EXT.test(f)).length
    fileName = `${t}_${String(n + 1).padStart(2, '0')}${ext}`
  } else {
    fileName = basename(sourcePath)
  }
  const dest = uniqueDestPath(destDir, fileName)
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/05_运营_operation/${t}/${basename(dest)}` }
}

/**
 * 运营专属：读 {主题}/_配图识别.json（分身逐张看图后写的 [{文件名,描述,图注}]），
 * 把每张图重命名成 {主题}_序号_{描述}.ext，并生成 配图清单.md 供写文章时对号入座。
 */
export function applyOperationImageNames(
  dataDir: string,
  theme: string
): { renamed: number; listRelative: string; total: number } {
  const t = sanitizeSeg(theme).slice(0, 40)
  const dir = join(dataDir, 'inbox', '05_运营_operation', t)
  const jsonPath = join(dir, '_配图识别.json')
  if (!existsSync(jsonPath)) {
    throw new Error('还没有识别结果——请先点「🔍 AI 识别配图」让分身逐张看图并写出 _配图识别.json')
  }
  let list: { 文件名?: string; 描述?: string; 图注?: string }[]
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    list = Array.isArray(raw) ? raw : Array.isArray(raw?.images) ? raw.images : []
  } catch {
    throw new Error('_配图识别.json 不是合法 JSON，请让分身重写')
  }
  const rows = ['| 文件 | 画面内容 | 建议图注 |', '|---|---|---|']
  let renamed = 0
  let seq = 0
  for (const item of list) {
    const name = item.文件名 || ''
    if (!name || !OP_IMG_EXT.test(name)) continue
    const cur = join(dir, name)
    if (!existsSync(cur)) continue
    seq++
    const ext = extname(name).toLowerCase()
    const desc = sanitizeSeg(item.描述 || '').slice(0, 12)
    const newName = `${t}_${String(seq).padStart(2, '0')}${desc ? '_' + desc : ''}${ext}`
    let finalName = name
    if (newName !== name) {
      const target = uniqueDestPath(dir, newName)
      renameSync(cur, target)
      finalName = basename(target)
      renamed++
    }
    rows.push(`| ${finalName} | ${(item.描述 || '').replace(/\|/g, '，')} | ${(item.图注 || '').replace(/\|/g, '，')} |`)
  }
  const listPath = join(dir, '配图清单.md')
  writeFileSync(
    listPath,
    `# ${t} · 配图清单\n\n> App 按分身识别结果重命名并生成。写文章时据此选图配文，插入前仍需 Read 复核画面。\n\n${rows.join('\n')}\n`,
    'utf-8'
  )
  return { renamed, listRelative: `inbox/05_运营_operation/${t}/配图清单.md`, total: seq }
}

/** 销售专属：报价文件模板落 销售/_模板/报价模板/ */
export function uploadToSalesTemplate(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, '销售', '_模板', '报价模板')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `销售/_模板/报价模板/${basename(dest)}` }
}

// ============ 运营（风格模板 + 最近文章）============

const OPERATION_TEMPLATE_REL = join('inbox', '05_运营_operation', '_风格模板')
const TEMPLATE_DOC_EXTS = ['html', 'htm', 'md']
const TEMPLATE_IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp']

export interface OperationTemplateEntry {
  fileName: string
  relativePath: string
  /** 模板=html/md 文档；图片=风格参考图 */
  kind: '模板' | '图片'
  mtime: number
}

/** 运营专属：风格模板（html/md）与模板参考图上传到 inbox/05_运营_operation/_风格模板/ */
export function uploadOperationTemplate(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, OPERATION_TEMPLATE_REL)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/05_运营_operation/_风格模板/${basename(dest)}` }
}

export function listOperationTemplates(dataDir: string): OperationTemplateEntry[] {
  const dir = join(dataDir, OPERATION_TEMPLATE_REL)
  if (!existsSync(dir)) return []
  const out: OperationTemplateEntry[] = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const kind = TEMPLATE_DOC_EXTS.includes(ext) ? '模板' : TEMPLATE_IMG_EXTS.includes(ext) ? '图片' : null
    if (!kind) continue
    out.push({
      fileName: name,
      relativePath: `inbox/05_运营_operation/_风格模板/${name}`,
      kind,
      mtime: statSync(join(dir, name)).mtimeMs
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export interface RecentArticleEntry {
  fileName: string
  /** 相对数据目录 */
  relativePath: string
  absPath: string
  /** 所在项目/主题子文件夹名（直接放根目录的为空串） */
  folder: string
  mtime: number
}

/** 运营专属：outputs/05_运营_operation 下最近生成的推广文章（.md/.html，按修改时间倒序取前 N 条） */
export function listRecentOperationArticles(dataDir: string, limit = 10): RecentArticleEntry[] {
  const root = join(dataDir, 'outputs', '05_运营_operation')
  if (!existsSync(root)) return []
  const out: RecentArticleEntry[] = []
  const walk = (dir: string, rel: string, depth: number): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        if (depth < 3) walk(abs, rel ? `${rel}/${name}` : name, depth + 1)
        continue
      }
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (ext !== 'md' && ext !== 'html') continue
      // 排版产物（_公众号排版.html）也算"生成记录"，一并列出便于直接打开复制
      out.push({
        fileName: name,
        relativePath: `outputs/05_运营_operation${rel ? '/' + rel : ''}/${name}`,
        absPath: abs,
        folder: rel,
        mtime: st.mtimeMs
      })
    }
  }
  walk(root, '', 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

// ── MBA 学习分身：按课程归档（inbox/10_MBA学习_mba/{课程}/{分类}/）────────────
/** 课程三类 + 论文材料分类（开题与选题/文献/数据与案例/导师沟通），统一走本通道 */
export type MbaUploadCategory = string

export function uploadToMbaCourse(
  dataDir: string,
  course: string,
  category: MbaUploadCategory,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const c = sanitizeSeg(course).slice(0, 40) || '未分类课程'
  const cat = sanitizeSeg(category).slice(0, 20) || '未分类'
  const rel = join('inbox', '10_MBA学习_mba', c, cat)
  const destDir = join(dataDir, rel)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: join(rel, basename(sourcePath)) }
}

export interface MbaCourseInfo {
  name: string
  课件数: number
  作业数: number
  录音数: number
}

export function listMbaCourses(dataDir: string): MbaCourseInfo[] {
  const root = join(dataDir, 'inbox', '10_MBA学习_mba')
  if (!existsSync(root)) return []
  const count = (p: string): number => {
    try {
      return readdirSync(p).filter((n) => !n.startsWith('.')).length
    } catch {
      return 0
    }
  }
  return readdirSync(root)
    .filter((n) => {
      try {
        return !n.startsWith('.') && !n.startsWith('_') && statSync(join(root, n)).isDirectory()
      } catch {
        return false
      }
    })
    .map((name) => {
      // 直接丢在课程根目录的散文件（历史习惯）计入课件数，别让用户以为文件丢了
      let loose = 0
      try {
        loose = readdirSync(join(root, name)).filter((n) => {
          try {
            return !n.startsWith('.') && statSync(join(root, name, n)).isFile()
          } catch {
            return false
          }
        }).length
      } catch {
        // 忽略
      }
      return {
        name,
        课件数: count(join(root, name, '课件')) + loose,
        作业数: count(join(root, name, '作业与要求')),
        录音数: count(join(root, name, '课堂录音'))
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}
