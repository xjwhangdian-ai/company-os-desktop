import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractCategory, ContractTemplate, LegalDoc } from '@shared/agent-types'
import { CONTRACT_CATEGORIES } from '@shared/agent-types'
import { generateContractRedline, type RedlineItem, type RedlineResult } from '../docgen/contract-redline'

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

/** 合同文件名去前缀去扩展名，与意见书产出文件夹的命名规则一致 */
function contractStem(fileName: string): string {
  return fileName
    .replace(/^【.+?】/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '')
    .slice(0, 50)
}

/**
 * 生成修订版合同：找该合同最新的审核产出文件夹里的 修订清单.json（分身审核时同步产出），
 * 把每条修订以 Word「修订模式」写回原合同，产出 {stem}_修订版.docx 放同一产出文件夹。
 */
export async function generateLegalRedline(dataDir: string, fileName: string): Promise<RedlineResult> {
  const original = join(dataDir, PENDING_DIR_REL, fileName)
  const stem = contractStem(fileName)
  const outRoot = join(dataDir, 'outputs', '04_法务_legal')

  // 找最新的、文件夹名含合同名主干、且里面有修订清单的产出文件夹
  let listPath: string | null = null
  let projDir: string | null = null
  if (existsSync(outRoot)) {
    const dirs = readdirSync(outRoot)
      .filter((n) => !n.startsWith('.') && n.includes(stem.slice(0, 20)) && statSync(join(outRoot, n)).isDirectory())
      .sort()
      .reverse()
    for (const d of dirs) {
      const p = join(outRoot, d, '修订清单.json')
      if (existsSync(p)) {
        listPath = p
        projDir = join(outRoot, d)
        break
      }
    }
  }
  if (!listPath || !projDir) {
    return {
      ok: false,
      applied: 0,
      missed: [],
      说明: '还没有这份合同的修订清单——先点「审核」让法务分身出意见书（会同步产出 修订清单.json），再来生成修订版'
    }
  }

  let items: RedlineItem[] = []
  try {
    const raw = JSON.parse(readFileSync(listPath, 'utf-8'))
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.修订) ? raw.修订 : []
    items = arr
      .map((it: Record<string, unknown>) => ({
        原文: String(it?.原文 ?? ''),
        修改为: String(it?.修改为 ?? ''),
        理由: String(it?.理由 ?? '')
      }))
      .filter((it: RedlineItem) => it.原文.trim().length > 0)
  } catch {
    return { ok: false, applied: 0, missed: [], 说明: '修订清单.json 解析失败——让分身重新生成一次' }
  }
  if (items.length === 0) return { ok: false, applied: 0, missed: [], 说明: '修订清单是空的——分身没有给出可落地的条款修改' }

  const outPath = join(projDir, `${stem}_修订版.docx`)
  return generateContractRedline(original, items, outPath)
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
