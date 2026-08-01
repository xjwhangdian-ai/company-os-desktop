import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ============ 品牌视觉工作台：品牌事项看板 ============
// 六大预置事项（Logo与VI / 工牌 / PPT模板 / 名片 / 商标注册 / 官网上线）：
// 状态与待办存 outputs/06_品牌_brand/_品牌事项.json（App 托管）；
// 每个事项按关键词自动关联 outputs/06_品牌_brand/ 下已有的设计成果文件夹（design 产出即成果展示）。

const BRAND_DIR_REL = join('outputs', '06_品牌_brand')
const MATTERS_FILE = '_品牌事项.json'

export type BrandMatterStatus = '未开始' | '进行中' | '待人工' | '已完成'

export interface BrandMatter {
  key: string
  名称: string
  图标: string
  状态: BrandMatterStatus
  待办: string
  截止日: string
  /** 关联到的成果文件夹（自动扫描） */
  成果: { name: string; path: string; mtimeMs: number }[]
}

interface MatterState {
  状态?: BrandMatterStatus
  待办?: string
  截止日?: string
}

/** 预置事项：key/名称/成果关联关键词/默认待办 */
const PRESET: { key: string; 名称: string; 图标: string; 关键词: string[]; 默认状态: BrandMatterStatus; 默认待办: string }[] = [
  { key: 'logo', 名称: 'Logo 与 VI 设计', 图标: '🎨', 关键词: ['品牌VI', '全套设计', 'Logo', 'logo'], 默认状态: '已完成', 默认待办: '' },
  { key: 'gongpai', 名称: '工牌设计', 图标: '🪪', 关键词: ['工牌'], 默认状态: '未开始', 默认待办: '对分身说"按VI设计员工工牌"——横竖版式、姓名/职务/编号占位、打印规格' },
  { key: 'ppt', 名称: 'PPT 模板', 图标: '📽️', 关键词: ['PPT', '母版'], 默认状态: '已完成', 默认待办: '' },
  { key: 'mingpian', 名称: '名片设计', 图标: '💳', 关键词: ['名片'], 默认状态: '已完成', 默认待办: '' },
  { key: 'shangbiao', 名称: '商标注册', 图标: '®️', 关键词: ['商标', '英文命名'], 默认状态: '进行中', 默认待办: '①图形标第7/42类递交代理机构 ②35类补检索 ③"炬视"中文标撤三调查+收购询价并行 ④图形标第9类盯撤销公告生效' },
  { key: 'guanwang', 名称: '官网上线', 图标: '🌐', 关键词: ['官网', '域名', '网站'], 默认状态: '进行中', 默认待办: '①域名注册与ICP备案 ②对分身说"生成官网信息架构与首页文案" ③高保真HTML原型交建站方' }
]

function mattersPath(dataDir: string): string {
  return join(dataDir, BRAND_DIR_REL, MATTERS_FILE)
}

function readStates(dataDir: string): Record<string, MatterState> {
  const p = mattersPath(dataDir)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

/** 列出六大事项：预置定义 + 人工状态 + 自动扫描关联成果 */
export function listBrandMatters(dataDir: string): BrandMatter[] {
  const states = readStates(dataDir)
  const brandDir = join(dataDir, BRAND_DIR_REL)
  const folders: { name: string; path: string; mtimeMs: number }[] = []
  if (existsSync(brandDir)) {
    for (const name of readdirSync(brandDir)) {
      if (name.startsWith('_') || name.startsWith('.')) continue
      const full = join(brandDir, name)
      try {
        if (statSync(full).isDirectory()) folders.push({ name, path: full, mtimeMs: statSync(full).mtimeMs })
      } catch {
        // 忽略
      }
    }
  }
  folders.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return PRESET.map((p) => {
    const st = states[p.key] ?? {}
    const 成果 = folders.filter((f) => p.关键词.some((k) => f.name.includes(k)))
    // 有成果但没人工设过状态的"未开始"事项自动升为"进行中"（成果都出了不可能没开始）
    let 状态 = st.状态 ?? p.默认状态
    if (!st.状态 && 状态 === '未开始' && 成果.length > 0) 状态 = '进行中'
    return { key: p.key, 名称: p.名称, 图标: p.图标, 状态, 待办: st.待办 ?? p.默认待办, 截止日: st.截止日 ?? '', 成果 }
  })
}

export function setBrandMatter(dataDir: string, key: string, patch: MatterState): void {
  const states = readStates(dataDir)
  states[key] = { ...states[key], ...patch }
  const p = mattersPath(dataDir)
  mkdirSync(join(dataDir, BRAND_DIR_REL), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(states, null, 2), 'utf-8')
  renameSync(tmp, p)
}
