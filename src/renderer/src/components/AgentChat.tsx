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
  /** 为 true 时 pendingPrompt 直接自动发送（分身空闲时），不经输入框；分身正忙则退回填输入框 */
  pendingAutoSend?: boolean
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
  pendingAutoSend,
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
      if (pendingAutoSend && !(session?.isRunning ?? false)) {
        // 直发模式（如画册抠图的核对任务）：跳过输入框直接发给分身；分身正忙则退回填输入框
        sendMessage(agent.name as AgentName, sessionKey, pendingPrompt.trim())
      } else {
        setInput(pendingPrompt)
      }
      onPendingPromptConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, pendingAutoSend, onPendingPromptConsumed])

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

      {/* 输入区顶部拖拉条：鼠标按住横线向上/向下拖，直接调输入框可视高度（与右下角手柄等效，更好抓） */}
      <div
        title="按住向上拖动，调大输入框（高度全分身同步）"
        className="group flex h-2 shrink-0 cursor-ns-resize items-center justify-center border-t border-slate-200 bg-white hover:bg-slate-100"
        onMouseDown={(e) => {
          e.preventDefault()
          const container = (e.currentTarget.nextElementSibling as HTMLElement) ?? null
          const ta = container?.querySelector('textarea')
          if (!ta) return
          const startY = e.clientY
          const startH = ta.offsetHeight
          const onMove = (me: MouseEvent): void => {
            const h = Math.min(600, Math.max(40, startH + (startY - me.clientY)))
            ta.style.height = `${h}px`
          }
          const onUp = (): void => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            if (ta.offsetHeight >= 40) localStorage.setItem('agentChatInputHeight', `${ta.offsetHeight}px`)
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      >
        <span className="h-0.5 w-10 rounded bg-slate-300 group-hover:bg-jushi-accent" />
      </div>
      <div className="flex items-end gap-2 bg-white p-4 pt-2">
        <FileDropzone
          compact
          uploadFn={uploadFn ?? ((p: string) => window.api.upload.generic(agent.name, p))}
          onUploaded={(atts) => setPendingAttachments((prev) => [...prev, ...atts])}
        />
        <textarea
          ref={(el) => {
            if (!el) return
            // 输入框高度全分身同步：读共享高度；拖动调节松手后写回，所有分身下次渲染同高
            const saved = localStorage.getItem('agentChatInputHeight')
            if (saved && el.style.height !== saved) el.style.height = saved
            el.onmouseup = () => {
              if (el.offsetHeight >= 40) localStorage.setItem('agentChatInputHeight', `${el.offsetHeight}px`)
            }
          }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="输入你的需求，Enter 发送，Shift+Enter 换行…（拖右下角可上下调节，大小全分身同步）"
          rows={1}
          className="min-h-[40px] max-h-[600px] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
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
