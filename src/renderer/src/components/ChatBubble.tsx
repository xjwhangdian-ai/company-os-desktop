import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@shared/agent-types'

const TOOL_LABEL: Record<string, string> = {
  Read: '读取文件',
  Write: '写入文件',
  Edit: '编辑文件',
  Grep: '搜索内容',
  Glob: '查找文件',
  Bash: '执行命令',
  WebSearch: '联网搜索',
  NotebookEdit: '编辑 Notebook'
}

function ToolChip({ tool }: { tool: NonNullable<ChatMessage['toolUses']>[number] }): React.JSX.Element {
  const label = TOOL_LABEL[tool.name] ?? tool.name
  const filePath =
    tool.input && typeof tool.input === 'object' && tool.input !== null && 'file_path' in tool.input
      ? String((tool.input as Record<string, unknown>).file_path)
      : undefined

  const dotColor = tool.status === 'running' ? 'bg-amber-400 animate-pulse' : tool.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span className="font-medium">{label}</span>
      {filePath && <span className="truncate text-slate-400">{filePath}</span>}
      {tool.status === 'error' && tool.resultSummary && <span className="text-red-500 truncate">{tool.resultSummary}</span>}
    </div>
  )
}

export function ChatBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : ''}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser ? 'bg-jushi-accent text-white rounded-br-sm' : 'bg-white border border-slate-200 rounded-bl-sm'
          }`}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((a) => (
                <span
                  key={a.path}
                  className={`text-xs rounded px-2 py-0.5 ${isUser ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}
                >
                  📎 {a.fileName}
                </span>
              ))}
            </div>
          )}

          {message.toolUses && message.toolUses.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {message.toolUses.map((t) => (
                <ToolChip key={t.id} tool={t} />
              ))}
            </div>
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : message.text ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
            </div>
          ) : message.streaming ? (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
            </span>
          ) : null}

          {message.streaming && message.text && <span className="inline-block w-1.5 h-3.5 bg-slate-400 ml-0.5 animate-pulse align-text-bottom" />}

          {message.error && (
            <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-600">
              ⚠️ {message.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
