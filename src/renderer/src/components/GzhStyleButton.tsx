import { useState } from 'react'
import { HelpButton } from './HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'
import { useConfigStore } from '../stores/useConfigStore'

type Theme = '炬视' | '瑾智'

/**
 * 公众号排版 + 封面：CLAUDE.md 里标注的例外，纯脚本调用 tools/gzh/，独立于聊天流程。
 * 风格（炬视/瑾智）可在此选择，透传给排版脚本与封面生成。
 */
export function GzhStyleButton(): React.JSX.Element {
  const config = useConfigStore((s) => s.config)
  const activeName = config?.companies.find((c) => c.id === config.activeCompanyId)?.name ?? ''
  const [theme, setTheme] = useState<Theme>(activeName.includes('瑾智') ? '瑾智' : '炬视')
  const [running, setRunning] = useState<null | 'style' | 'cover'>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleStyle(): Promise<void> {
    setError(null)
    setNotice(null)
    const paths = await window.api.dialog.pickFiles([{ name: 'Markdown', extensions: ['md'] }])
    if (paths.length === 0) return
    setRunning('style')
    try {
      const outputHtml = await window.api.gzh.runStyle(paths[0], theme)
      await window.api.shell.openPath(outputHtml)
      setNotice(`已按「${theme}」风格排版，浏览器已打开——点右上「一键复制」粘进公众号编辑器`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  async function handleCover(): Promise<void> {
    setError(null)
    setNotice(null)
    const paths = await window.api.dialog.pickFiles([{ name: 'Markdown', extensions: ['md'] }])
    if (paths.length === 0) return
    setRunning('cover')
    try {
      const r = await window.api.gzh.generateCover(paths[0], theme)
      await window.api.shell.showItemInFolder(r.banner)
      setNotice(`已生成「${theme}」风格封面：横版 900×383 + 方版 500×500（标题「${r.title}」），已在 Finder 中定位`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="border-b border-slate-200 bg-amber-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-amber-700">风格</span>
        <div className="flex overflow-hidden rounded-md border border-amber-300">
          {(['炬视', '瑾智'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`px-2.5 py-1 text-xs font-medium ${
                theme === t ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 hover:bg-amber-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={handleStyle}
          disabled={running !== null}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {running === 'style' ? '排版中…' : '🎨 一键排版（选 .md）'}
        </button>
        <button
          onClick={handleCover}
          disabled={running !== null}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {running === 'cover' ? '生成中…' : '🖼️ 生成封面图（选 .md）'}
        </button>
        <span className="text-xs text-amber-600">纯脚本，不经过 AI</span>
        <HelpButton content={HELP_CONTENT.gzhTool} />
      </div>
      {notice && <p className="mt-1 text-xs text-emerald-700">{notice}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
