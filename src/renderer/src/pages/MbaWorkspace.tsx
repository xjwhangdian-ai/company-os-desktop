import { useEffect, useState } from 'react'
import type { AgentDisplayMeta } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'

// ============ MBA 学习工作台 ============
// 课件/作业要求/课堂录音按课程归档到 inbox/10_MBA学习_mba/{课程}/{分类}/，
// 「一键生成作业」把固定提示词交给 mba 分身；钉钉 A1 录音走"钉钉转写→导出→上传"的导入通道。

interface CourseInfo {
  name: string
  课件数: number
  作业数: number
  录音数: number
}

const CATEGORIES = ['课件', '作业与要求', '课堂录音'] as const
const CAT_ICON: Record<(typeof CATEGORIES)[number], string> = { 课件: '📚', 作业与要求: '📝', 课堂录音: '🎧' }

export function MbaWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [courses, setCourses] = useState<CourseInfo[]>([])
  const [selected, setSelected] = useState<string>('')
  const [newCourse, setNewCourse] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [showChat, setShowChat] = useState(true)
  const [showA1, setShowA1] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [chatW, setChatW] = usePersistedSize(CHAT_PANE_KEY, CHAT_PANE.def, CHAT_PANE.min, CHAT_PANE.max)

  function flash(t: string): void {
    setNotice(t)
    setTimeout(() => setNotice(null), 6000)
  }

  async function refresh(): Promise<void> {
    try {
      const list = await window.api.mba.listCourses()
      setCourses(list)
      if (!selected && list.length > 0) setSelected(list[0].name)
    } catch {
      flash('读取课程列表失败——如果刚更新过程序，请完全退出后重新打开再试')
    }
  }
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const course = selected || newCourse.trim()

  async function handleUpload(category: (typeof CATEGORIES)[number]): Promise<void> {
    if (!course) {
      flash('先选择或新建一门课程')
      return
    }
    const filters =
      category === '课堂录音'
        ? [{ name: '录音与转写', extensions: ['m4a', 'mp3', 'wav', 'aac', 'txt', 'md', 'docx', 'pdf'] }]
        : [{ name: '文档', extensions: ['pdf', 'pptx', 'ppt', 'docx', 'doc', 'md', 'txt', 'png', 'jpg', 'jpeg', 'xlsx'] }]
    const paths = await window.api.dialog.pickFiles(filters)
    if (!paths || paths.length === 0) return
    let ok = 0
    for (const p of paths) {
      try {
        await window.api.mba.uploadCourse(course, category, p)
        ok += 1
      } catch {
        // 单个失败继续
      }
    }
    flash(`已上传 ${ok} 个文件到「${course} / ${category}」`)
    setNewCourse('')
    await refresh()
    if (!selected) setSelected(course)
  }

  function handleGenerate(): void {
    if (!course) {
      flash('先选择一门课程')
      return
    }
    setShowChat(true)
    setPendingPrompt(
      `【一键生成作业】课程：「${course}」\n` +
        `1. 先读 inbox/10_MBA学习_mba/${course}/作业与要求/ 下的作业要求（含评分标准），逐条列出形式要求与评分维度；没有作业要求文件就先停下来问我要。\n` +
        `2. 通读 inbox/10_MBA学习_mba/${course}/课件/ 与 课堂录音/ 的材料，提炼本课的核心框架与老师强调的工具。\n` +
        `3. 按 mba 分身规范完成作业：结合我的经历（海康威视→创业）取材，有数据有立场有矛盾，学术诚信红线全守（真实来源/AI声明/参考文献规范）。\n` +
        `4. 产出到 outputs/10_MBA学习_mba/{今天日期_${course}_作业}/，md 底稿 + 按要求的成品格式（PPT/Word）。\n` +
        `动手前先把你对作业要求的理解和大纲发我确认。`
    )
  }

  function handleNotes(): void {
    if (!course) {
      flash('先选择一门课程')
      return
    }
    setShowChat(true)
    setPendingPrompt(
      `读取 inbox/10_MBA学习_mba/${course}/课堂录音/ 下的转写纪要（txt/md/docx），按「概念→框架→案例→我的应用」四层整理成课堂笔记，输出到 outputs/10_MBA学习_mba/{今天日期_${course}_课堂笔记}/。录音音频文件如果没有对应文字转写，列出文件名提醒我先在钉钉里导出转写。`
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="app-drag flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">MBA 学习工作台</h2>
            <div className="app-no-drag flex items-center gap-2">
              <button
                onClick={() => setShowA1((v) => !v)}
                className={`rounded-full border px-3 py-1 text-xs ${showA1 ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'}`}
                title="钉钉 A1 录音设备的课堂录音导入流程"
              >
                🎧 钉钉A1 导入指引
              </button>
              <button
                onClick={handleGenerate}
                className="rounded-full bg-jushi-accent px-3 py-1 text-xs font-medium text-white"
                title="读取所选课程的作业要求与课件，按 mba 分身的学术规范生成作业（先出大纲确认再动笔）"
              >
                ⚡ 一键生成作业
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">课程：</span>
            {courses.map((c) => (
              <button
                key={c.name}
                onClick={() => setSelected(c.name)}
                className={`rounded-full border px-2.5 py-1 text-xs ${selected === c.name ? 'border-jushi-accent bg-jushi-accent/10 font-medium text-jushi-accent' : 'border-slate-300 text-slate-600'}`}
              >
                {c.name}
              </button>
            ))}
            <input
              value={newCourse}
              onChange={(e) => {
                setNewCourse(e.target.value)
                if (e.target.value.trim()) setSelected('')
              }}
              placeholder="＋新建课程（输入课程名后直接点上传）"
              className="w-56 rounded-lg border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-jushi-accent"
            />
          </div>
          {notice && <p className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{notice}</p>}
        </div>

        {showA1 && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-[12px] leading-relaxed text-slate-600">
            <div className="font-semibold text-slate-700">🎧 钉钉 A1 课堂录音 → 工作台，三步：</div>
            <p className="mt-1">
              ① 上课用 A1 录音，录完在<b>钉钉 App「AI 助理/闪记」</b>里自动生成转写全文与摘要；
              ② 在钉钉里把<b>转写文本导出</b>（复制为 txt/docx，或分享文件到电脑），音频原文件可一并导出；
              ③ 回到本页选中课程 → 点「上传课堂录音」把转写和音频传上来——之后对分身说「整理这节课的课堂笔记」即可。
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              说明：转写在钉钉侧完成效果最好（A1 与钉钉深度绑定）；工作台负责按课程归档与后续整理。音频没有转写时，分身会列出清单提醒你先导出。
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {course ? (
            <>
              <div className="mb-2 text-xs font-semibold text-slate-500">「{course}」 · 三类材料</div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {CATEGORIES.map((cat) => {
                  const info = courses.find((c) => c.name === selected)
                  const n = cat === '课件' ? info?.课件数 : cat === '作业与要求' ? info?.作业数 : info?.录音数
                  return (
                    <div key={cat} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{CAT_ICON[cat]}</span>
                        <span className="text-sm font-semibold text-slate-700">{cat}</span>
                        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{n ?? 0} 个文件</span>
                      </div>
                      <p className="mt-1.5 flex-1 text-[11px] leading-snug text-slate-400">
                        {cat === '课件' && '课程 PDF/PPT/讲义——生成作业与复习提纲的知识底料'}
                        {cat === '作业与要求' && '作业要求原文/评分标准（截图也行）——一键生成作业会先读这里'}
                        {cat === '课堂录音' && '钉钉A1 导出的转写文本与录音（m4a/txt/docx）——整理课堂笔记用'}
                      </p>
                      <button
                        onClick={() => handleUpload(cat)}
                        className="mt-2 rounded-lg border border-jushi-accent px-3 py-1.5 text-xs font-medium text-jushi-accent hover:bg-jushi-accent/5"
                      >
                        ⬆ 上传{cat}
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={handleGenerate} className="rounded-lg bg-jushi-accent px-4 py-2 text-xs font-medium text-white">
                  ⚡ 一键生成作业（先出大纲确认）
                </button>
                <button onClick={handleNotes} className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent">
                  📒 录音转写 → 课堂笔记
                </button>
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-xs leading-relaxed text-slate-400">
              还没有课程。在上方输入课程名（如「双碳目标与产业创新」），
              <br />
              然后上传课件或作业要求，课程文件夹会自动建立。
            </div>
          )}
        </div>
      </div>

      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
        <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
      </div>
    </div>
  )
}
