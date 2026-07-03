import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, sep } from 'node:path'

// 只给"分身真正生成的产出"盖操作人戳——outputs/、bidding/、法务/已审 是产出归档地，
// 法务/待审 是原始上传（人传的，不是分身生成的）不盖；knowledge/ 本来就禁止写入。
// 这里的前缀固定用正斜杠，因为下面 toPosixRelative 已经把路径分隔符统一成正斜杠了。
const STAMPABLE_PREFIXES = ['outputs/', 'bidding/', '法务/已审/']

function toPosixRelative(dataDir: string, absPath: string): string {
  return relative(dataDir, absPath).split(sep).join('/')
}

export function isStampablePath(dataDir: string, absPath: string): boolean {
  if (!absPath.endsWith('.md')) return false
  const rel = toPosixRelative(dataDir, absPath)
  return STAMPABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

const STAMP_PATTERN = /\n+---\n\*由 .+? 于 .+? 通过 company-os-desktop 生成\*\n*$/

function formatNow(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 在生成的 .md 文件末尾盖一个"操作人"戳，满足"产出文件里留痕谁生成的"这条需求。
 * 同一文件被同一次会话/后续会话反复 Write，只更新戳而不是无限堆叠——
 * 反映"最后一次是谁生成的"，不是完整历史（完整历史应该看 git log，不是这个戳的职责）。
 */
export function stampProvenance(filePath: string, userName: string): void {
  if (!existsSync(filePath)) return
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return
  }
  const stripped = content.replace(STAMP_PATTERN, '')
  const stamp = `\n\n---\n*由 ${userName} 于 ${formatNow()} 通过 company-os-desktop 生成*\n`
  writeFileSync(filePath, stripped + stamp, 'utf-8')
}
