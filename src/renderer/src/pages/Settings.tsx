import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/useConfigStore'
import { useIdentityStore } from '../stores/useIdentityStore'
import type { ModelMapping, ProviderId } from '@shared/agent-types'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'deepseek', 'kimi', 'minimax-cn', 'qwen', 'zhipu', 'custom']

const PROVIDER_DOCS: Partial<Record<ProviderId, { label: string; url: string }>> = {
  deepseek: { label: 'DeepSeek · Claude Code 接入文档', url: 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code' },
  kimi: { label: 'Moonshot 开放平台 · Claude Code 接入文档', url: 'https://platform.moonshot.cn/docs/guide/agent-support' },
  'minimax-cn': { label: 'MiniMax · Claude Code 接入文档', url: 'https://platform.minimax.io/docs/token-plan/claude-code' },
  qwen: { label: '阿里云百炼 · Claude Code 接入文档', url: 'https://www.alibabacloud.com/help/en/model-studio/claude-code' },
  zhipu: { label: '智谱开放平台 · Claude Code 接入文档', url: 'https://docs.bigmodel.cn/cn/guide/develop/claude' }
}

const PROVIDER_HINTS: Partial<Record<ProviderId, string>> = {
  deepseek: 'DeepSeek 目前只有两档：deepseek-v4-pro（旗舰）/ deepseek-v4-flash（性价比档，sonnet 和 haiku 都用它）。旧别名 deepseek-chat/deepseek-reasoner 将于 2026-07-24 停用，不要用。模型迭代快，用之前最好点右侧文档确认一下是否有新模型。',
  kimi: '月之暗面官方提供 Anthropic 协议兼容端点（Kimi 接 Claude Code 的官方方式），国内 Base URL 已预填 api.moonshot.cn/anthropic（国际版账号改 api.moonshot.ai）。模型按 K2 系列预填：kimi-k2-thinking-turbo（旗舰推理档）/ kimi-k2-turbo-preview（高速主力档）。Kimi 迭代快，用之前点右侧文档核对最新模型名。',
  'minimax-cn':
    '已按 2026-07 官方文档预填：MiniMax-M3（旗舰，原生多模态）/ MiniMax-M2.7（主力档）/ MiniMax-M2（最便宜档）。模型迭代快，用之前最好点右侧文档确认一下是否有新模型。',
  qwen: '已按 2026-07 官方文档预填模型名：qwen3.7-max（旗舰）/ qwen3.7-plus（主力档）/ qwen3.6-flash（最便宜档）。Base URL 没有唯一默认值——阿里云这个端点按地区/套餐分裂成好几种，常见几种：国内 PAYG「https://dashscope.aliyuncs.com/apps/anthropic」、国际 PAYG「https://dashscope-intl.aliyuncs.com/apps/anthropic」、Coding Plan「https://coding-intl.dashscope.aliyuncs.com/apps/anthropic」——对着自己开通的套餐选，不确定就点右侧文档核实。',
  zhipu: '智谱官方提供 Anthropic 协议兼容端点（GLM 接 Claude Code 的官方方式），Base URL 已预填。模型名按官方文档预填 glm-4.5（旗舰）/ glm-4.5-air（轻量）——智谱迭代快，若已发布更新一代（如 glm-5 系列），点右侧文档确认后改成最新模型名即可。',
  custom: '适用于任何自建/自托管的 Anthropic 协议兼容端点（比如自己起一个 claude-code-router）。'
}

export function Settings(): React.JSX.Element {
  const { config, pickCompanyDataDir, setActiveProvider, saveProviderConfig } = useConfigStore()
  const [viewingId, setViewingId] = useState<ProviderId>('anthropic')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [mapping, setMapping] = useState<ModelMapping>({ opus: '', sonnet: '', haiku: '' })
  const [savedHint, setSavedHint] = useState<string | null>(null)

  useEffect(() => {
    if (config) setViewingId(config.activeProviderId)
  }, [config?.activeProviderId]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewingProvider = config?.providers[viewingId]

  useEffect(() => {
    if (!viewingProvider) return
    setBaseUrlInput(viewingProvider.baseUrl ?? '')
    setMapping(viewingProvider.modelMapping)
    setApiKeyInput('')
  }, [viewingProvider])

  function flashSaved(text: string): void {
    setSavedHint(text)
    setTimeout(() => setSavedHint(null), 2000)
  }

  async function handleSelectProvider(id: ProviderId): Promise<void> {
    setViewingId(id)
    await setActiveProvider(id)
    flashSaved(`已切换到 ${config?.providers[id]?.label ?? id}`)
  }

  async function handleSaveProvider(): Promise<void> {
    if (!viewingProvider) return
    const patch: Parameters<typeof saveProviderConfig>[1] = {
      modelMapping: mapping
    }
    if (apiKeyInput.trim()) patch.apiKey = apiKeyInput.trim()
    if (viewingProvider.baseUrl !== null) patch.baseUrl = baseUrlInput.trim()
    await saveProviderConfig(viewingId, patch)
    setApiKeyInput('')
    flashSaved(`${viewingProvider.label} 配置已保存`)
  }

  if (!config || !viewingProvider) {
    return <div className="p-8 text-sm text-slate-400">加载中…</div>
  }

  const doc = PROVIDER_DOCS[viewingId]
  const hint = PROVIDER_HINTS[viewingId]
  const company = config.companies[0] ?? null

  return (
    // 外层负责滚动：main 区域是 overflow-hidden，设置页内容超一屏时必须自己滚，
    // 否则底部的"保存"按钮会被裁掉够不着
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 p-8 pb-24">
      <div className="app-drag flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">设置</h1>
          <p className="mt-1 text-sm text-slate-400">配置数据目录、选择模型供应商并填好 API Key 后即可使用全部 9 个分身。</p>
        </div>
        <div className="app-no-drag">
          <HelpButton content={HELP_CONTENT.settings} />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-700">数据目录</h3>
        <p className="text-xs text-slate-400">
          工作台的全部数据都存在这个 company-os 目录里（含 knowledge/、bidding/、outputs/、法务/、.claude/）。模型供应商/团队成员配置全局共用。
        </p>
        {company ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <span className="w-28 shrink-0 truncate text-sm font-medium text-slate-700">{company.name}</span>
            <span className="flex-1 truncate text-xs text-slate-400">{company.dataDir ?? '尚未配置数据目录'}</span>
            <button
              onClick={() => pickCompanyDataDir(company.id)}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              选择目录
            </button>
            {!company.dataDir && (
              <button
                onClick={async () => {
                  const r = await window.api.config.initDataDir(company.id)
                  flashSaved(r.说明)
                  if (r.ok) await useConfigStore.getState().load()
                }}
                title="没有现成的 company-os 文件夹？从安装包内置模板初始化一个全新数据目录（含 knowledge/9个分身定义/目录骨架）"
                className="shrink-0 rounded-md border border-jushi-accent px-2 py-1 text-xs text-jushi-accent hover:bg-jushi-accent/5"
              >
                初始化目录
              </button>
            )}
          </div>
        ) : (
          <p className="py-3 text-center text-xs text-slate-400">还没有数据目录——请回登录页创建公司后再来配置</p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-slate-700">模型供应商</h3>
          <p className="text-xs text-slate-400">
            DeepSeek / MiniMax / Qwen 官方都提供了原生兼容 Anthropic 协议的端点，可以直接切换使用，不用另外起代理。切换后对全部
            9 个分身生效。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PROVIDER_ORDER.map((id) => {
            const p = config.providers[id]
            const active = config.activeProviderId === id
            const viewing = viewingId === id
            return (
              <button
                key={id}
                onClick={() => handleSelectProvider(id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-jushi-accent bg-jushi-accent text-white'
                    : viewing
                      ? 'border-jushi-accent text-jushi-accent'
                      : 'border-slate-300 text-slate-500 hover:border-slate-400'
                }`}
              >
                {p.label}
                {active && ' ✓'}
              </button>
            )
          })}
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">{viewingProvider.label} 配置</h4>
            {doc && (
              <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-jushi-accent hover:underline">
                {doc.label} →
              </a>
            )}
          </div>

          {hint && <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">⚠️ {hint}</p>}

          {viewingProvider.baseUrl !== null && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Base URL</label>
              <input
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-jushi-accent"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-slate-500">API Key</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={viewingProvider.apiKey ? '已配置（留空保存不会清除）' : '在此粘贴密钥'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">
              模型映射（分身 frontmatter 里的 opus/sonnet/haiku 别名 → 该供应商的真实模型名）
            </label>
            <div className="space-y-1.5">
              {(['opus', 'sonnet', 'haiku'] as const).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs text-slate-400">{key}</span>
                  <input
                    value={mapping[key]}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                    placeholder="待确认，参考右上角文档链接"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-jushi-accent"
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveProvider}
            className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white"
          >
            保存此供应商配置
          </button>
        </div>
      </section>

      <MemberSection onFlash={flashSaved} />

      <AboutSection onFlash={flashSaved} />

      {savedHint && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {savedHint}
        </div>
      )}
      </div>
    </div>
  )
}

/** 关于与更新：显示当前版本 + 手动检查 GitHub Releases；有新版时下载安装（与顶部横幅同一套逻辑） */
function AboutSection({ onFlash }: { onFlash: (t: string) => void }): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.api.update.check>> | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [tokenSet, setTokenSet] = useState(false)

  useEffect(() => {
    window.api.update.getTokenSet().then(setTokenSet)
  }, [])

  useEffect(() => {
    if (!downloading) return
    return window.api.update.onProgress((p) => setPct(p.pct))
  }, [downloading])

  async function handleCheck(): Promise<void> {
    setChecking(true)
    try {
      const r = await window.api.update.check()
      setInfo(r)
      onFlash(r.说明)
    } catch (err) {
      onFlash(`检查失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  async function handleUpdate(): Promise<void> {
    if (!info) return
    setDownloading(true)
    setPct(0)
    try {
      const r = await window.api.update.download(info)
      onFlash(r.说明)
    } finally {
      setDownloading(false)
      setPct(null)
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-slate-700">关于与更新</h3>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs text-slate-500">
          当前版本 <b className="font-mono">v{info?.current ?? '…'}</b>
          {info?.hasUpdate && (
            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              有新版 v{info.latest}
            </span>
          )}
        </span>
        <button
          disabled={checking}
          onClick={handleCheck}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50"
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
        {info?.hasUpdate && (
          <button
            disabled={downloading}
            onClick={handleUpdate}
            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {downloading ? `下载中…${pct !== null && pct >= 0 ? ` ${pct}%` : ''}` : '立即更新'}
          </button>
        )}
        <span className="text-[11px] text-slate-400">
          自动对比 GitHub Releases；启动 8 秒后也会静默检查一次，有新版在窗口顶部提示。
        </span>
      </div>
      {tokenSet && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <span className="text-xs text-slate-500">
            GitHub Token <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">已配置</span>
          </span>
          <button
            onClick={async () => {
              await window.api.update.setToken(null)
              setTokenSet(false)
              onFlash('Token 已清除')
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-red-300 hover:text-red-500"
          >
            清除
          </button>
          <span className="w-full text-[11px] leading-snug text-slate-400">
            App 仓库已设为 Public，检查/下载更新不再需要 Token——之前配置的 Token 可以清除（保留也不影响）。
          </span>
        </div>
      )}
    </section>
  )
}

/** 团队成员与角色管理（仅管理员看得到设置页）。轻量权限：界面级区分，不是安全体系。 */
function MemberSection({ onFlash }: { onFlash: (text: string) => void }): React.JSX.Element {
  const { members, loadMembers, removeMember, currentUser } = useIdentityStore()

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-slate-700">团队成员与角色</h3>
      <p className="text-xs text-slate-400">
        账号由管理员在这里统一分配，初始 PIN 都是 <b>123456</b>（成员首次登录会被提示修改）。
        管理员：可进设置页、可见全部 9 个分身。普通员工：只见分配给 TA 的分身（不勾选=全部可见）。此为界面级权限，不是安全体系。
      </p>
      <AddMemberInline onFlash={onFlash} />
      <div className="space-y-1.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs font-semibold text-white">
              {m.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
              {m.name}
              {currentUser?.id === m.id && <span className="ml-1 text-xs text-slate-400">（我）</span>}
              {!m.hasPin && m.role === 'admin' && (
                <span className="ml-1 text-xs text-amber-600">未设 PIN，建议管理员设置</span>
              )}
            </span>
            <select
              value={m.role}
              onChange={async (e) => {
                const r = await window.api.identity.setRole(m.id, e.target.value as 'admin' | 'member')
                if (!r.ok) onFlash(r.message ?? '修改失败')
                else onFlash(`${m.name} 已设为${e.target.value === 'admin' ? '管理员' : '普通员工'}`)
                await loadMembers()
              }}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 outline-none"
            >
              <option value="admin">管理员</option>
              <option value="member">普通员工</option>
            </select>
            <button
              onClick={async () => {
                await window.api.identity.resetPin(m.id)
                onFlash(`${m.name} 的 PIN 已重置为 123456`)
                await loadMembers()
              }}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-amber-400 hover:text-amber-600"
              title="忘记 PIN 时用：重置回初始 123456"
            >
              重置PIN
            </button>
            <button
              onClick={async () => {
                await removeMember(m.id)
                onFlash(`已移除 ${m.name}`)
              }}
              className="shrink-0 text-xs text-slate-300 hover:text-red-500"
              disabled={currentUser?.id === m.id}
              title={currentUser?.id === m.id ? '不能移除当前登录的自己' : '移除成员'}
            >
              移除
            </button>
          </div>
        ))}
        {members.filter((m) => m.role === 'member').map((m) => (
          <AgentVisibilityRow key={`agents-${m.id}`} memberId={m.id} memberName={m.name} 可见分身={m.可见分身} onFlash={onFlash} />
        ))}
        {members.length === 0 && <p className="py-2 text-center text-xs text-slate-400">暂无成员</p>}
      </div>
    </section>
  )
}


/** 管理员分配新账号：名字+角色；初始 PIN 固定 123456 */
function AddMemberInline({ onFlash }: { onFlash: (text: string) => void }): React.JSX.Element {
  const addMember = useIdentityStore((s) => s.addMember)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="新成员名字"
        className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none"
      >
        <option value="member">普通员工</option>
        <option value="admin">管理员</option>
      </select>
      <button
        onClick={async () => {
          if (!name.trim()) return
          await addMember(name.trim(), role)
          onFlash(`已添加 ${name.trim()}（初始 PIN 123456）`)
          setName('')
        }}
        className="shrink-0 rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white"
      >
        ＋ 分配账号
      </button>
    </div>
  )
}

const ALL_AGENTS: { name: import('@shared/agent-types').AgentName; label: string }[] = [
  { name: 'sales', label: '销售' },
  { name: 'solution', label: '解决方案' },
  { name: 'bidding', label: '招投标' },
  { name: 'legal', label: '法务' },
  { name: 'operation', label: '运营' },
  { name: 'brand', label: '品牌' },
  { name: 'ops-policy', label: '行政人力' },
  { name: 'finance', label: '财务' },
  { name: 'intel', label: '行业情报' }
]

/** 员工的可见分身勾选行：全不勾/全勾 = 全部可见（存 null） */
function AgentVisibilityRow({
  memberId,
  memberName,
  可见分身,
  onFlash
}: {
  memberId: string
  memberName: string
  可见分身?: import('@shared/agent-types').AgentName[]
  onFlash: (text: string) => void
}): React.JSX.Element {
  const loadMembers = useIdentityStore((s) => s.loadMembers)
  const selected = new Set(可见分身 ?? ALL_AGENTS.map((a) => a.name))

  async function toggle(agent: import('@shared/agent-types').AgentName): Promise<void> {
    const next = new Set(selected)
    if (next.has(agent)) next.delete(agent)
    else next.add(agent)
    // 全选（或全不选）视为"全部可见"，存 null 保持向后兼容
    const arr = next.size === 0 || next.size === ALL_AGENTS.length ? null : [...next]
    await window.api.identity.setAgents(memberId, arr)
    onFlash(`${memberName} 可见分身已更新${arr ? `（${arr.length} 个）` : '（全部）'}`)
    await loadMembers()
  }

  return (
    <div className="ml-8 flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-3 py-1.5">
      <span className="mr-1 text-[11px] text-slate-400">{memberName} 可见：</span>
      {ALL_AGENTS.map((a) => (
        <button
          key={a.name}
          onClick={() => toggle(a.name)}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            selected.has(a.name) ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-400'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
