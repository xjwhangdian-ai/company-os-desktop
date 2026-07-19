import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, ContractCategory, ContractTemplate, LegalDoc } from '@shared/agent-types'
import { CONTRACT_CATEGORIES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { FileDropzone } from '../components/FileDropzone'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

/** 意见书的产出目录：outputs/04_法务_legal/{日期_合同名}/（统一"产出按项目建文件夹"约定） */
function reviewOutputDir(fileName: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const stem = fileName
    .replace(/^【.+?】/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '')
    .slice(0, 50)
  return `outputs/04_法务_legal/${date}_${stem}`
}

function CategoryBadge({ category }: { category: ContractCategory }): React.JSX.Element {
  const color =
    category === '销售合同' ? 'bg-blue-50 text-blue-600' : category === '工程合同' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-500'
  return <span className={`rounded px-1.5 py-0.5 text-xs ${color}`}>{category}</span>
}

/** 审核提示词：意见书 + 机读修订清单（修订清单供「修订版合同」按钮把意见以 Word 修订模式写回原文） */
function buildReviewPrompt(fileName: string): string {
  const dir = reviewOutputDir(fileName)
  const isDocx = /\.docx$/i.test(fileName)
  return [
    `审一下这份合同：inbox/04_法务_legal/${fileName}`,
    `（若是二进制格式，先读同目录的伴生提取文本 ${fileName}_提取文本.txt）`,
    ``,
    `产出两份文件：`,
    `1. 《合同审核意见书》→ ${dir}/审核意见书.md（按标准结构：总体结论/高风险条款/逐条意见/缺失条款/一句话总结）`,
    `2. 机读修订清单 → ${dir}/修订清单.json——把每条可直接落地的条款修改整理成 JSON 数组：`,
    `   [{"原文":"…","修改为":"…","理由":"…"}, …]`,
    `   要求：「原文」必须从合同（或其提取文本）里逐字连续复制 20~80 字、在全文中唯一；`,
    `   纯删除条款「修改为」填空字符串；只放能落地替换的条款文字，宏观建议写在意见书里不进清单。`,
    isDocx ? `（用户之后会点「修订版合同」按钮，把清单以 Word 修订模式写回原合同。）` : `（原件不是 docx，修订清单仅作谈判参考。）`
  ].join('\n')
}

export function LegalWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [pending, setPending] = useState<LegalDoc[]>([])
  const [reviewed, setReviewed] = useState<LegalDoc[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [showChat, setShowChat] = useState(true)
  const [uploadCategory, setUploadCategory] = useState<ContractCategory>('销售合同')
  const [showTemplates, setShowTemplates] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [redlining, setRedlining] = useState<string | null>(null)

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 8000)
  }

  async function handleRedline(doc: LegalDoc): Promise<void> {
    setRedlining(doc.fileName)
    try {
      const r = await window.api.legal.generateRedline(doc.fileName)
      flash(r.说明)
      if (r.ok && r.outPath) await window.api.shell.showItemInFolder(r.outPath)
    } catch (err) {
      flash(`生成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRedlining(null)
    }
  }

  async function refresh(): Promise<void> {
    const docs = await window.api.legal.listDocs()
    setPending(docs.pending)
    setReviewed(docs.reviewed)
    setTemplates(await window.api.legal.listTemplates())
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (pendingPrompt) setShowChat(true)
  }, [pendingPrompt])

  function templateFor(category: ContractCategory): ContractTemplate | undefined {
    return templates.find((t) => t.category === category)
  }

  return (
    <div className="flex h-full">
      <div className={`shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 ${showChat ? 'w-80' : 'flex-1'}`}>
        <div className="app-drag mb-2 flex items-center justify-between pt-1">
          <h2 className="text-xs font-semibold text-slate-500">法务工作台</h2>
          <div className="app-no-drag flex items-center gap-2">
            <button
              onClick={() => setShowTemplates((v) => !v)}
              className={`rounded-md border px-2 py-1 text-xs font-medium ${
                showTemplates ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
              }`}
            >
              合同模板
            </button>
            <HelpButton content={HELP_CONTENT.legal} />
          </div>
        </div>

        {showTemplates ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">按类型导入标准模板合同，之后同类型的待审合同可以跟它比对差异。</p>
            {CONTRACT_CATEGORIES.map((cat) => (
              <div key={cat} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <CategoryBadge category={cat} />
                  <FileDropzone
                    compact
                    uploadFn={(p) => window.api.legal.uploadTemplate(cat, p)}
                    onUploaded={refresh}
                  />
                </div>
                {templateFor(cat) ? (
                  <p className="truncate text-xs text-slate-500">📄 {templateFor(cat)?.fileName}</p>
                ) : (
                  <p className="text-xs text-slate-300">还没有模板</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="mb-2 flex gap-1">
              {CONTRACT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setUploadCategory(cat)}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                    uploadCategory === cat ? 'border-jushi-accent bg-white text-jushi-accent' : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <FileDropzone
              compact={false}
              label={`上传待审的「${uploadCategory}」`}
              uploadFn={(p) => window.api.upload.legalPending(p, uploadCategory)}
              onUploaded={refresh}
            />

            <h3 className="mb-1.5 mt-4 px-1 text-xs font-semibold text-slate-500">待审（{pending.length}）</h3>
            <div className="space-y-1.5">
              {pending.map((doc) => (
                <div key={doc.fileName} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <CategoryBadge category={doc.category} />
                    <p className="truncate text-xs font-medium text-slate-700">{doc.fileName}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setPendingPrompt(buildReviewPrompt(doc.fileName))}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                    >
                      审核
                    </button>
                    {/\.docx$/i.test(doc.fileName) && (
                      <button
                        disabled={redlining !== null}
                        onClick={() => handleRedline(doc)}
                        title="按分身审核产出的修订清单，把修改意见以 Word「修订模式」写回原合同——打开即可逐条接受/拒绝"
                        className="rounded border border-rose-300 bg-white px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {redlining === doc.fileName ? '生成中…' : '✍ 修订版合同'}
                      </button>
                    )}
                    {templateFor(doc.category) && (
                      <button
                        onClick={() =>
                          setPendingPrompt(
                            `对比一下这两份合同：inbox/04_法务_legal/${doc.fileName} 和模板 ${templateFor(doc.category)?.fileName}（法务/_模板/合同模板/${doc.category}/${templateFor(doc.category)?.fileName}），逐条列出差异，尤其标出对我方不利的改动，其余按《合同审核意见书》格式输出，写到 ${reviewOutputDir(doc.fileName)}/模板对比意见书.md`
                          )
                        }
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                      >
                        与模板对比
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await window.api.legal.markReviewed(doc.fileName)
                        refresh()
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-emerald-400 hover:text-emerald-600"
                    >
                      标记已审
                    </button>
                  </div>
                </div>
              ))}
              {pending.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-400">待审为空</p>}
            </div>

            <h3 className="mb-1.5 mt-4 px-1 text-xs font-semibold text-slate-500">已审（{reviewed.length}）</h3>
            <div className="space-y-1.5">
              {reviewed.map((doc) => (
                <div key={doc.fileName} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <CategoryBadge category={doc.category} />
                  <span className="truncate text-xs text-slate-600">{doc.fileName}</span>
                  <button
                    onClick={() => window.api.shell.showItemInFolder(doc.path)}
                    className="ml-auto shrink-0 text-xs text-slate-400 hover:text-jushi-accent"
                  >
                    定位
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {notice && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">
            {notice}
          </div>
        )}
      </div>

      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className={`overflow-hidden transition-all ${showChat ? 'flex-1' : 'w-0'}`}>
        <AgentChat
          agent={agent}
          uploadFn={(p) => window.api.upload.legalPending(p, uploadCategory)}
          pendingPrompt={pendingPrompt}
          onPendingPromptConsumed={() => setPendingPrompt(null)}
        />
      </div>
    </div>
  )
}
