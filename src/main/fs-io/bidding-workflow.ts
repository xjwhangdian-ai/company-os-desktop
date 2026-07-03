import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BiddingProject, MaterialLibraryCounts, OutputEntry } from '@shared/agent-types'

const PROJECT_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_.+/
const MATERIAL_CATEGORIES: Array<keyof MaterialLibraryCounts> = [
  '产品资料',
  '产品检测报告',
  '产品解决方案',
  '人员资质',
  '类似项目合同'
]

function listFilesRecursive(root: string, dir: string): OutputEntry[] {
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
      relativePath: relative(root, full),
      isDirectory,
      size: st.size,
      mtimeMs: st.mtimeMs,
      children: isDirectory ? listFilesRecursive(root, full) : undefined
    })
  }
  entries.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  return entries
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

/** 扫描 bidding/ 根目录下按项目建的文件夹，供项目列表页展示进度徽章 */
export function listBiddingProjects(dataDir: string): BiddingProject[] {
  const biddingRoot = join(dataDir, 'bidding')
  let names: string[] = []
  try {
    names = readdirSync(biddingRoot)
  } catch {
    return []
  }

  const projects: BiddingProject[] = []
  for (const name of names) {
    if (!PROJECT_FOLDER_PATTERN.test(name)) continue
    const full = join(biddingRoot, name)
    if (!statSync(full).isDirectory()) continue

    const files = listFilesRecursive(full, full)
    const fileNames = files.filter((f) => !f.isDirectory).map((f) => f.name)
    const date = name.slice(0, 10)
    const projectName = name.slice(11)

    projects.push({
      folderName: name,
      path: full,
      projectName,
      date,
      hasSourceFile: fileNames.some(
        (f) => !f.includes('招标解析') && !f.includes('质疑函') && !f.includes('投标文件')
      ),
      hasParseReport: fileNames.some((f) => f.includes('招标解析')),
      hasChallengeLetter: fileNames.some((f) => f.includes('质疑函')),
      hasDraft: fileNames.some((f) => f.includes('投标文件') || f.includes('资格证明文件') || f.includes('商务技术文件') || f.includes('报价文件')),
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
