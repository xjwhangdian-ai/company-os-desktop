import { useEffect, useRef, useState } from 'react'

type UpdateInfo = Awaited<ReturnType<typeof window.api.update.check>>

/**
 * 自更新横幅：启动后延时静默检查 GitHub Releases，发现新版在窗口顶部弹提示条；
 * 人工点「立即更新」才下载安装（带进度）。检查失败静默忽略（离线/无代理时不打扰）。
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current) return
    checked.current = true
    const timer = setTimeout(async () => {
      try {
        const r = await window.api.update.check()
        if (r.hasUpdate) setInfo(r)
      } catch {
        // 静默：检查更新失败不打扰使用
      }
    }, 8000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!downloading) return
    const off = window.api.update.onProgress((p) => setPct(p.pct))
    return off
  }, [downloading])

  if (!info || dismissed) return null

  async function handleUpdate(): Promise<void> {
    if (!info) return
    setDownloading(true)
    setPct(0)
    try {
      const r = await window.api.update.download(info)
      setDoneMsg(r.说明)
    } catch (err) {
      setDoneMsg(`更新失败：${err instanceof Error ? err.message : String(err)}——可去 GitHub Releases 手动下载`)
    } finally {
      setDownloading(false)
      setPct(null)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2">
      <span className="text-sm">🔔</span>
      <div className="min-w-0 flex-1 text-xs leading-snug text-amber-800">
        {doneMsg ? (
          doneMsg
        ) : downloading ? (
          <>
            正在下载 v{info.latest} 安装包…{pct !== null && pct >= 0 ? ` ${pct}%` : ''}
          </>
        ) : (
          <>
            <b>有更新版本 v{info.latest}</b>（当前 v{info.current}）
            {info.notes && <span className="ml-2 hidden text-amber-700/80 md:inline">{info.notes.split('\n')[0].slice(0, 60)}</span>}
          </>
        )}
      </div>
      {!doneMsg && (
        <button
          disabled={downloading}
          onClick={handleUpdate}
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {downloading ? '下载中…' : '立即更新'}
        </button>
      )}
      <button
        onClick={() => window.open(info.releaseUrl, '_blank')}
        className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
        title="在浏览器打开 GitHub Releases 页面查看更新说明"
      >
        详情
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-amber-400 hover:text-amber-700"
        title="本次启动不再提示"
      >
        ✕
      </button>
    </div>
  )
}
