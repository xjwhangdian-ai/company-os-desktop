import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { AgentName, ChatAttachment, ChatMessage, ToolUseSummary } from '@shared/agent-types'
import type { AgentStreamEvent } from '@shared/stream-events'
import { useIdentityStore } from './useIdentityStore'

interface ChatSession {
  messages: ChatMessage[]
  sdkSessionId?: string
  isRunning: boolean
  runId?: string
}

interface ChatState {
  /** 会话按 sessionKey 分桶：默认等于分身名；招投标等场景传 `bidding::{项目文件夹}` 让每个项目各有独立对话 */
  sessions: Record<string, ChatSession>
  listenerInitialized: boolean
  runIdToSessionKey: Record<string, string>
  initListener: () => void
  sendMessage: (
    agentName: AgentName,
    sessionKey: string,
    text: string,
    attachments?: ChatAttachment[]
  ) => Promise<void>
  cancelRun: (sessionKey: string) => Promise<void>
}

function emptySession(): ChatSession {
  return { messages: [], isRunning: false }
}

/** 找到最后一条 assistant 消息并用 updater 不可变地替换它；找不到则原样返回 messages */
function updateLastAssistantMessage(
  messages: ChatMessage[],
  updater: (msg: ChatMessage) => ChatMessage
): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return messages
  return [...messages.slice(0, -1), updater(last)]
}

/** 从最后一条往前找持有该 tool-use id 的消息，不可变地更新那一条里的 toolUses 数组 */
function updateToolUse(
  messages: ChatMessage[],
  id: string,
  updater: (tool: ToolUseSummary) => ToolUseSummary
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const idx = msg.toolUses?.findIndex((t) => t.id === id) ?? -1
    if (idx >= 0 && msg.toolUses) {
      const newToolUses = [...msg.toolUses]
      newToolUses[idx] = updater(newToolUses[idx])
      const newMessages = [...messages]
      newMessages[i] = { ...msg, toolUses: newToolUses }
      return newMessages
    }
  }
  return messages
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: {},
  listenerInitialized: false,
  runIdToSessionKey: {},

  initListener: () => {
    if (get().listenerInitialized) return
    set({ listenerInitialized: true })

    window.api.agentRun.onEvent((runId: string, event: AgentStreamEvent) => {
      const sessionKey = get().runIdToSessionKey[runId]
      if (!sessionKey) return

      set((state) => {
        const session = state.sessions[sessionKey]
        if (!session) return state

        const replaceSession = (patch: Partial<ChatSession>): Partial<ChatState> => ({
          sessions: { ...state.sessions, [sessionKey]: { ...session, ...patch } }
        })

        switch (event.type) {
          case 'init':
            return replaceSession({ sdkSessionId: event.sessionId })

          case 'text-delta':
            return replaceSession({
              messages: updateLastAssistantMessage(session.messages, (m) => ({ ...m, text: m.text + event.text }))
            })

          case 'tool-use-start':
            return replaceSession({
              messages: updateLastAssistantMessage(session.messages, (m) => ({
                ...m,
                toolUses: [...(m.toolUses ?? []), { id: event.id, name: event.name, input: undefined, status: 'running' }]
              }))
            })

          case 'tool-use-input':
            return replaceSession({
              messages: updateToolUse(session.messages, event.id, (t) => ({ ...t, input: event.input }))
            })

          case 'tool-result':
            return replaceSession({
              messages: updateToolUse(session.messages, event.id, (t) => ({
                ...t,
                status: event.isError ? 'error' : 'done',
                resultSummary: event.summary
              }))
            })

          case 'permission-denied':
            return replaceSession({
              messages: updateLastAssistantMessage(session.messages, (m) => ({
                ...m,
                toolUses: [
                  ...(m.toolUses ?? []),
                  { id: uuid(), name: event.toolName, input: undefined, status: 'error', resultSummary: event.reason }
                ]
              }))
            })

          case 'result':
            return replaceSession({
              isRunning: false,
              messages: updateLastAssistantMessage(session.messages, (m) => ({
                ...m,
                streaming: false,
                error: event.isError ? (event.errorMessage ?? '执行出错') : undefined
              }))
            })

          case 'fatal-error':
            return replaceSession({
              isRunning: false,
              messages: updateLastAssistantMessage(session.messages, (m) => ({
                ...m,
                streaming: false,
                error: event.message
              }))
            })

          default:
            return state
        }
      })
    })
  },

  sendMessage: async (agentName, sessionKey, text, attachments) => {
    const runId = uuid()
    const session = get().sessions[sessionKey] ?? emptySession()

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      text,
      attachments,
      createdAt: Date.now()
    }
    const assistantPlaceholder: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      text: '',
      toolUses: [],
      createdAt: Date.now(),
      streaming: true
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionKey]: {
          ...session,
          isRunning: true,
          runId,
          messages: [...session.messages, userMsg, assistantPlaceholder]
        }
      },
      runIdToSessionKey: { ...state.runIdToSessionKey, [runId]: sessionKey }
    }))

    let prompt = text
    if (attachments && attachments.length > 0) {
      const fileList = attachments.map((a) => `- ${a.relativePath}`).join('\n')
      prompt = `${text}\n\n(已上传以下文件，请用 Read 工具读取)\n${fileList}`
    }

    try {
      const userName = useIdentityStore.getState().currentUser?.name
      await window.api.agentRun.start({ runId, agentName, prompt, resumeSessionId: session.sdkSessionId, userName })
    } catch (err) {
      set((state) => {
        const s = state.sessions[sessionKey]
        if (!s) return state
        return {
          sessions: {
            ...state.sessions,
            [sessionKey]: {
              ...s,
              isRunning: false,
              messages: updateLastAssistantMessage(s.messages, (m) => ({
                ...m,
                streaming: false,
                error: err instanceof Error ? err.message : String(err)
              }))
            }
          }
        }
      })
    }
  },

  cancelRun: async (sessionKey) => {
    const session = get().sessions[sessionKey]
    if (session?.runId) {
      await window.api.agentRun.cancel(session.runId)
    }
  }
}))
