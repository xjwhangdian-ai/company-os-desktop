import { execFile } from 'node:child_process'
import { sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 等价复刻 .claude/settings.json 的 PostToolUse hook：分身写入 outputs/ 下的文件
 * 自动 git add，方便后续追踪产出历史。非 git 仓库或 git 不可用时静默跳过，
 * 不影响主流程（这只是归档便利，不是关键路径）。
 */
export async function archiveIfUnderOutputs(dataDir: string, filePath: string): Promise<void> {
  if (!filePath.includes('outputs/') && !filePath.includes(`outputs${sep}`)) {
    return
  }
  try {
    await execFileAsync('git', ['add', filePath], { cwd: dataDir })
  } catch {
    // 非 git 仓库 / 文件已在 .gitignore / git 不可用，均静默忽略
  }
}
