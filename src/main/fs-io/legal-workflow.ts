import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractCategory, ContractTemplate, LegalDoc } from '@shared/agent-types'
import { CONTRACT_CATEGORIES } from '@shared/agent-types'

// ============ 法务工作流（统一 inbox/outputs 约定）============
//   待审队列：inbox/04_法务_legal/【类型】合同文件（平铺，一合同一文件）
//   已处理：  inbox/04_法务_legal/已处理/（"标记已审"把原文件移进来）
//   审核产出：outputs/04_法务_legal/{日期_合同名}/（意见书等，分身按项目文件夹写入）
//   合同模板：法务/_模板/合同模板/{类型}/（跨项目库，不动）

const PENDING_DIR_REL = join('inbox', '04_法务_legal')
const DONE_DIR_REL = join('inbox', '04_法务_legal', '已处理')

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
  const pending = listDocsIn(join(dataDir, PENDING_DIR_REL), 'pending')
  const reviewed = listDocsIn(join(dataDir, DONE_DIR_REL), 'reviewed')
  return { pending, reviewed }
}

/** 手动状态转移：待审 → 已处理/，纯文件系统 mv，不经过 Agent 工具调用 */
export function markReviewed(dataDir: string, fileName: string): void {
  const from = join(dataDir, PENDING_DIR_REL, fileName)
  const toDir = join(dataDir, DONE_DIR_REL)
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
