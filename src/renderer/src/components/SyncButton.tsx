import { useState } from 'react'

/**
 * 产品库同步：从独立发布源下载销售可见的产品清单。
 * 不依赖本机数据目录是否为 Git 仓库，因此 macOS 和 Windows 的新装机器都能直接使用。
 */
export function SyncButton({
  userName,
  compact,
  label,
  onDone
}: {
  userName: string
  compact?: boolean
  /** 特定页面可覆盖按钮文案。 */
  label?: string
  onDone?: (ok: boolean) => void
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSync(): Promise<void> {
    setBusy(true)
    setResult(null)
    try {
      const r = await window.api.sync.products(userName)
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
        onClick={() => void handleSync()}
        disabled={busy}
        className={
          compact
            ? 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50'
            : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-white/60 disabled:opacity-50'
        }
        title="下载已发布的销售产品清单；同步成功后显示产品内容"
      >
        {busy ? '⏳ 同步中…' : label ?? '☁️ 同步产品库'}
      </button>
      {result && (
        <p className={`mt-1 px-3 text-xs leading-snug ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
