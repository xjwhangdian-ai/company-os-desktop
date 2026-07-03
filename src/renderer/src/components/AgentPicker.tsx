import type { AgentDisplayMeta } from '@shared/agent-types'

interface AgentPickerProps {
  agents: AgentDisplayMeta[]
  activeName: string | null
  onSelect: (name: AgentDisplayMeta['name']) => void
}

export function AgentPicker({ agents, activeName, onSelect }: AgentPickerProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {agents.map((agent) => {
        const active = agent.name === activeName
        return (
          <button
            key={agent.name}
            onClick={() => onSelect(agent.name)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
              active ? 'bg-white shadow-sm' : 'hover:bg-white/60'
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: agent.color }}
            >
              {agent.displayName.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{agent.displayName}</span>
              <span className="block truncate text-xs text-slate-400">{agent.whenToUse}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
