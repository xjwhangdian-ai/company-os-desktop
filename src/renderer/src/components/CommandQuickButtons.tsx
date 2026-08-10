import type { AgentName } from '@shared/agent-types'

interface QuickCommand {
  label: string
  template: string
}

// 对应 .claude/commands/ 里的 new-sop / weekly-content：点击后把预设提示词模板填入输入框，
// 供用户编辑 $ARGUMENTS 部分后再发送，不直接发出去。
const QUICK_COMMANDS: Partial<Record<AgentName, QuickCommand[]>> = {
  'ops-policy': [
    { label: '起草新 SOP/制度', template: '起草一份新的 SOP/制度，主题：〔请填写主题，如"请假管理"〕' }
  ],
  operation: [
    { label: '本周内容日历', template: '生成本周新媒体内容计划，平台范围：〔请填写平台，如不填则覆盖全部平台〕' },
    { label: '数字人创意蓝图', template: '生成一套数字人短视频创意蓝图与动态视频提示词包，主题：〔请填写产品/场景〕；目标受众：〔企业采购/现场负责人等〕；目标：〔私信线索/预约演示〕；动态视频平台：〔Seedance 2.5 / Kling 3.0 / 两者〕。每镜头输出 ChatGPT 静态关键帧提示词和相应的视频提示词。' }
  ]
}

interface CommandQuickButtonsProps {
  agentName: AgentName
  onPick: (template: string) => void
}

export function CommandQuickButtons({ agentName, onPick }: CommandQuickButtonsProps): React.JSX.Element | null {
  const commands = QUICK_COMMANDS[agentName]
  if (!commands || commands.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-2">
      {commands.map((cmd) => (
        <button
          key={cmd.label}
          onClick={() => onPick(cmd.template)}
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
        >
          ⚡ {cmd.label}
        </button>
      ))}
    </div>
  )
}
