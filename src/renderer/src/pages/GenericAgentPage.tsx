import { useState } from 'react'
import type { AgentDisplayMeta, AgentName } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { OutputsPanel } from '../components/OutputsPanel'

export function GenericAgentPage({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  // 收起对话后产出面板铺满（这类分身工作区本体就是对话，收起等于"专心翻看产出"）
  const outputsOpen = showOutputs || !showChat

  return (
    <div className="flex h-full">
      <div className={`overflow-hidden transition-all ${showChat ? 'flex-1' : 'w-0'}`}>
        <AgentChat agent={agent} />
      </div>
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div
        className={`overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${
          !showChat ? 'flex-1' : showOutputs ? 'w-72 shrink-0' : 'w-10 shrink-0'
        }`}
      >
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {outputsOpen ? '›' : '‹'}
        </button>
        {outputsOpen && (
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
