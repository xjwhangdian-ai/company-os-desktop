import { useEffect, useState } from 'react'

/**
 * ☁️ 一键同步：提交本地改动 → 拉取远程 → 推送。仅管理员的开发机需要（数据目录是 git 仓库且配了远程）。
 * 团队成员机器数据不走 git（git 只管应用程序更新，数据由 App 内置抓取/本机生成），
 * 数据目录不是 git 仓库或没配远程时按钮整体隐藏，不再弹"同步失败"。
 */
export function SyncButton({
  userName,
  compact,
  onDone
}: {
  userName: string
  compact?: boolean
  onDone?: (ok: boolean) => void
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    window.api.sync
      .status()
      .then((s) => setAvailable(s.isRepo && s.hasRemote))
      .catch(() => setAvailable(false))
  }, [])

  async function handleSync(): Promise<void> {
    setBusy(true)
    setResult(null)
    try {
      const r = await window.api.sync.now(userName)
      setResult(r)
      onDone?.(r.ok)
      setTimeout(() => setResult(null), r.ok ? 4000 : 12000)
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  return (
    <div className={compact ? '' : 'w-full'}>
      <button
        onClick={handleSync}
        disabled={busy}
        className={
          compact
            ? 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50'
            : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-white/60 disabled:opacity-50'
        }
        title="提交本地改动并与远程仓库同步（大脑与库；inbox/outputs 不同步）"
      >
        {busy ? '⏳ 同步中…' : '☁️ 一键同步'}
      </button>
      {result && (
        <p className={`mt-1 px-3 text-xs leading-snug ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
