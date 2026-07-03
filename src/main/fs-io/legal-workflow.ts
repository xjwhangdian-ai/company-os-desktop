import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractCategory, ContractTemplate, LegalDoc } from '@shared/agent-types'
import { CONTRACT_CATEGORIES } from '@shared/agent-types'

const IGNORE_NAMES = new Set(['.DS_Store', 'README.md'])

/** 文件名前缀【销售合同】xxx.pdf 解析出分类；没有前缀（比如历史遗留文件）一律算"其他" */
function parseCategory(fileName: string): ContractCategory {
  const m = /^【(.+?)】/.exec(fileName)
  const tag = m?.[1]
  return (CONTRACT_CATEGORIES as string[]).includes(tag ?? '') ? (tag as ContractCategory) : '其他'
}

function listDocsIn(dir: string, status: LegalDoc['status']): LegalDoc[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => !IGNORE_NAMES.has(n) && !n.startsWith('.'))
    .map((fileName) => {
      const full = join(dir, fileName)
      const st = statSync(full)
      return { fileName, path: full, status, mtimeMs: st.mtimeMs, category: parseCategory(fileName) }
    })
    .filter((d) => statSync(d.path).isFile())
}

export function listLegalDocs(dataDir: string): { pending: LegalDoc[]; reviewed: LegalDoc[] } {
  const pending = listDocsIn(join(dataDir, '法务', '待审'), 'pending')
  const reviewed = listDocsIn(join(dataDir, '法务', '已审'), 'reviewed')
  return { pending, reviewed }
}

/** 手动状态转移：待审→已审，纯文件系统 mv，不经过 Agent 工具调用 */
export function markReviewed(dataDir: string, fileName: string): void {
  const from = join(dataDir, '法务', '待审', fileName)
  const toDir = join(dataDir, '法务', '已审')
  mkdirSync(toDir, { recursive: true })
  let to = join(toDir, fileName)
  if (existsSync(to)) {
    const dot = fileName.lastIndexOf('.')
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName
    const ext = dot > 0 ? fileName.slice(dot) : ''
    to = join(toDir, `${stem}_${Date.now()}${ext}`)
  }
  renameSync(from, to)
}

export function listLegalTemplates(dataDir: string): ContractTemplate[] {
  const root = join(dataDir, '法务', '_模板', '合同模板')
  const templates: ContractTemplate[] = []
  for (const category of CONTRACT_CATEGORIES) {
    const dir = join(root, category)
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const fileName of names) {
      if (IGNORE_NAMES.has(fileName) || fileName.startsWith('.')) continue
      const full = join(dir, fileName)
      if (statSync(full).isFile()) templates.push({ fileName, path: full, category })
    }
  }
  return templates
}
