import { getActiveProvider } from './store'
import type { AgentDisplayMeta, AgentName } from '@shared/agent-types'

/**
 * 分身展示元数据内联为常量，不做运行时外部 JSON 文件读取——打包后 resources/
 * 的真实路径由 electron-builder extraResources 决定，相对路径在 dev/打包两种
 * 场景下不一致，容易出 bug；这份数据体量小，没必要为了"可外部编辑"这个不
 * 存在的需求去处理路径解析的复杂度。默认模型映射的常量在 store.ts 里维护
 * （避免这里跟 store.ts 互相 import 形成循环依赖）。
 */
const AGENT_DISPLAY_META: Record<AgentName, Omit<AgentDisplayMeta, 'name'>> = {
  sales: { displayName: '销售支持', role: '销售', whenToUse: '对客户推广 / 报价', color: '#2563eb', icon: 'Megaphone' },
  solution: { displayName: '解决方案', role: '解决方案', whenToUse: '产品/方案支撑（知识源头）', color: '#0d9488', icon: 'Lightbulb' },
  bidding: { displayName: '招投标', role: '解决方案·招投标', whenToUse: '处理招标文件、投标', color: '#7c3aed', icon: 'FileCheck2' },
  legal: { displayName: '法务审核', role: '法务', whenToUse: '审合同 / 法律材料', color: '#b45309', icon: 'Scale' },
  operation: { displayName: '运营推广', role: '运营', whenToUse: '新媒体 / 营销运营', color: '#db2777', icon: 'Rocket' },
  brand: { displayName: '品牌视觉', role: '运营·品牌', whenToUse: '品牌与官网', color: '#dc2626', icon: 'Palette' },
  'ops-policy': { displayName: '行政人力', role: '行政/人力', whenToUse: '规章制度 / SOP / 招聘', color: '#4d7c0f', icon: 'ClipboardList' },
  finance: { displayName: '财务测算', role: '财务', whenToUse: '财税 / 成本 / 预算', color: '#0891b2', icon: 'Calculator' },
  intel: { displayName: '行业情报', role: '跨职能支持', whenToUse: '行业趋势 / 政策 / 竞品', color: '#525252', icon: 'Radar' },
  mba: { displayName: 'MBA学习', role: '个人·学习', whenToUse: '课程作业 / 论文 / 案例分析', color: '#0369a1', icon: 'GraduationCap' }
}

/**
 * .claude/agents/*.md frontmatter 里的 model 字段可能是别名(opus/sonnet/haiku)
 * 也可能已经是完整模型 ID（形如 claude-xxx-x-x）。只有别名才需要查表映射，
 * 完整 ID 原样透传——这样以后分身配置里直接写死模型 ID 也不会被误映射。
 * 映射表来自当前激活的供应商（Anthropic/DeepSeek/MiniMax/Qwen/自定义），
 * 切换供应商时不用改 .claude/agents/*.md。
 */
export function resolveModel(modelField: string | undefined): string | undefined {
  if (!modelField) return undefined
  const mapping = getActiveProvider().modelMapping
  if (modelField in mapping) {
    return mapping[modelField as keyof typeof mapping]
  }
  return modelField
}

export function loadAgentDisplayMeta(): Record<AgentName, Omit<AgentDisplayMeta, 'name'>> {
  return AGENT_DISPLAY_META
}
