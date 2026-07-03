export interface HelpItem {
  label: string
  desc: string
}

export interface HelpContent {
  title: string
  items: HelpItem[]
}

export const HELP_CONTENT = {
  settings: {
    title: '设置页说明',
    items: [
      { label: '数据目录', desc: '指向 company-os 仓库根目录（含 knowledge/、bidding/、outputs/、法务/、.claude/）。' },
      { label: '模型供应商', desc: '点一个标签即可切换，对全部 9 个分身生效；每个供应商的 API Key/Base URL/模型映射独立保存，来回切换不会互相覆盖。' },
      { label: 'API Key', desc: '只对当前正在查看的供应商生效，保存在本机，不会同步到 company-os 仓库或网络。' },
      { label: '模型映射', desc: '.claude/agents/*.md 里写的 opus/sonnet/haiku 别名，在这里配置它们对应当前供应商的真实模型名。' }
    ]
  },
  agentChat: {
    title: '分身对话说明',
    items: [
      { label: '📎 上传', desc: '文件会复制进 inbox/，供分身用 Read 工具读取；发消息时一起带上。' },
      { label: '输入框', desc: 'Enter 发送，Shift+Enter 换行。' },
      { label: '停止', desc: '任务进行中会出现，点击中断当前这次调用（已经产生的文件不会撤销）。' },
      { label: '⚡ 快捷指令', desc: '部分分身有预设模板按钮，点击后填入输入框，改好占位内容再发送，不会自动发出去。' },
      { label: '‹ / › 产出面板', desc: '右侧可展开，按分身分类列出 outputs/ 下的产出文件，能定位到 Finder 或另存为副本。' }
    ]
  },
  gzhTool: {
    title: '公众号排版说明',
    items: [
      { label: '🎨 公众号一键排版', desc: '选一个 .md 文件，直接跑 tools/gzh/gzh_style.js 出 HTML——纯脚本工具，不经过 AI，不消耗 token。' },
      { label: '排版完成后', desc: '会用系统默认浏览器打开生成的 HTML，点里面的「一键复制」粘贴进公众号编辑器；配图需要在编辑器里手动插入。' }
    ]
  },
  bidding: {
    title: '招投标工作台说明',
    items: [
      { label: '＋ 新招标项目', desc: '选择招标原文件上传到 bidding/ 根目录，自动触发解析、建立项目文件夹。' },
      { label: '素材库', desc: '产品资料/检测报告/解决方案/人员资质/类似合同——5 类材料跨项目共享，生成投标文件时会被引用。' },
      { label: '项目卡片上的徽章', desc: '绿色=已完成，灰色=还没有。解析是入口，必须先做，质疑/投标可选。' },
      { label: '解析 / 写质疑函 / 生成投标文件', desc: '把对应指令填进下方对话框，由 bidding 分身实际执行；质疑函/投标文件按钮在解析完成前不可点。' },
      { label: '导出三册 Word', desc: '投标文件初稿生成后才会出现，按「# 第一册/第二册/第三册」拆成 3 个独立 .docx，二级标题间自动分页。' },
      { label: '📎 上传素材', desc: '在项目详情页里补传材料的快捷入口，实际还是存进跨项目共享的素材库，不是这个项目专属。' }
    ]
  },
  legal: {
    title: '法务工作台说明',
    items: [
      { label: '上传待审合同/法律材料', desc: '文件落进 法务/待审/，上传时选一下合同类型（销售/工程/其他），方便后续按类型匹配模板。' },
      { label: '审核', desc: '触发 legal 分身通读合同、出具《合同审核意见书》，落在 法务/已审/。' },
      { label: '与模板对比', desc: '如果该类型下已经导入过模板合同，会出现这个按钮——让 legal 分身把上传的合同和模板逐条比对，标出差异，尤其是对我方不利的改动。' },
      { label: '标记已审', desc: '纯文件移动操作，不经过 AI：手动把原文件从待审移到已审，用来表示"这份已经处理完了"。' },
      { label: '导入合同模板', desc: '把标准模板合同按类型存进 法务/_模板/合同模板/，之后同类型的待审合同就能跟它比对。' }
    ]
  },
  operation: {
    title: '运营推广工作台说明',
    items: [
      { label: '素材上传', desc: '图片/视频/其他素材先传上去，生成内容时会作为参考一起发给 operation 分身（分身会用 Read 工具看它需要看的部分）。' },
      { label: '平台：小红书 / 微信公众号', desc: '两种风格差别很大——小红书口语化+emoji+话题标签，公众号是完整文章结构，选哪个决定生成内容的骨架。' },
      { label: '✍️ 生成内容', desc: '把对应平台的提示词模板和已上传素材一起填进输入框，改好占位的"主题/需求"部分再发送，不会自动发出去。' },
      { label: '🎨 公众号一键排版', desc: '只在选中"微信公众号"时出现——纯脚本工具，把生成好的 .md 转成炬视固定风格的 HTML，不经过 AI。小红书内容不需要这步，直接复制文字发布即可。' },
      { label: '产出面板里的"排版"', desc: '对已经生成过的公众号类文章，不用重新去文件夹里找，直接点这里一键排版。' }
    ]
  }
} as const satisfies Record<string, HelpContent>
