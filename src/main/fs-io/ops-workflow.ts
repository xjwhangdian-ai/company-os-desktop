import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import mammoth from 'mammoth'
import type { OpsDocState, OpsGovernanceDoc, OpsPolicyDoc } from '@shared/agent-types'
import { OPS_DOC_STATES } from '@shared/agent-types'
import { exportMarkdownToDocx } from '../docgen/docx-export'

// ============ 行政人力工作台：制度文件四状态流转 + 治理文件（章程等）直达 ============
// 制度/SOP 走「未审核 → 初审 → 终审 → 定稿」四个状态，对应 outputs/07_行政人力_ops-policy/ 下
// 四个状态文件夹；改状态 = App 把文件移进对应文件夹（机械移动，不经过 AI）。
// 公司章程等治理文件由 legal 分身产出在 outputs/04_法务_legal/，这里扫描出来给一键打开的直达链接。
//
// 文件形态约定（v0.1.6）：**看板只显示 .docx**——业务上大家改的是 Word：
//   · 分身起草的 md 在读取时自动转出同名 docx（md 是分身的工作格式，docx 是人的工作格式）；
//   · 人工改过 docx（mtime 比同名 md 新）→ 自动把 docx 文本回写同名 md，分身后续读到的是改过的版本；
//   · 状态流转时 docx 与同名 md 成对移动，永远呆在同一个状态文件夹。

const OPS_ROOT_REL = join('outputs', '07_行政人力_ops-policy')
const STATE_DIR: Record<OpsDocState, string> = {
  未审核: '01_未审核',
  初审: '02_初审',
  终审: '03_终审',
  定稿: '04_定稿'
}

export function ensureOpsStateDirs(dataDir: string): void {
  for (const dir of Object.values(STATE_DIR)) {
    mkdirSync(join(dataDir, OPS_ROOT_REL, dir), { recursive: true })
  }
}

/** docx 文本 → markdown（优先 mammoth 的 markdown 转换，失败退纯文本） */
async function docxToMarkdown(docxPath: string): Promise<string> {
  try {
    // mammoth 的 markdown 转换（保留标题/列表/加粗结构）
    const mm = mammoth as unknown as { convertToMarkdown?: (i: { path: string }) => Promise<{ value: string }> }
    if (mm.convertToMarkdown) {
      const r = await mm.convertToMarkdown({ path: docxPath })
      if (r.value.trim()) return r.value
    }
  } catch {
    // 走纯文本兜底
  }
  const raw = await mammoth.extractRawText({ path: docxPath })
  return raw.value
}

/** 同名配对：docx 与 md 双向同步（只显示 docx，md 是分身的工作副本） */
async function syncPairsInDir(dir: string): Promise<void> {
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => !n.startsWith('.'))
  } catch {
    return
  }
  const stems = (ext: string): Map<string, string> => {
    const m = new Map<string, string>()
    for (const n of names) if (n.toLowerCase().endsWith(ext)) m.set(n.slice(0, -ext.length), n)
    return m
  }
  const mds = stems('.md')
  const docxs = stems('.docx')

  // ① 孤 md（分身刚起草）→ 自动转出同名 docx
  for (const [stem, mdName] of mds) {
    if (docxs.has(stem)) continue
    const mdPath = join(dir, mdName)
    const docxPath = join(dir, `${stem}.docx`)
    try {
      await exportMarkdownToDocx(readFileSync(mdPath, 'utf-8'), docxPath)
      docxs.set(stem, `${stem}.docx`)
    } catch {
      // 单个转换失败不影响其他文件
    }
  }

  // ② docx 比同名 md 新（人工在 Word 里改过）→ 回写 md；孤 docx（人工直接上传）→ 生成 md
  for (const [stem, docxName] of docxs) {
    const docxPath = join(dir, docxName)
    const mdPath = join(dir, `${stem}.md`)
    try {
      const docxM = statSync(docxPath).mtimeMs
      const mdM = existsSync(mdPath) ? statSync(mdPath).mtimeMs : 0
      // 2 秒容差：刚由 md 转出的 docx 不算"人工改过"
      if (docxM - mdM <= 2000) continue
      const markdown = await docxToMarkdown(docxPath)
      writeFileSync(
        mdPath,
        `<!-- 本文件由 ${docxName} 自动同步（Word 是主文件，请直接改 Word；此 md 供分身读取） -->\n\n${markdown.trim()}\n`,
        'utf-8'
      )
    } catch {
      // 同步失败保留旧 md
    }
  }
}

