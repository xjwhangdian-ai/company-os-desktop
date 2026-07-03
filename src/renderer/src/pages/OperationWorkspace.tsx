import { useState } from 'react'
import type { AgentDisplayMeta, ChatAttachment, OutputEntry } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { FileDropzone } from '../components/FileDropzone'
import { OutputsPanel } from '../components/OutputsPanel'
import { GzhStyleButton } from '../components/GzhStyleButton'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

type Platform = '小红书' | '微信公众号'

const PLATFORM_PROMPTS: Record<Platform, string> = {
  小红书:
    '生成一篇小红书笔记文案。风格要求：口语化、emoji 适度点缀、开头 3 秒抓人的钩子、正文分点或分段清晰、结尾带 3-8 个相关话题标签(#xxx)。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕',
  微信公众号:
    '生成一篇公众号推文图文。按标准结构：标题(2-3个备选)+摘要 → 痛点引入 → 场景/方案 → 价值/数据(标来源) → 行动引导 → 配图建议。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕'
}

export function OperationWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [platform, setPlatform] = useState<Platform>('小红书')
  const [mediaAttachments, setMediaAttachments] = useState<ChatAttachment[]>([])
  const [injectedPrompt, setInjectedPrompt] = useState<string | null>(null)
  const [injectedAttachments, setInjectedAttachments] = useState<ChatAttachment[] | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  function handleGenerate(): void {
    setInjectedPrompt(PLATFORM_PROMPTS[platform])
    if (mediaAttachments.length > 0) {
      setInjectedAttachments(mediaAttachments)
      setMediaAttachments([])
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">运营推广素材与生成</h2>
            <HelpButton content={HELP_CONTENT.operation} />
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">素材：</span>
            <FileDropzone compact uploadFn={(p) => window.api.upload.generic(p)} onUploaded={(a) => setMediaAttachments((prev) => [...prev, ...a])} />
            {mediaAttachments.map((a) => (
              <span key={a.path} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                📎 {a.fileName}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">平台：</span>
            {(['小红书', '微信公众号'] as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  platform === p ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={handleGenerate}
              className="ml-2 rounded-full bg-jushi-accent px-3 py-1 text-xs font-medium text-white"
            >
              ✍️ 生成内容
            </button>
          </div>
        </div>

        {platform === '微信公众号' && <GzhStyleButton />}

        <div className="flex-1 overflow-hidden">
          <AgentChat
            agent={agent}
            pendingPrompt={injectedPrompt}
            onPendingPromptConsumed={() => setInjectedPrompt(null)}
            pendingAttachments={injectedAttachments}
            onPendingAttachmentsConsumed={() => setInjectedAttachments(null)}
          />
        </div>
      </div>

      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-80' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/operation</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel
                agentName="operation"
                refreshKey={refreshKey}
                extraFileAction={(entry: OutputEntry) =>
                  entry.name.endsWith('.md') ? (
                    <button
                      onClick={async () => {
                        const html = await window.api.gzh.runStyle(entry.path)
                        await window.api.shell.openPath(html)
                        setRefreshKey((k) => k + 1)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                      title="按公众号固定风格一键排版（小红书内容一般不需要这步）"
                    >
                      排版
                    </button>
                  ) : null
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
