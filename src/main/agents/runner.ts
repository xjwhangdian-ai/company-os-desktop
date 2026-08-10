import { query } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentName } from '@shared/agent-types'
import type { AgentStreamEvent } from '@shared/stream-events'
import { guardToolCall } from '../fs-io/path-guard'
import { archiveIfUnderOutputs } from '../fs-io/git-archive'
import { isStampablePath, stampProvenance } from '../fs-io/provenance'
import { loadAgentDefinitions } from './loader'
import { resolveModel } from '../config/model-mapping'
import { getActiveProvider } from '../config/store'
import { augmentedPath } from '../fs-io/env-check'

export interface RunAgentParams {
  agentName: AgentName
  prompt: string
  dataDir: string
  /** 延续同一个分身的多轮对话；不传则开新会话 */
  resumeSessionId?: string
  abortController: AbortController
  /** 当前登录的团队成员名字，用于给生成的产出文件盖操作人戳；不传则不盖 */
  userName?: string
}

export type { AgentStreamEvent }

/**
 * 打包版修复（spawn ENOTDIR）：SDK 默认按自身模块目录找原生 claude 可执行文件，
 * 打包后该目录在 app.asar **归档文件内部**，操作系统无法从归档里 spawn 子进程 → ENOTDIR。
 * electron-builder 已把二进制解包到 app.asar.unpacked，这里显式把 SDK 指过去。
 * 开发模式返回 undefined 走 SDK 默认解析（node_modules 是真实目录，没问题）。
 */
function resolveClaudeExecutable(): string | undefined {
  if (!app.isPackaged) return undefined
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const p = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai/claude-agent-sdk',
    'node_modules',
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
    bin
  )
  return existsSync(p) ? p : undefined
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 300)
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .join('')
      .slice(0, 300)
  }
  return ''
}

function mapAssistantErrorToMessage(err: string): string {
  const map: Record<string, string> = {
    authentication_failed: '未登录 / API Key 无效，请到设置页检查当前供应商的 API Key',
    oauth_org_not_allowed: '当前账号组织不允许使用该功能',
    billing_error: '账单异常，请检查当前供应商账户余额或付款方式',
    rate_limit: '触发速率限制，请稍后重试',
    overloaded: '服务当前过载，请稍后重试',
    invalid_request: '请求格式有误，若刚切换过供应商，检查一下模型映射里填的模型名是否是该供应商能识别的名称',
    model_not_found: '模型 ID 不存在，请检查设置页当前供应商的模型映射配置',
    server_error: '服务端错误，请稍后重试',
    unknown: '未知错误',
    max_output_tokens: '输出长度超限'
  }
  return map[err] ?? `调用出错：${err}`
}

/**
 * 封装 Agent SDK 的 query()：cwd 指向 company-os 数据目录 + settingSources: ['project']
 * 会让 SDK 自动发现 .claude/agents/*.md 里的全部 9 个分身定义（含各自的 system prompt /
 * tools / model），这里不重新解析/拼装 system prompt——那是 loader.ts 仅做 UI 展示的事。
 */
