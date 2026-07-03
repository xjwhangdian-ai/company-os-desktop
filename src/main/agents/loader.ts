import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { AgentDefinition, AgentDisplayMeta, AgentName } from '@shared/agent-types'
import { loadAgentDisplayMeta } from '../config/model-mapping'

const KNOWN_AGENT_NAMES: AgentName[] = [
  'sales',
  'solution',
  'bidding',
  'legal',
  'operation',
  'brand',
  'ops-policy',
  'finance',
  'intel'
]

interface AgentFrontmatter {
  name?: string
  description?: string
  tools?: string | string[]
  model?: string
}

/**
 * 解析 dataDir/.claude/agents/*.md。主要用于 UI 展示（名称/职责/工具列表预览），
 * runner.ts 也会读一次同一批文件，只为取 model 字段做别名映射——system prompt/tools
 * 本身仍完全交给 Agent SDK 通过 settingSources: ['project'] 自动发现和应用，
 * 这里不重新拼装、不替 SDK 做那部分工作。
 */
export function loadAgentDefinitions(dataDir: string): AgentDefinition[] {
  const agentsDir = join(dataDir, '.claude', 'agents')
  let files: string[] = []
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const results: AgentDefinition[] = []
  for (const file of files) {
    const full = join(agentsDir, file)
    let raw: string
    try {
      raw = readFileSync(full, 'utf-8')
    } catch {
      continue
    }
    const { data, content } = matter(raw)
    const fm = data as AgentFrontmatter
    const nameFromFile = file.replace(/\.md$/, '')
    const name = (fm.name ?? nameFromFile) as AgentName
    if (!KNOWN_AGENT_NAMES.includes(name)) continue

    const tools = Array.isArray(fm.tools)
      ? fm.tools
      : typeof fm.tools === 'string'
        ? fm.tools.split(',').map((t) => t.trim()).filter(Boolean)
        : []

    results.push({
      name,
      description: fm.description ?? '',
      tools,
      model: fm.model,
      promptPreview: content.trim().slice(0, 4000)
    })
  }

  // 按公司组织架构固定顺序展示，而不是文件系统的目录遍历顺序
  results.sort((a, b) => KNOWN_AGENT_NAMES.indexOf(a.name) - KNOWN_AGENT_NAMES.indexOf(b.name))
  return results
}

export function buildAgentDisplayList(dataDir: string): AgentDisplayMeta[] {
  const defs = loadAgentDefinitions(dataDir)
  const displayMeta = loadAgentDisplayMeta()
  return defs.map((d) => {
    const meta = displayMeta[d.name] ?? {
      displayName: d.name,
      role: '',
      whenToUse: d.description,
      color: '#525252',
      icon: 'Bot'
    }
    return { name: d.name, ...meta }
  })
}
