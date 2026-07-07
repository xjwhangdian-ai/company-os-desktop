import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 公众号排版是 CLAUDE.md 里明确标注的例外：不经过 AI，纯脚本调用
 * tools/gzh/gzh_style.js。产出 HTML 放在与输入 md 同一个文件夹，
 * 命名跟仓库里已有的产出保持一致（<同名>_排版预览.html）。
 */
export async function runGzhStyle(dataDir: string, inputMdPath: string): Promise<string> {
  const scriptPath = join(dataDir, 'tools', 'gzh', 'gzh_style.js')
  if (!existsSync(scriptPath)) {
    throw new Error('未找到 tools/gzh/gzh_style.js，请确认数据目录是否是完整的 company-os 仓库')
  }
  const outputPath = inputMdPath.replace(/\.md$/i, '') + '_排版预览.html'
  // 用 App 自带的 Electron 运行时充当 Node（ELECTRON_RUN_AS_NODE），
  // Windows 成员机无需另装 Node.js 也能跑排版脚本；mac/win 通用。
  await execFileAsync(process.execPath, [scriptPath, inputMdPath, outputPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  return outputPath
}
