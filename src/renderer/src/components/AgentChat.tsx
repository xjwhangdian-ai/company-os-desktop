import { useEffect, useRef, useState } from 'react'
import type { AgentDisplayMeta, ChatAttachment, AgentName } from '@shared/agent-types'
import { useChatStore } from '../stores/useChatStore'
import { ChatBubble } from './ChatBubble'
import { FileDropzone } from './FileDropzone'
import { CommandQuickButtons } from './CommandQuickButtons'
import { HelpButton } from './HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

interface AgentChatProps {
  agent: AgentDisplayMeta
  /** 会话分桶键：默认按分身名共用一个对话；招投标按项目传 `bidding::{项目文件夹}`，每个项目独立对话 */
  sessionKey?: string
  /** 上传文件落哪个目录：默认 inbox/，bidding 场景可传 biddingRoot */
  uploadFn?: (sourcePath: string) => ReturnType<typeof window.api.upload.generic>
  /** 外部注入待发送草稿（如工作台的快捷动作按钮），填入输入框后清空，不自动发送 */
  pendingPrompt?: string | null
  onPendingPromptConsumed?: () => void
  /** 外部注入待发送附件（如运营页的素材上传区），合并进输入框旁的附件列表，不自动发送 */
  pendingAttachments?: ChatAttachment[] | null
  onPendingAttachmentsConsumed?: () => void
}

export function AgentChat({
  agent,
  sessionKey: sessionKeyProp,
  uploadFn,
  pendingPrompt,
  onPendingPromptConsumed,
  pendingAttachments: injectedAttachments,
  onPendingAttachmentsConsumed
}: AgentChatProps): React.JSX.Element {
  const sessionKey = sessionKeyProp ?? agent.name
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const session = useChatStore((s) => s.sessions[sessionKey])
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelRun = useChatStore((s) => s.cancelRun)
  const initListener = useChatStore((s) => s.initListener)

  useEffect(() => {
    initListener()
  }, [initListener])

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt)
      onPendingPromptConsumed?.()
    }
  }, [pendingPrompt, onPendingPromptConsumed])

  useEffect(() => {
    if (injectedAttachments && injectedAttachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...injectedAttachments])
      onPendingAttachmentsConsumed?.()
    }
  }, [injectedAttachments, onPendingAttachmentsConsumed])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session?.messages.length, session?.messages[session.messages.length - 1]?.text])

  const isRunning = session?.isRunning ?? false

  function handleSend(): void {
    const text = input.trim()
    if (!text || isRunning) return
    sendMessage(agent.name as AgentName, sessionKey, text, pendingAttachments.length > 0 ? pendingAttachments : undefined)
    setInput('')
    setPendingAttachments([])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="app-drag flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{agent.displayName}</h2>
          <p className="text-xs text-slate-400">{agent.role}</p>
        </div>
        <div className="app-no-drag flex items-center gap-2">
          {isRunning && (
            <button
              onClick={() => cancelRun(sessionKey)}
              className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-500 hover:bg-red-50"
            >
              停止
            </button>
          )}
          <HelpButton content={HELP_CONTENT.agentChat} />
        </div>
      </div>

      <CommandQuickButtons agentName={agent.name as AgentName} onPick={setInput} />

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {(!session || session.messages.length === 0) && (
          <div className="flex h-full items-center justify-center text-sm text-slate-300">
            对{agent.displayName}说说你需要什么帮助——{agent.whenToUse}
          </div>
        )}
        {session?.messages.map((m) => <ChatBubble key={m.id} message={m} />)}
      </div>

      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 bg-slate-50 px-5 py-2">
          {pendingAttachments.map((a) => (
            <span key={a.path} className="rounded bg-white border border-slate-200 px-2 py-0.5 text-xs text-slate-500">
              📎 {a.fileName}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-4">
        <FileDropzone
          compact
          uploadFn={uploadFn ?? ((p: string) => window.api.upload.generic(agent.name, p))}
          onUploaded={(atts) => setPendingAttachments((prev) => [...prev, ...atts])}
        />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="输入你的需求，Enter 发送，Shift+Enter 换行…（拖右下角可调大输入框）"
          rows={1}
          className="min-h-[40px] max-h-80 flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
        />
        <button
          onClick={handleSend}
          disabled={isRunning || !input.trim()}
          className="shrink-0 rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {isRunning ? '进行中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
