import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { OpsDocState, OpsPolicyDoc, OutputEntry } from '@shared/agent-types'
import { OPS_DOC_STATES } from '@shared/agent-types'

// ============ 行政人力工作台：制度文件四状态流转 + 治理文件（章程等）直达 ============
// 制度/SOP 走「未审核 → 初审 → 终审 → 定稿」四个状态，对应 outputs/07_行政人力_ops-policy/ 下
// 四个状态文件夹；改状态 = App 把文件移进对应文件夹（机械移动，不经过 AI）。
// 公司章程等治理文件由 legal 分身产出在 outputs/04_法务_legal/，这里扫描出来给一键打开的直达链接。

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

/** 列出四个状态文件夹里的制度文件 */
export function listPolicyDocs(dataDir: string): OpsPolicyDoc[] {
  ensureOpsStateDirs(dataDir)
  const docs: OpsPolicyDoc[] = []
  for (const state of OPS_DOC_STATES) {
    const dir = join(dataDir, OPS_ROOT_REL, STATE_DIR[state])
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
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

/** 改状态 = 把文件移进目标状态文件夹（重名自动加序号） */
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

/** 公司章程等治理文件直达：扫 outputs/04_法务_legal/ 里文件名含「章程/代持/股权」的文件 */
export function listGovernanceDocs(dataDir: string): OutputEntry[] {
  const root = join(dataDir, 'outputs', '04_法务_legal')
  const out: OutputEntry[] = []
  const walk = (dir: string): void => {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!/章程|代持|股权/.test(name)) continue
      out.push({
        name,
        path: full,
        relativePath: full.slice(dataDir.length + 1).replace(/\\/g, '/'),
        isDirectory: false,
        size: st.size,
        mtimeMs: st.mtimeMs
      })
    }
  }
  walk(root)
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
