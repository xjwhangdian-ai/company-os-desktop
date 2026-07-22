import { Component, type ReactNode } from 'react'

/**
 * 顶层错误边界：任何页面渲染崩溃都显示可读的错误信息 + 「重新加载」按钮，
 * 而不是整个 App 白屏（React 默认行为是卸载整棵树）。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 px-8 text-center">
          <p className="text-sm font-medium text-slate-700">页面出错了</p>
          <p className="max-w-lg break-all font-mono text-xs text-slate-400">{String(this.state.error)}</p>
          <p className="text-xs text-slate-400">如果刚更新过 App，请先完全退出再重新打开（更新需要主程序一起重启）。</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white"
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
