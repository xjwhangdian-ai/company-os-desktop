import type { ReactNode } from 'react'

export type NoticeKind = 'success' | 'warning' | 'error' | 'info'

export interface NoticeState {
  text: string
  kind: NoticeKind
}

/** 按提示文本推断结果状态（含失败/错误/❌ → error；待人工/部分/⚠️ → warning；其余默认 success） */
export function noticeKindOf(text: string): NoticeKind {
  if (/失败|错误|出错|无法|未成功|异常|不存在|❌/.test(text)) return 'error'
  if (/待人工|待确认|部分|警告|注意|未完成|跳过|⚠️/.test(text)) return 'warning'
  return 'success'
}

const KIND_META: Record<NoticeKind, { icon: string; cls: string }> = {
  success: { icon: '✅', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  warning: { icon: '⚠️', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  error: { icon: '❌', cls: 'border-red-200 bg-red-50 text-red-700' },
  info: { icon: 'ℹ️', cls: 'border-slate-200 bg-slate-50 text-slate-600' }
}

/**
 * 操作结果横幅：与按钮同页持久显示执行结果，直到下次操作或手动关闭。
 * 用于替代 5 秒自动消失的瞬态提示，保证"点了按钮就能在同页看到结果"。
 */
export function ResultNotice({ notice, onClose }: { notice: NoticeState | null; onClose: () => void }): ReactNode {
  if (!notice) return null
  const meta = KIND_META[notice.kind] ?? KIND_META.info
  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${meta.cls}`}>
      <span className="min-w-0 flex-1">
        <span className="mr-1">{meta.icon}</span>
        {notice.text}
      </span>
      <button onClick={onClose} className="shrink-0 text-xs opacity-60 hover:opacity-100" aria-label="关闭结果提示">
        ✕
      </button>
    </div>
  )
}
