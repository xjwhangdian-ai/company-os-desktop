import { useState } from 'react'

// ============ 工作台左右/上下分隔条（与招投标分身同款交互，全分身复用）============
// 拖动调节栏宽/栏高并记进 localStorage；对话栏宽度用同一个 key，全分身同步。

/** 记忆化尺寸：初始读 localStorage，更新时夹在 [min,max] 并写回 */
export function usePersistedSize(key: string, def: number, min: number, max: number): [number, (n: number) => void] {
  const [size, setSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(key))
    return saved >= min && saved <= max ? saved : def
  })
  const update = (n: number): void => {
    const v = Math.min(max, Math.max(min, n))
    setSize(v)
    localStorage.setItem(key, String(v))
  }
  return [size, update]
}

/** 对话栏宽度的统一 key/默认值（Sales/Solution/Finance/Brand 等右栏定宽页共用，改一处全分身同步） */
export const CHAT_PANE_KEY = 'chatPaneWidth'
export const CHAT_PANE = { def: 420, min: 320, max: 900 }

/**
 * 左右拖拽分隔条（竖条）。
 * sign=+1：size 是**左栏**宽（往右拖变大）；sign=-1：size 是**右栏**宽（往左拖变大）。
 */
export function VDragHandle({
  size,
  onSize,
  sign = 1,
  min = 260,
  max = 900
}: {
  size: number
  onSize: (n: number) => void
  sign?: 1 | -1
  min?: number
  max?: number
}): React.JSX.Element {
  return (
    <div
      title="按住左右拖动，调节左右栏宽度"
      className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-slate-100 hover:bg-jushi-accent/30"
      onMouseDown={(e) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = size
        const calc = (me: MouseEvent): number => Math.min(max, Math.max(min, startW + sign * (me.clientX - startX)))
        const onMove = (me: MouseEvent): void => onSize(calc(me))
        const onUp = (me: MouseEvent): void => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          onSize(calc(me))
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }}
    >
      <span className="h-8 w-0.5 rounded bg-slate-300 group-hover:bg-jushi-accent" />
    </div>
  )
}

/** 上下拖拽分隔条（横条）。sign=-1：size 是**下方栏**高（往上拖变大，运营页对话栏用） */
export function HDragHandle({
  size,
  onSize,
  sign = -1,
  min = 200,
  max = 800
}: {
  size: number
  onSize: (n: number) => void
  sign?: 1 | -1
  min?: number
  max?: number
}): React.JSX.Element {
  return (
    <div
      title="按住上下拖动，调节对话栏高度"
      className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-slate-100 hover:bg-jushi-accent/30"
      onMouseDown={(e) => {
        e.preventDefault()
        const startY = e.clientY
        const startH = size
        const calc = (me: MouseEvent): number => Math.min(max, Math.max(min, startH + sign * (me.clientY - startY)))
        const onMove = (me: MouseEvent): void => onSize(calc(me))
        const onUp = (me: MouseEvent): void => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          onSize(calc(me))
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }}
    >
      <span className="h-0.5 w-8 rounded bg-slate-300 group-hover:bg-jushi-accent" />
    </div>
  )
}
