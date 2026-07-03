import { useEffect, useState } from 'react'
import type { AgentName, OutputEntry } from '@shared/agent-types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function EntryRow({
  entry,
  depth,
  extraFileAction
}: {
  entry: OutputEntry
  depth: number
  extraFileAction?: (entry: OutputEntry) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(depth === 0)

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {entry.isDirectory ? (
          <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-2 text-left min-w-0">
            <span className="text-slate-400">{open ? '📂' : '📁'}</span>
            <span className="truncate font-medium text-slate-700">{entry.name}</span>
          </button>
        ) : (
          <>
            <span className="text-slate-400">📄</span>
            <span className="flex-1 truncate text-slate-600">{entry.name}</span>
            <span className="shrink-0 text-xs text-slate-300">{formatSize(entry.size)}</span>
            {extraFileAction?.(entry)}
            <button
              onClick={() => window.api.shell.showItemInFolder(entry.path)}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
            >
              定位
            </button>
            <button
              onClick={() => window.api.shell.saveAsCopy(entry.path)}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
            >
              另存为
            </button>
          </>
        )}
      </div>
      {entry.isDirectory &&
        open &&
        entry.children?.map((child) => (
          <EntryRow key={child.path} entry={child} depth={depth + 1} extraFileAction={extraFileAction} />
        ))}
    </div>
  )
}

export function OutputsPanel({
  agentName,
  refreshKey,
  extraFileAction
}: {
  agentName: AgentName
  refreshKey?: number
  /** 给每个文件行加一个额外的自定义操作按钮，比如运营页的"一键排版" */
  extraFileAction?: (entry: OutputEntry) => React.ReactNode
}): React.JSX.Element {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.api.outputs
      .scan(agentName)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [agentName, refreshKey])

  if (loading) return <div className="p-4 text-sm text-slate-400">加载中…</div>
  if (entries.length === 0) return <div className="p-4 text-sm text-slate-400">暂无产出</div>

  return (
    <div className="py-2">
      {entries.map((entry) => (
        <EntryRow key={entry.path} entry={entry} depth={0} extraFileAction={extraFileAction} />
      ))}
    </div>
  )
}
