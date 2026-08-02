import { useEffect, useState } from 'react'
import type { AgentDisplayMeta } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

type MatterStatus = '未开始' | '进行中' | '待人工' | '已完成'
interface Matter {
  key: string
  名称: string
  图标: string
  状态: MatterStatus
  待办: string
  截止日: string
  成果: { name: string; path: string; mtimeMs: number }[]
}

const STATUS_STYLE: Record<MatterStatus, string> = {
  未开始: 'bg-slate-100 text-slate-500',
  进行中: 'bg-blue-50 text-blue-600',
  待人工: 'bg-amber-50 text-amber-700',
  已完成: 'bg-emerald-50 text-emerald-600'
}
const STATUSES: MatterStatus[] = ['未开始', '进行中', '待人工', '已完成']

/** 事项对应的分身快捷指令（点「让分身推进」填入对话框） */
const MATTER_PROMPTS: Record<string, string> = {
  logo: '按现有VI体系（outputs/06_品牌_brand/2026-07-06_炬视品牌全套设计/）检查还缺哪些应用场景的延展设计，列清单并逐个产出 SVG。',
  gongpai: '按公司VI（outputs/06_品牌_brand/ 下的VI规范与Logo源文件）设计员工工牌：竖版 54×86mm，含Logo、姓名/职务/工号占位、背面公司信息，产出 SVG + 打印说明到 outputs/06_品牌_brand/{日期}_工牌设计/。',
  ppt: '检查 PPT 母版（outputs/06_品牌_brand/2026-06-25_炬视品牌VI/）是否需要按最新VI更新，如需更新产出新版母版。',
  mingpian: '基于 outputs/06_品牌_brand/2026-07-16_炬视名片_设计稿v2/ 检查名片信息是否需要更新（职务/电话/地址），需要则出新版。',
  shangbiao: '读取 outputs/06_品牌_brand/2026-07-30_商标注册风险应对/ 下的策略与修订意见，输出本周商标注册督办清单：每项写清 动作/责任方（我方或代理机构）/截止建议，重点盯图形标递交与撤三调查进展。',
  guanwang: '推进官网上线：①产出官网信息架构（栏目树+每页目标）②首页文案全文 ③首页高保真HTML原型（按VI配色，单文件），落 outputs/06_品牌_brand/{日期}_官网上线/。域名与备案状态问我。'
}

export function BrandWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [matters, setMatters] = useState<Matter[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [showChat, setShowChat] = useState(true)
  const [chatW, setChatW] = usePersistedSize(CHAT_PANE_KEY, CHAT_PANE.def, CHAT_PANE.min, CHAT_PANE.max)
  const [notice, setNotice] = useState<string | null>(null)

  function flash(t: string): void {
    setNotice(t)
    setTimeout(() => setNotice(null), 6000)
  }

  async function refresh(): Promise<void> {
    try {
      setMatters(await window.api.brand.listMatters())
    } catch {
      flash('读取品牌事项失败——如果刚更新过程序，请完全退出后重新打开再试')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  async function patchMatter(key: string, patch: { 状态?: MatterStatus; 待办?: string; 截止日?: string }): Promise<void> {
    await window.api.brand.setMatter(key, patch)
    await refresh()
  }

  const pending = matters.filter((m) => m.状态 !== '已完成')

  return (
    <div className="flex h-full">
      <div className={`flex flex-col overflow-hidden ${showChat ? 'flex-1' : 'flex-1'}`}>
        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="app-drag flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">品牌事项看板</h2>
            <div className="app-no-drag flex items-center gap-2">
              <button
                onClick={() =>
                  setPendingPrompt(
                    '作为品牌督办：逐项检查下面事项的状态与待办，生成《本周品牌事项督办清单》——每项写 当前卡点/下一步动作/责任方/建议完成时间，逾期或长期停滞的放最前面并给出催办话术。\n' +
                      pending.map((m) => `- ${m.名称}（${m.状态}${m.截止日 ? `，截止${m.截止日}` : ''}）：${m.待办 || '无待办备注'}`).join('\n')
                  )
                }
                className="rounded-full bg-jushi-accent px-3 py-1 text-xs font-medium text-white"
                title="把全部未完成事项交给分身，生成督办清单与催办话术"
              >
                📣 生成督办清单
              </button>
              <HelpButton content={HELP_CONTENT.brand} />
            </div>
          </div>
          {pending.length > 0 && (
            <p className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
              ⏰ 还有 {pending.length} 项品牌事项未完成：{pending.map((m) => m.名称).join('、')}——别让品牌建设停在半路。
            </p>
          )}
          {notice && <p className="mt-1 text-xs text-emerald-700">{notice}</p>}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 lg:grid-cols-2">
          {matters.map((m) => (
            <div key={m.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{m.图标}</span>
                <span className="text-sm font-semibold text-slate-700">{m.名称}</span>
                <select
                  value={m.状态}
                  onChange={(e) => patchMatter(m.key, { 状态: e.target.value as MatterStatus })}
                  className={`ml-auto rounded-full border-0 px-2 py-0.5 text-xs font-medium outline-none ${STATUS_STYLE[m.状态]}`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-slate-400">截止</span>
                <input
                  value={m.截止日}
                  onChange={(e) => patchMatter(m.key, { 截止日: e.target.value })}
                  placeholder="YYYY-MM-DD"
                  className="w-28 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] outline-none focus:border-jushi-accent"
                />
                <button
                  onClick={() => setPendingPrompt(MATTER_PROMPTS[m.key] ?? `推进品牌事项「${m.名称}」`)}
                  className="ml-auto rounded border border-jushi-accent px-2 py-0.5 text-[11px] text-jushi-accent hover:bg-jushi-accent/5"
                >
                  🤖 让分身推进
                </button>
              </div>
              <textarea
                value={m.待办}
                onChange={(e) => setMatters((prev) => prev.map((x) => (x.key === m.key ? { ...x, 待办: e.target.value } : x)))}
                onBlur={(e) => patchMatter(m.key, { 待办: e.target.value })}
                placeholder="待办事项（人工备注，失焦保存）"
                rows={2}
                className="mt-2 w-full resize-y rounded border border-slate-200 px-2 py-1 text-[11px] leading-snug text-slate-600 outline-none focus:border-jushi-accent"
              />
              <div className="mt-2 border-t border-slate-100 pt-1.5">
                <div className="text-[10px] font-semibold text-slate-400">设计成果（design 产出，点击打开）</div>
                {m.成果.length === 0 && <div className="py-1 text-[11px] text-slate-300">还没有成果——点「让分身推进」开始</div>}
                {m.成果.slice(0, 5).map((f) => (
                  <button
                    key={f.path}
                    onClick={() => window.api.shell.openPath(f.path)}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-jushi-accent hover:bg-slate-50"
                    title={`打开 ${f.name}`}
                  >
                    📂 {f.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
        <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
      </div>
    </div>
  )
}
