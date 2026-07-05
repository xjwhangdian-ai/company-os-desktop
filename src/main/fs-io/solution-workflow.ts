import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SolutionFile, SolutionFileKind } from '@shared/agent-types'
import { extractCompanion } from './doc-extract'

// ============ 解决方案工作台的数据层 ============
// 统一 inbox/outputs 约定：需求文件（输入）在 inbox，方案成品（产出）在 outputs 按项目建夹；
// 资料库/模板是跨项目的"库"，留在 解决方案/ 工作区：
//   inbox/02_解决方案_solution/需求文件/  ← 钉钉会议录音(mp3/m4a/wav)、需求纪要(md/docx/pdf) + 转写产物 _转写.md
//   解决方案/基础产品库/                  ← 基础产品资料（可上传补充；产品统一口径仍以 knowledge/products/ 为准）
//   解决方案/基础解决方案库/               ← 历史方案/行业方案，生成新方案时取结构与打法参考
//   解决方案/_模板/解决方案模板/           ← 方案文档模板
//   outputs/02_解决方案_solution/{日期_项目}/ ← 方案成品（分身写入）
// 转写由 App 本地完成，方案生成由 solution 分身完成。

const KIND_DIRS: Record<SolutionFileKind, string> = {
  requirement: join('inbox', '02_解决方案_solution', '需求文件'),
  productLib: join('解决方案', '基础产品库'),
  solutionLib: join('解决方案', '基础解决方案库'),
  template: join('解决方案', '_模板', '解决方案模板')
}

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav'])

export function ensureSolutionDirs(dataDir: string): void {
  for (const rel of Object.values(KIND_DIRS)) {
    mkdirSync(join(dataDir, rel), { recursive: true })
  }
  const readmePath = join(dataDir, '解决方案', 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# 解决方案工作区（资料库与模板）

由 company-os-desktop 的解决方案工作台管理。本目录只放跨项目复用的"库"：

- \`基础产品库/\` — 基础产品资料（补充材料；产品名称/参数的统一口径仍以 knowledge/products/ 为准）
- \`基础解决方案库/\` — 历史方案与行业方案，生成新方案时取结构与打法参考
- \`_模板/解决方案模板/\` — 方案文档模板

输入与产出走统一约定：需求文件（钉钉录音/纪要及其转写稿）在 \`inbox/02_解决方案_solution/需求文件/\`；
方案成品按项目归档在 \`outputs/02_解决方案_solution/{日期_项目}/\`。转写在本地完成（不消耗 AI 额度）。
`,
      'utf-8'
    )
  }
}

function uniqueDest(destDir: string, fileName: string): string {
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

export async function uploadSolutionFile(
  dataDir: string,
  kind: SolutionFileKind,
  sourcePath: string
): Promise<{ relativePath: string }> {
  ensureSolutionDirs(dataDir)
  const destDir = join(dataDir, KIND_DIRS[kind])
  const dest = uniqueDest(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  // docx/doc/xlsx 生成伴生提取文本，分身才能读到内容；提取失败不阻塞上传（比如 .doc 在非 mac 上）
  if (/\.(docx|doc|xlsx)$/i.test(dest)) {
    await extractCompanion(dest).catch(() => null)
  }
  return { relativePath: `${KIND_DIRS[kind].replace(/\\/g, '/')}/${basename(dest)}` }
}

function listDir(dataDir: string, kind: SolutionFileKind): SolutionFile[] {
  const dirRel = KIND_DIRS[kind]
  const dir = join(dataDir, dirRel)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const visible = names.filter((n) => !n.startsWith('.') && n !== 'README.md' && !n.includes('_提取文本'))
  const nameSet = new Set(visible)
  return visible
    .filter((n) => statSync(join(dir, n)).isFile())
    .map((fileName) => {
      const full = join(dir, fileName)
      const st = statSync(full)
      const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
      const stem = fileName.slice(0, fileName.lastIndexOf('.'))
      const companionCsv = `${fileName}_提取文本.csv`
      const companionTxt = `${fileName}_提取文本.txt`
      const companion = names.includes(companionCsv) ? companionCsv : names.includes(companionTxt) ? companionTxt : undefined
      return {
        fileName,
        path: full,
        relativePath: `${dirRel.replace(/\\/g, '/')}/${fileName}`,
        size: st.size,
        mtimeMs: st.mtimeMs,
        isAudio: AUDIO_EXTS.has(ext),
        hasTranscript: AUDIO_EXTS.has(ext) && nameSet.has(`${stem}_转写.md`),
        companionRelativePath: companion ? `${dirRel.replace(/\\/g, '/')}/${companion}` : undefined
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function listSolutionFiles(dataDir: string): Record<SolutionFileKind, SolutionFile[]> {
  ensureSolutionDirs(dataDir)
  return {
    requirement: listDir(dataDir, 'requirement'),
    productLib: listDir(dataDir, 'productLib'),
    solutionLib: listDir(dataDir, 'solutionLib'),
    template: listDir(dataDir, 'template')
  }
}

export function removeSolutionFile(dataDir: string, relativePath: string): void {
  // 只允许删除解决方案工作区内的文件，防止这个接口被误用成通用删除
  const allowed = Object.values(KIND_DIRS).some((d) => relativePath.startsWith(d.replace(/\\/g, '/') + '/'))
  if (!allowed) throw new Error('只能删除解决方案工作区内的文件')
  const full = join(dataDir, relativePath)
  if (existsSync(full)) unlinkSync(full)
  // 顺带清理伴生提取文本
  for (const suffix of ['_提取文本.csv', '_提取文本.txt']) {
    const companion = `${full}${suffix}`
    if (existsSync(companion)) unlinkSync(companion)
  }
}
