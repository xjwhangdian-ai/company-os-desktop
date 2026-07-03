import { useState } from 'react'
import { HelpButton } from './HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

/**
 * 公众号排版是 CLAUDE.md 里明确标注的例外：不经过 AI，纯脚本调用
 * tools/gzh/gzh_style.js，独立于聊天流程之外的工具按钮。
 */
export function GzhStyleButton(): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    setError(null)
    const paths = await window.api.dialog.pickFiles()
    if (paths.length === 0) return
    setRunning(true)
    try {
      const outputHtml = await window.api.gzh.runStyle(paths[0])
      await window.api.shell.openPath(outputHtml)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border-b border-slate-200 bg-amber-50 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={handleClick}
          disabled={running}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {running ? '排版中…' : '🎨 公众号一键排版（选 .md 文件）'}
        </button>
        <span className="text-xs text-amber-600">纯脚本工具，不经过 AI，风格固定走 tools/gzh/theme.js</span>
        <HelpButton content={HELP_CONTENT.gzhTool} />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
