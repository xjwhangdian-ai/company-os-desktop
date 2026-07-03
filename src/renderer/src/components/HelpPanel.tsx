import { useState } from 'react'
import type { HelpContent } from '../lib/help-content'

/** 每个页面顶部的「？」帮助按钮 + 展开面板，说明这一页各按钮的作用 */
export function HelpButton({ content }: { content: HelpContent }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
          open ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-400 hover:border-slate-400'
        }`}
        title="使用说明"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">{content.title}</h4>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              ✕
            </button>
          </div>
          <dl className="space-y-2">
            {content.items.map((item) => (
              <div key={item.label}>
                <dt className="text-xs font-medium text-jushi-accent">{item.label}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
