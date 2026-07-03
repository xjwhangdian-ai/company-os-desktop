// Agent 运行时的流式事件契约。主进程(runner.ts)产出，经 IPC 传给渲染进程消费，
// 单独抽出到 shared/ 是为了让渲染进程的 TS 项目不必引用 main/ 下的实现文件。
export type AgentStreamEvent =
  | { type: 'init'; model: string; sessionId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text-block-done' }
  | { type: 'tool-use-start'; id: string; name: string }
  | { type: 'tool-use-input'; id: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean; summary: string }
  | { type: 'permission-denied'; toolName: string; reason: string }
  | {
      type: 'result'
      isError: boolean
      costUsd?: number
      numTurns?: number
      durationMs?: number
      errorMessage?: string
    }
  | { type: 'fatal-error'; message: string }
