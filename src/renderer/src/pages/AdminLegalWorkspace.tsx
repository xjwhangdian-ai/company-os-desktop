import { useState } from 'react'
import type { AgentDisplayMeta } from '@shared/agent-types'
import { LegalWorkspace } from './LegalWorkspace'
import { OpsPolicyWorkspace } from './OpsPolicyWorkspace'

/** 单一入口，按任务类型保留合同审查与行政制度两条独立专业工作流。 */
export function AdminLegalWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [tab, setTab] = useState<'legal' | 'ops'>('legal')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="app-drag flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <span className="mr-2 text-sm font-semibold text-slate-700">行政法务助手</span>
        <button
          onClick={() => setTab('legal')}
          className={`app-no-drag rounded-md px-3 py-1 text-xs font-medium ${tab === 'legal' ? 'bg-jushi-accent text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          合同与法律审核
        </button>
        <button
          onClick={() => setTab('ops')}
          className={`app-no-drag rounded-md px-3 py-1 text-xs font-medium ${tab === 'ops' ? 'bg-jushi-accent text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          行政人力与制度
        </button>
        <span className="ml-auto text-[11px] text-slate-400">一个入口，按任务自动采用对应专业规则</span>
      </div>
      <div className="min-h-0 flex-1">{tab === 'legal' ? <LegalWorkspace agent={agent} /> : <OpsPolicyWorkspace agent={agent} />}</div>
    </div>
  )
}
