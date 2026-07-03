import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, ContractCategory, ContractTemplate, LegalDoc } from '@shared/agent-types'
import { CONTRACT_CATEGORIES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { FileDropzone } from '../components/FileDropzone'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

function CategoryBadge({ category }: { category: ContractCategory }): React.JSX.Element {
  const color =
    category === '销售合同' ? 'bg-blue-50 text-blue-600' : category === '工程合同' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-500'
  return <span className={`rounded px-1.5 py-0.5 text-xs ${color}`}>{category}</span>
}

export function LegalWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [pending, setPending] = useState<LegalDoc[]>([])
  const [reviewed, setReviewed] = useState<LegalDoc[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [uploadCategory, setUploadCategory] = useState<ContractCategory>('销售合同')
  const [showTemplates, setShowTemplates] = useState(false)

  async function refresh(): Promise<void> {
    const docs = await window.api.legal.listDocs()
    setPending(docs.pending)
    setReviewed(docs.reviewed)
    setTemplates(await window.api.legal.listTemplates())
  }

  useEffect(() => {
    refresh()
  }, [])

  function templateFor(category: ContractCategory): ContractTemplate | undefined {
    return templates.find((t) => t.category === category)
  }

  return (
    <div className="flex h-full">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-500">法务工作台</h2>
          <div className="flex items-center gap-2">
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
                      onClick={() => setPendingPrompt(`审一下这份合同：法务/待审/${doc.fileName}`)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                    >
                      审核
                    </button>
                    {templateFor(doc.category) && (
                      <button
                        onClick={() =>
                          setPendingPrompt(
                            `对比一下这两份合同：法务/待审/${doc.fileName} 和模板 ${templateFor(doc.category)?.fileName}（法务/_模板/合同模板/${doc.category}/${templateFor(doc.category)?.fileName}），逐条列出差异，尤其标出对我方不利的改动，其余按你原有的《合同审核意见书》格式输出`
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
      </div>

      <div className="flex-1 overflow-hidden">
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