export async function* runAgent(params: RunAgentParams): AsyncGenerator<AgentStreamEvent> {
  const { agentName, prompt, dataDir, resumeSessionId, abortController, userName } = params
  /** Write/Edit 的 tool_use 请求先记下目标文件路径，等对应 tool_result 确认成功了再落地归档/盖戳——
   * 避免请求被拒绝或执行失败时也误把 git add / 操作人戳套用到一个其实没变化的文件上。 */
  const pendingFileWrites = new Map<string, { toolName: string; filePath: string }>()

  const canUseTool: CanUseTool = async (toolName, input) => {
    const guard = guardToolCall(toolName, input, dataDir)
    if (guard.allowed) {
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: guard.reason ?? '已拦截' }
  }

  // agent frontmatter 里的 model 字段（opus/sonnet/haiku 别名）经当前激活供应商的映射表解析成
  // 真实模型 ID，显式传给 options.model——这样切供应商/临时降级省成本时改设置页即可，
  // 不用碰 .claude/agents/*.md。
  // 注：agent: agentName 本身也会让 SDK 内部按 CLI 自带的别名表解析 model，两者同时传入时以谁为准
  // 未经真实调用验证过；这里选择显式传递是更符合"映射可配置"这条产品需求的保守做法。
  const agentDef = loadAgentDefinitions(dataDir).find((a) => a.name === agentName)
  const resolvedModel = resolveModel(agentDef?.model)

  const provider = getActiveProvider()
  if (provider.id === 'openai') {
    yield { type: 'fatal-error', message: 'ChatGPT 已加入供应商配置，但当前分身运行时仍是 Claude Agent SDK，不能直接调用 OpenAI Responses API。需完成 Codex/OpenAI 运行时迁移后才能实际调度分身；请暂时选择其他已兼容的供应商。' }
    return
  }
  if (!provider.apiKey) {
    yield { type: 'fatal-error', message: `尚未配置 ${provider.label} 的 API Key，请到设置页填写` }
    return
  }
  // baseUrl === null 是官方 Anthropic 预设，本来就不需要；非 null 但是空字符串
  // 说明用户选了 DeepSeek/MiniMax/Qwen/自定义 但还没填 Base URL——这种情况不能
  // 静默放过，否则请求会打到官方 Anthropic 端点，拿这个供应商的 key 去认证，
  // 报出"认证失败"这种文不对题的错误，让人误以为是 key 填错了。
  if (provider.baseUrl !== null && !provider.baseUrl) {
    yield { type: 'fatal-error', message: `${provider.label} 还没填 Base URL，请到设置页补上（参考文档链接）` }
    return
  }

  // DeepSeek/MiniMax/Qwen 官方均提供原生兼容 Anthropic Messages API 协议的端点（非转换代理），
  // 通过 ANTHROPIC_BASE_URL + 对应认证环境变量即可切换供应商，复用同一套 SDK 调用链路。
  // env 会整体替换子进程环境（不是合并），所以先展开 process.env 再显式清掉两个认证变量，
  // 避免用户本机 shell 里残留的 ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN 跟这里的选择打架。
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  env[provider.authEnvVar] = provider.apiKey
  if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl
  // GUI 启动的 Electron PATH 不含 Homebrew 等目录——分身的 Read 读 PDF 依赖 pdftoppm(poppler)、
  // Bash 工具依赖 python3 等，这里统一补齐，否则装了组件分身也找不到
  env.PATH = augmentedPath()

  let q: ReturnType<typeof query>
  try {
    q = query({
      prompt,
      options: {
        cwd: dataDir,
        agent: agentName,
        model: resolvedModel,
        settingSources: ['project'],
        resume: resumeSessionId,
        abortController,
        includePartialMessages: true,
        canUseTool,
        env,
        pathToClaudeCodeExecutable: resolveClaudeExecutable()
      }
    })
  } catch (err) {
    yield { type: 'fatal-error', message: err instanceof Error ? err.message : String(err) }
    return
  }

  try {
    for await (const msg of q) {
      switch (msg.type) {
        case 'system': {
          if (msg.subtype === 'init') {
            yield { type: 'init', model: msg.model, sessionId: msg.session_id }
          } else if (msg.subtype === 'permission_denied') {
            yield { type: 'permission-denied', toolName: msg.tool_name, reason: msg.message }
          }
          break
        }
        case 'stream_event': {
          const event = msg.event
          if (event.type === 'content_block_delta') {
            const delta = event.delta as { type: string; text?: string }
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text-delta', text: delta.text }
            }
          } else if (event.type === 'content_block_stop') {
            yield { type: 'text-block-done' }
          }
          break
        }
        case 'assistant': {
          const blocks = msg.message?.content ?? []
          for (const block of blocks) {
            if (block.type === 'tool_use') {
              yield { type: 'tool-use-start', id: block.id, name: block.name }
              yield { type: 'tool-use-input', id: block.id, input: block.input }
              if (block.name === 'Write' || block.name === 'Edit') {
                const filePath = (block.input as Record<string, unknown>)?.file_path
                if (typeof filePath === 'string') {
                  pendingFileWrites.set(block.id, { toolName: block.name, filePath })
                }
              }
            }
          }
          if (msg.error) {
            yield { type: 'fatal-error', message: mapAssistantErrorToMessage(msg.error) }
          }
          break
        }
        case 'user': {
          const blocks = (msg.message?.content ?? []) as Array<{
            type: string
            tool_use_id?: string
            is_error?: boolean
            content?: unknown
          }>
          for (const block of blocks) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const isError = Boolean(block.is_error)
              yield {
                type: 'tool-result',
                id: block.tool_use_id,
                isError,
                summary: summarizeToolResult(block.content)
              }

              const pending = pendingFileWrites.get(block.tool_use_id)
              if (pending && !isError) {
                await archiveIfUnderOutputs(dataDir, pending.filePath)
                if (userName && pending.toolName === 'Write' && isStampablePath(dataDir, pending.filePath)) {
                  stampProvenance(pending.filePath, userName)
                }
              }
              pendingFileWrites.delete(block.tool_use_id)
            }
          }
          break
        }
        case 'result': {
          yield {
            type: 'result',
            isError: msg.is_error,
            costUsd: msg.total_cost_usd,
            numTurns: msg.num_turns,
            durationMs: msg.duration_ms,
            errorMessage: msg.is_error ? (msg.subtype !== 'success' ? msg.subtype : undefined) : undefined
          }
          break
        }
        default:
          break
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      yield { type: 'result', isError: true, errorMessage: '已取消' }
      return
    }
    yield { type: 'fatal-error', message: err instanceof Error ? err.message : String(err) }
  }
}
