import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BiddingProject, MaterialLibraryCounts, OutputEntry } from '@shared/agent-types'

// ============ 招投标项目 = inbox/outputs 两侧同名文件夹配对 ============
//   inbox/03_招投标_bidding/{YYYY-MM-DD_项目}/    ← 招标原件（App 上传时机械建夹）
//   outputs/03_招投标_bidding/{YYYY-MM-DD_项目}/  ← 解析报告/质疑函/投标文件（分身写入）
// 跨项目共享的素材库仍在 bidding/_素材库/（它是库，不是某个项目的输入或产出）。

const INBOX_ROOT_REL = join('inbox', '03_招投标_bidding')
const OUTPUTS_ROOT_REL = join('outputs', '03_招投标_bidding')
const PROJECT_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_.+/

const MATERIAL_CATEGORIES: Array<keyof MaterialLibraryCounts> = [
  '产品资料',
  '产品检测报告',
  '产品解决方案',
  '人员资质',
  '类似项目合同'
]

/** 递归列出目录下全部文件，relativePath 相对数据目录（inbox/... 或 outputs/... 开头，UI 靠它区分来源侧） */
function listFilesRecursive(dataDir: string, dir: string): OutputEntry[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const entries: OutputEntry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    const isDirectory = st.isDirectory()
    entries.push({
      name,
      path: full,
      relativePath: relative(dataDir, full),
      isDirectory,
      size: st.size,
      mtimeMs: st.mtimeMs,
      children: isDirectory ? listFilesRecursive(dataDir, full) : undefined
    })
  }
  entries.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  return entries
}

function listProjectFolders(root: string): string[] {
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  return names.filter((n) => {
    if (!PROJECT_FOLDER_PATTERN.test(n)) return false
    try {
      return statSync(join(root, n)).isDirectory()
    } catch {
      return false
    }
  })
}

function countFilesRecursive(dir: string): number {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let count = 0
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) count += countFilesRecursive(full)
    else count += 1
  }
  return count
}

/** 扫描 inbox/outputs 两侧的项目文件夹并按同名配对，供项目列表页展示进度徽章 */
export function listBiddingProjects(dataDir: string): BiddingProject[] {
  const inboxRoot = join(dataDir, INBOX_ROOT_REL)
  const outputsRoot = join(dataDir, OUTPUTS_ROOT_REL)
  const inboxFolders = new Set(listProjectFolders(inboxRoot))
  const outputsFolders = new Set(listProjectFolders(outputsRoot))
  const all = new Set([...inboxFolders, ...outputsFolders])

  const projects: BiddingProject[] = []
  for (const folderName of all) {
    const inboxPath = inboxFolders.has(folderName) ? join(inboxRoot, folderName) : undefined
    const outputsPath = outputsFolders.has(folderName) ? join(outputsRoot, folderName) : undefined
    const files = [
      ...(inboxPath ? listFilesRecursive(dataDir, inboxPath) : []),
      ...(outputsPath ? listFilesRecursive(dataDir, outputsPath) : [])
    ]
    const flat = (entries: OutputEntry[]): OutputEntry[] =>
      entries.flatMap((e) => (e.isDirectory ? flat(e.children ?? []) : [e]))
    const fileNames = flat(files).map((f) => f.name)

    projects.push({
      folderName,
      projectName: folderName.slice(11),
      date: folderName.slice(0, 10),
      inboxPath,
      outputsPath,
      hasSourceFile: inboxPath !== undefined && flat(listFilesRecursive(dataDir, inboxPath)).length > 0,
      hasParseReport: fileNames.some((f) => f.includes('招标解析')),
      hasChallengeLetter: fileNames.some((f) => f.includes('质疑函')),
      hasDraft: fileNames.some(
        (f) => f.includes('投标文件') || f.includes('资格证明文件') || f.includes('商务技术文件') || f.includes('报价文件')
      ),
      files
    })
  }

  projects.sort((a, b) => (a.date < b.date ? 1 : -1))
  return projects
}

/** 素材库五分类的文件数量粗判——只做数量统计，不做语义匹配（精确判断留给分身在生成时做） */
export function getMaterialLibraryCounts(dataDir: string): MaterialLibraryCounts {
  const libRoot = join(dataDir, 'bidding', '_素材库')
  const counts = {} as MaterialLibraryCounts
  for (const category of MATERIAL_CATEGORIES) {
    counts[category] = countFilesRecursive(join(libRoot, category))
  }
  return counts
}
