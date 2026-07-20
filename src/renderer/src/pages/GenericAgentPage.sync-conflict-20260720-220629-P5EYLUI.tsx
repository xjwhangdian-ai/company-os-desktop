import { useState } from 'react'
import type { AgentDisplayMeta, AgentName } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { OutputsPanel } from '../components/OutputsPanel'

export function GenericAgentPage({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [showOutputs, setShowOutputs] = useState(false)

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden">
        <AgentChat agent={agent} />
      </div>
      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-72' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">
              产出：outputs/{agent.name as AgentName}
            </h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel agentName={agent.name as AgentName} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
