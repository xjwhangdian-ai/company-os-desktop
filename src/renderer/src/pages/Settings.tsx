import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/useConfigStore'
import type { ModelMapping, ProviderId } from '@shared/agent-types'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'deepseek', 'minimax-intl', 'minimax-cn', 'qwen', 'custom']

const PROVIDER_DOCS: Partial<Record<ProviderId, { label: string; url: string }>> = {
  deepseek: { label: 'DeepSeek · Claude Code 接入文档', url: 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code' },
  'minimax-intl': { label: 'MiniMax · Claude Code 接入文档', url: 'https://platform.minimax.io/docs/token-plan/claude-code' },
  'minimax-cn': { label: 'MiniMax · Claude Code 接入文档', url: 'https://platform.minimax.io/docs/token-plan/claude-code' },
  qwen: { label: '阿里云百炼 · Claude Code 接入文档', url: 'https://www.alibabacloud.com/help/en/model-studio/claude-code' }
}

const PROVIDER_HINTS: Partial<Record<ProviderId, string>> = {
  deepseek:
    '模型映射默认沿用 Anthropic 的模型名——DeepSeek 官方文档说明 claude-opus-* 系列会在服务端自动重映射到 deepseek-v4-pro，claude-sonnet-*/claude-haiku-* 重映射到 deepseek-v4-flash，一般不用改。',
  'minimax-intl': 'MiniMax 当前对外模型名会变动，请打开右侧文档链接确认当前可用的模型名后再填，不要照抄旧文档里的名字。',
  'minimax-cn': 'MiniMax 当前对外模型名会变动，请打开右侧文档链接确认当前可用的模型名后再填，不要照抄旧文档里的名字。',
  qwen: 'Base URL 和模型名会随地区/套餐变化，务必以阿里云百炼当前文档为准——不要照抄网上找到的旧地址，可能已经失效。',
  custom: '适用于任何自建/自托管的 Anthropic 协议兼容端点（比如自己起一个 claude-code-router）。'
}

export function Settings(): React.JSX.Element {
  const { config, addCompany, removeCompany, pickCompanyDataDir, setActiveCompany, setActiveProvider, saveProviderConfig } =
    useConfigStore()
  const [viewingId, setViewingId] = useState<ProviderId>('anthropic')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [mapping, setMapping] = useState<ModelMapping>({ opus: '', sonnet: '', haiku: '' })
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')

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

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">设置</h1>
          <p className="mt-1 text-sm text-slate-400">配置数据目录、选择模型供应商并填好 API Key 后即可使用全部 9 个分身。</p>
        </div>
        <HelpButton content={HELP_CONTENT.settings} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-700">公司管理</h3>
        <p className="text-xs text-slate-400">
          每家公司对应一个独立的 company-os 数据目录（含 knowledge/、bidding/、outputs/、法务/、.claude/）。登录页可以下拉切换公司，模型供应商/团队成员配置是全局共用的，不按公司区分。
        </p>
        <div className="space-y-2">
          {config.companies.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-2 rounded-lg border p-2 ${
                config.activeCompanyId === c.id ? 'border-jushi-accent bg-blue-50' : 'border-slate-200 bg-white'
              }`}
            >
              <button
                onClick={() => setActiveCompany(c.id)}
                className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${
                  config.activeCompanyId === c.id ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
                }`}
              >
                {config.activeCompanyId === c.id ? '当前使用中' : '设为当前'}
              </button>
              <span className="w-28 shrink-0 truncate text-sm font-medium text-slate-700">{c.name}</span>
              <span className="flex-1 truncate text-xs text-slate-400">{c.dataDir ?? '尚未配置数据目录'}</span>
              <button
                onClick={() => pickCompanyDataDir(c.id)}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                选择目录
              </button>
              <button
                onClick={() => removeCompany(c.id)}
                className="shrink-0 text-xs text-slate-300 hover:text-red-500"
                title="从列表移除（不会删除实际文件夹）"
              >
                ✕
              </button>
            </div>
          ))}
          {config.companies.length === 0 && <p className="py-3 text-center text-xs text-slate-400">还没有添加任何公司</p>}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newCompanyName}
            onChange={(e) => setNewCompanyName(e.target.value)}
            placeholder="新公司名称"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
          />
          <button
            onClick={() => {
              if (!newCompanyName.trim()) return
              addCompany(newCompanyName.trim())
              setNewCompanyName('')
            }}
            className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            ＋ 添加公司
          </button>
        </div>
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

      {savedHint && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {savedHint}
        </div>
      )}
    </div>
  )
}
