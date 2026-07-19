/**
 * 分身对话栏的收起/展开细条（各工作台通用）。
 * 放在对话面板左侧一条竖条：展开时显示 ›，收起时显示 ‹ 并竖排「💬 分身对话」提示。
 * 收起本身只折叠对话面板宽度，不卸载 AgentChat——会话记录在 zustand store 里，不受组件挂载影响。
 */
export function ChatCollapseRail({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <div className="flex w-7 shrink-0 flex-col items-center border-l border-slate-200 bg-slate-50">
      <button
        onClick={onToggle}
        title={open ? '收起分身对话' : '展开分身对话'}
        className="py-3 text-slate-400 hover:text-jushi-accent"
      >
        {open ? '›' : '‹'}
      </button>
      {!open && (
        <span className="mt-1 select-none text-xs text-slate-400" style={{ writingMode: 'vertical-rl' }}>
          💬 分身对话
        </span>
      )}
    </div>
  )
}
