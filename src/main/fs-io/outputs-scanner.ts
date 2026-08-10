import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { AgentName, OutputEntry } from '@shared/agent-types'

/** 分身 → 编号文件夹名的唯一映射，outputs/ 与 inbox/ 共用同一套，保证两边结构互为镜像 */
export const AGENT_OUTPUT_FOLDER: Record<AgentName, string> = {
  sales: '01_销售_sales',
  solution: '02_解决方案_solution',
  bidding: '03_招投标_bidding',
  legal: '04_法务_legal',
  'admin-legal': '07_行政人力_ops-policy',
  operation: '05_运营_operation',
  brand: '06_品牌_brand',
  'ops-policy': '07_行政人力_ops-policy',
  finance: '08_财务_finance',
  intel: '09_情报_intel',
  mba: '10_MBA学习_mba'
}

const IGNORE_NAMES = new Set(['.DS_Store', 'README.md'])

function scanDir(root: string, dir: string, depth: number): OutputEntry[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const entries: OutputEntry[] = []
  for (const name of names) {
    if (IGNORE_NAMES.has(name) || name.startsWith('.')) continue
    const full = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    const isDirectory = st.isDirectory()
    entries.push({
      name,
      path: full,
      relativePath: relative(root, full),
      isDirectory,
      size: st.size,
      mtimeMs: st.mtimeMs,
      children: isDirectory && depth > 0 ? scanDir(root, full, depth - 1) : undefined
    })
  }
  // 目录在前，其次按修改时间倒序（最新的项目/产出排前面）
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return b.mtimeMs - a.mtimeMs
  })
  return entries
}

/** 供下载面板用：按分身扫描 outputs/{分身文件夹}/ 下的项目子文件夹与文件 */
export function scanAgentOutputs(dataDir: string, agentName: AgentName): OutputEntry[] {
  const folder = AGENT_OUTPUT_FOLDER[agentName]
  const root = join(dataDir, 'outputs', folder)
  return scanDir(root, root, 3)
}

export function getAgentOutputFolderPath(dataDir: string, agentName: AgentName): string {
  return join(dataDir, 'outputs', AGENT_OUTPUT_FOLDER[agentName])
}
