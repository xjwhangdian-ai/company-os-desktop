import { useEffect, useState } from 'react'

/**
 * ☁️ 一键同步：提交本地改动 → 拉取远程 → 推送。仅管理员的开发机需要（数据目录是 git 仓库且配了远程）。
 * 普通成员也需要看到同步入口，以便获取管理员下发的花名册；未绑定远程时明确说明原因，
 * 不再把入口整个隐藏。
 */
export function SyncButton({
  userName,
  readOnlyProductLibrary,
  compact,
  label,
  productData,
  onDone
}: {
  userName: string
  /** 普通成员同步只拉取管理员产品库，不会提交或推送本机产品数据。 */
  readOnlyProductLibrary?: boolean
  compact?: boolean
  /** 特定页面可覆盖按钮文案；同步权限与行为保持不变。 */
  label?: string
  /** 产品页专用同步：调用产品库同步通道，并保留同步失败提示。 */
  productData?: boolean
  onDone?: (ok: boolean) => void
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (productData) {
      setAvailable(true)
      return
    }
    window.api.sync
      .status()
      .then((s) => setAvailable(s.isRepo && s.hasRemote))
      .catch(() => setAvailable(false))
  }, [productData])

  async function handleSync(): Promise<void> {
    setBusy(true)
    setResult(null)
    try {
      const r = productData ? await window.api.sync.products(userName) : await window.api.sync.now(userName)
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
        onClick={() => {
          if (!available) {
            setResult({ ok: false, message: '当前公司数据目录尚未绑定同步仓库；请在「设置 → 数据目录」确认目录后重试。' })
            return
          }
          void handleSync()
        }}
        disabled={busy}
        className={
          compact
            ? 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50'
            : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-white/60 disabled:opacity-50'
        }
        title={available ? (productData ? '获取管理员发布的产品清单、分类和图片；同步成功后显示' : readOnlyProductLibrary ? '拉取管理员发布的产品库；员工端不提交或推送产品数据' : '提交本地改动并与远程仓库同步（大脑与库；inbox/outputs 不同步）') : '未绑定同步仓库：点击查看处理说明'}
      >
        {busy ? '⏳ 同步中…' : label ?? (readOnlyProductLibrary ? '☁️ 同步产品库' : '☁️ 一键同步')}
      </button>
      {result && (
        <p className={`mt-1 px-3 text-xs leading-snug ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
