import { useEffect, useMemo, useState } from 'react'
import type { AgentDisplayMeta, OpsDocState, OpsGovernanceDoc, OpsPolicyDoc } from '@shared/agent-types'
import { OPS_DOC_STATES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

const STATE_STYLE: Record<OpsDocState, string> = {
  未审核: 'bg-slate-100 text-slate-500',
  初审: 'bg-amber-50 text-amber-600',
  终审: 'bg-blue-50 text-blue-600',
  定稿: 'bg-emerald-50 text-emerald-600'
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function today(): string {
  return fmtDate(Date.now())
}

/** 起草新制度的提示词：产出进 01_未审核/，状态流转由人在工作台完成 */
function buildDraftPrompt(): string {
  return [
    `起草一份新制度/SOP（把〔制度名称〕〔适用范围/要点〕改成实际内容再发送）。`,
    ``,
    `制度名称：〔如：员工考勤与请假管理制度〕`,
    `适用范围与要点：〔如：全员适用；弹性上下班；病假事假年假规则；加班调休〕`,
    ``,
    `要求：按 ops-policy 分身的制度骨架起草（目的与范围 → 具体条款 → 流程与表单 → 生效与解释权），`,
    `结合公司实际（初创、十人以内规模），条款可执行、不堆空话。`,
    `产出路径：outputs/07_行政人力_ops-policy/01_未审核/${today()}_〔制度名称〕.md`,
    `（新起草的制度一律进 01_未审核/，之后在工作台左侧改状态流转：未审核 → 初审 → 终审 → 定稿。）`
  ].join('\n')
}

export function OpsPolicyWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [docs, setDocs] = useState<OpsPolicyDoc[]>([])
  const [governance, setGovernance] = useState<OpsGovernanceDoc[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 5000)
  }

  async function refresh(): Promise<void> {
    setDocs(await window.api.ops.listPolicyDocs())
    setGovernance(await window.api.ops.listGovernanceDocs())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSetGovState(doc: OpsGovernanceDoc, target: OpsDocState): Promise<void> {
    if (target === doc.state) return
    try {
      await window.api.ops.setGovernanceState(doc.relativePath, target)
      flash(`「${doc.name}」审核状态已标为【${target}】`)
      await refresh()
    } catch (err) {
      flash(`标记失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleSetState(doc: OpsPolicyDoc, target: OpsDocState): Promise<void> {
    if (target === doc.state) return
    try {
      await window.api.ops.setPolicyDocState(doc.relativePath, target)
      flash(`「${doc.name}」已流转为【${target}】`)
      await refresh()
    } catch (err) {
      flash(`流转失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const byState = useMemo(() => {
    const g = new Map<OpsDocState, OpsPolicyDoc[]>()
    for (const s of OPS_DOC_STATES) g.set(s, [])
    for (const d of docs) g.get(d.state)?.push(d)
    return g
  }, [docs])

  return (
    <div className="flex h-full">
      {/* 左：治理文件 + 制度文件状态板 */}
      <div className="flex w-[440px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="app-drag flex items-center justify-between px-3 pb-2 pt-4">
          <span className="text-xs font-semibold text-slate-500">行政人力 · 制度与治理文件</span>
          <div className="app-no-drag flex items-center gap-1.5">
            <button
              onClick={() => setPendingPrompt(buildDraftPrompt())}
              className="rounded-lg bg-jushi-accent px-2.5 py-1 text-xs font-medium text-white"
            >
              ✍️ 起草新制度
            </button>
            <HelpButton content={HELP_CONTENT.opsPolicy} />
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3 pt-0">
          {/* 公司章程与治理文件（法务产出，直达打开） */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
              📜 公司章程与治理文件（{governance.length}）
            </div>
            <div className="space-y-1 bg-slate-50 p-2">
              {governance.map((g) => (
                <div key={g.relativePath} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[g.state]}`}>{g.state}</span>
                  <button
                    onClick={() => window.api.shell.openPath(g.path)}
                    title={`直接打开查看（${g.relativePath}）`}
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium text-jushi-accent underline-offset-2 hover:underline"
                  >
                    {g.name}
                  </button>
                  <select
                    value={g.state}
                    onChange={(e) => handleSetGovState(g, e.target.value as OpsDocState)}
                    title="标记审核状态（文件不移动，状态单独记录）"
                    className="shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-500 outline-none"
                  >
                    {OPS_DOC_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0 text-[10px] text-slate-300">{fmtDate(g.mtimeMs)}</span>
                  <button
                    onClick={() => window.api.shell.showItemInFolder(g.path)}
                    className="shrink-0 text-xs text-slate-400 hover:text-jushi-accent"
                  >
                    定位
                  </button>
                </div>
              ))}
              {governance.length === 0 && (
                <p className="py-3 text-center text-xs text-slate-400">
                  暂无——章程/代持/股权类文件由法务分身产出到 outputs/04_法务_legal/ 后自动出现在这里
                </p>
              )}
            </div>
          </div>

          {/* 制度文件四状态 */}
          {OPS_DOC_STATES.map((state) => {
            const items = byState.get(state) ?? []
            return (
              <div key={state} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between bg-slate-100 px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-slate-600">
                    <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATE_STYLE[state]}`}>{state}</span>
                    {items.length} 份
                  </span>
                  <span className="text-[10px] text-slate-400">outputs/07_行政人力_ops-policy/{['01_未审核', '02_初审', '03_终审', '04_定稿'][OPS_DOC_STATES.indexOf(state)]}/</span>
                </div>
                {items.length > 0 && (
                  <div className="space-y-1 bg-slate-50 p-2">
                    {items.map((d) => (
                      <div key={d.relativePath} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <button
                          onClick={() => window.api.shell.openPath(d.path)}
                          title="直接打开查看"
                          className="min-w-0 flex-1 truncate text-left text-xs text-slate-700 hover:text-jushi-accent"
                        >
                          {d.name}
                        </button>
                        <select
                          value={d.state}
                          onChange={(e) => handleSetState(d, e.target.value as OpsDocState)}
                          title="改状态=移动到对应状态文件夹"
                          className="shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-500 outline-none"
                        >
                          {OPS_DOC_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => window.api.shell.showItemInFolder(d.path)}
                          className="shrink-0 text-xs text-slate-400 hover:text-jushi-accent"
                        >
                          定位
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {notice && (
          <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">{notice}</div>
        )}
      </div>

      {/* 右：分身对话 */}
      <div className="min-w-0 flex-1">
        <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
      </div>
    </div>
  )
}