/** 列出四个状态文件夹里的制度文件——只列 .docx（md 自动配对/同步，见文件头说明） */
export async function listPolicyDocs(dataDir: string): Promise<OpsPolicyDoc[]> {
  ensureOpsStateDirs(dataDir)
  const docs: OpsPolicyDoc[] = []
  for (const state of OPS_DOC_STATES) {
    const dir = join(dataDir, OPS_ROOT_REL, STATE_DIR[state])
    await syncPairsInDir(dir)
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.') || !name.toLowerCase().endsWith('.docx')) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (!st.isFile()) continue
      docs.push({
        name,
        path: full,
        relativePath: `${OPS_ROOT_REL.replace(/\\/g, '/')}/${STATE_DIR[state]}/${name}`,
        state,
        size: st.size,
        mtimeMs: st.mtimeMs
      })
    }
  }
  return docs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 改状态 = 把文件移进目标状态文件夹（重名自动加序号）；同名 md 工作副本成对随行 */
export function setPolicyDocState(dataDir: string, relativePath: string, target: OpsDocState): OpsPolicyDoc {
  const rel = relativePath.replace(/\\/g, '/')
  const opsRoot = OPS_ROOT_REL.replace(/\\/g, '/')
  const inStateDir = Object.values(STATE_DIR).some((d) => rel.startsWith(`${opsRoot}/${d}/`))
  if (!inStateDir) throw new Error('只能流转状态文件夹里的制度文件')
  const src = join(dataDir, relativePath)
  if (!existsSync(src)) throw new Error('文件不存在（可能已被移动），请刷新')
  ensureOpsStateDirs(dataDir)
  const destDir = join(dataDir, OPS_ROOT_REL, STATE_DIR[target])
  const fileName = basename(src)
  let dest = join(destDir, fileName)
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let i = 1
  while (existsSync(dest) && dest !== src) {
    dest = join(destDir, `${stem}_${i}${ext}`)
    i += 1
  }
  renameSync(src, dest)
  // 同名 md 工作副本成对移动（目标名与主文件保持一致的加序号结果）
  const destStem = basename(dest).slice(0, basename(dest).lastIndexOf('.'))
  const srcMd = join(dataDir, rel.slice(0, rel.lastIndexOf('.')) + '.md')
  if (ext.toLowerCase() === '.docx' && existsSync(srcMd)) {
    try {
      renameSync(srcMd, join(destDir, `${destStem}.md`))
    } catch {
      // md 移动失败不阻塞主文件流转（下次列表会按 docx 重新同步生成）
    }
  }
  const st = statSync(dest)
  return {
    name: basename(dest),
    path: dest,
    relativePath: `${opsRoot}/${STATE_DIR[target]}/${basename(dest)}`,
    state: target,
    size: st.size,
    mtimeMs: st.mtimeMs
  }
}

// 治理文件的审核状态：文件本体在 legal 的项目目录里不能移动，状态记在这份 App 托管 JSON
const GOV_STATE_FILE = join(OPS_ROOT_REL, '治理文件审核状态.json')

function readGovStates(dataDir: string): Record<string, OpsDocState> {
  const p = join(dataDir, GOV_STATE_FILE)
  if (!existsSync(p)) return {}
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    const out: Record<string, OpsDocState> = {}
    for (const [k, v] of Object.entries(raw)) {
      if ((OPS_DOC_STATES as readonly string[]).includes(String(v))) out[k] = v as OpsDocState
    }
    return out
  } catch {
    return {}
  }
}

export function setGovernanceDocState(dataDir: string, relativePath: string, state: OpsDocState): void {
  ensureOpsStateDirs(dataDir)
  const states = readGovStates(dataDir)
  states[relativePath.replace(/\\/g, '/')] = state
  const p = join(dataDir, GOV_STATE_FILE)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(states, null, 2), 'utf-8')
  renameSync(tmp, p)
}

/**
 * 公司章程等治理文件直达：扫 outputs/04_法务_legal/ 里文件名含「章程/代持/股权」的文件，附审核状态（默认未审核）。
 * 同名 md+docx 配对时只显示 docx（Word 是给人看/改的版本）；孤 md 照常显示（别把仅有 md 的文件藏没了）。
 */
export function listGovernanceDocs(dataDir: string): OpsGovernanceDoc[] {
  const states = readGovStates(dataDir)
  const root = join(dataDir, 'outputs', '04_法务_legal')
  const out: OpsGovernanceDoc[] = []
  const walk = (dir: string): void => {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    const docxStems = new Set(
      names.filter((n) => n.toLowerCase().endsWith('.docx')).map((n) => n.slice(0, n.lastIndexOf('.')))
    )
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!/章程|代持|股权/.test(name)) continue
      // 有同名 docx 的 md 不重复显示
      if (name.toLowerCase().endsWith('.md') && docxStems.has(name.slice(0, name.lastIndexOf('.')))) continue
      const relativePath = full.slice(dataDir.length + 1).replace(/\\/g, '/')
      out.push({
        name,
        path: full,
        relativePath,
        state: states[relativePath] ?? '未审核',
        mtimeMs: st.mtimeMs
      })
    }
  }
  walk(root)
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
