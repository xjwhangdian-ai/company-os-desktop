import { useState } from 'react'

/**
 * ☁️ 一键同步：提交本地改动 → 拉取远程 → 推送。管理员机器远程指 GitHub（走代理），
 * 团队成员机器指内网仓库（不需要访问外网）——按钮本身不关心远程在哪。
 */
export function SyncButton({
  userName,
  compact,
  onDone
}: {
  userName: string
  compact?: boolean
  onDone?: (ok: boolean) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

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
