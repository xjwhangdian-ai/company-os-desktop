import { useEffect, useState } from 'react'
import type { AgentDisplayMeta } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'

// ============ MBA 学习工作台（论文为主 + 课程学习） ============
// 论文材料归 inbox/10_MBA学习_mba/_论文/{分类}/；课程材料归 {课程}/{分类}/。
// 论文选题与研究框架来自《浙大MBA学生简况表》（分身定义内置），各阶段按钮组好提示词交给 mba 分身。

interface CourseInfo {
  name: string
  课件数: number
  作业数: number
  录音数: number
}

const CATEGORIES = ['课件', '作业与要求', '课堂录音'] as const
const CAT_ICON: Record<(typeof CATEGORIES)[number], string> = { 课件: '📚', 作业与要求: '📝', 课堂录音: '🎧' }

const THESIS_TOPIC = '《通用大模型时代下工业AI企业的商业模式重构与竞争战略研究——基于多模态大模型产品的实证分析》'
const THESIS_CATS = ['开题与选题', '文献', '数据与案例', '导师意见'] as const
const THESIS_CAT_DESC: Record<(typeof THESIS_CATS)[number], string> = {
  开题与选题: '简况表/开题报告草稿/导师书面意见——选题与开题的全部版本',
  文献: '下载的论文 PDF/研报——文献综述的原料（存进来再喊分身入参考文献库）',
  数据与案例: '案例访谈纪要/财报/行业数据/问卷回收——实证分析的证据',
  导师意见: '与导师的沟通纪要/邮件/批注稿——每轮修改的依据'
}

/** 论文各阶段一键提示词（选题与框架来自学生简况表，已写入 mba 分身定义） */
const THESIS_STAGES: { icon: string; name: string; prompt: string }[] = [
  {
    icon: '🎯',
    name: '选题打磨',
    prompt: `围绕我的意向选题 ${THESIS_TOPIC}，做一轮选题打磨：①把研究问题收敛为 1 个主问题 + 3 个子问题（可回答、可实证）②评估数据可得性（我能拿到的案例/访谈资源：海康在职+安防行业人脉）③给出 3 个可辩护的选题表述备选。先读 inbox/10_MBA学习_mba/_论文/开题与选题/ 里的已有材料再动手。`
  },
  {
    icon: '📋',
    name: '开题报告',
    prompt: `按浙大 MBA 开题报告通行结构（研究背景与意义/文献综述简版/研究问题/研究方法与技术路线/论文框架/进度计划/参考文献）为我的选题 ${THESIS_TOPIC} 起草开题报告。研究框架用简况表里的四点构想（价值链重塑/卖产品到卖能力/三种模式成本盈利对比/头部企业比较案例）。读 _论文/开题与选题/ 与 _论文/文献/ 后动笔，产出 md+Word 到 outputs/10_MBA学习_mba/{今天日期_论文_开题报告}/。`
  },
  {
    icon: '📚',
    name: '文献综述',
    prompt: `读 inbox/10_MBA学习_mba/_论文/文献/ 下的全部文献，按主题聚类（商业模式创新/技术范式转换/工业AI与大模型产品化/竞争战略）写文献综述：每个主题先梳理共识，再指出分歧与缺口，最后落到"我的研究填补什么"。引用规范 GB/T 7714，同步更新 outputs/10_MBA学习_mba/_论文工作区/参考文献库.md（没有就新建）。`
  },
  {
    icon: '🔬',
    name: '研究设计',
    prompt: `为论文设计实证部分：①多案例研究设计（海康/大华/商汤/华为四案例的选择逻辑与数据来源矩阵）②高管/客户访谈提纲（15-20 题，围绕 B 端购买决策/价值感知/付费意愿/部署模式）③如需问卷给出量表设计。标注每类数据的可得性风险与替代方案。`
  },
  {
    icon: '✍️',
    name: '章节写作',
    prompt: `继续论文正文写作。先读 outputs/10_MBA学习_mba/ 下已有的论文章节产出与 _论文/ 全部材料，列出当前进度（哪章已有稿/哪章缺），然后问我这次写哪一章；写作时每章先立骨架给我确认再填肉。`
  },
  {
    icon: '🧾',
    name: '降重与格式',
    prompt: `对我指定的论文稿件做两件事：①学术表达润色与自查（口语化表述改学术语态、逻辑衔接补全、重复表述改写——不改变观点与数据）②按浙大研究生学位论文格式规范检查：标题层级/图表编号/引用标注/参考文献格式，输出逐项修改清单。先问我要稿件路径。`
  }
]

export function MbaWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [tab, setTab] = useState<'论文' | '课程'>('论文')
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
    setTimeout(() => setNotice(null), 8000)
  }

  async function refresh(): Promise<void> {
    try {
      const list = (await window.api.mba.listCourses()).filter((c) => !c.name.startsWith('_'))
      setCourses(list)
      if (!selected && list.length > 0) setSelected(list[0].name)
    } catch (err) {
      flash(`读取课程列表失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出（Cmd+Q）后重新打开`)
    }
  }
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const course = selected || newCourse.trim()

  async function doUpload(courseName: string, category: string, filters: { name: string; extensions: string[] }[]): Promise<void> {
    const paths = await window.api.dialog.pickFiles(filters)
    if (!paths || paths.length === 0) return
    let ok = 0
    let lastErr = ''
    for (const p of paths) {
      try {
        await window.api.mba.uploadCourse(courseName, category as '课件', p)
        ok += 1
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
      }
    }
    if (ok > 0) flash(`已上传 ${ok} 个文件到「${courseName === '_论文' ? '论文' : courseName} / ${category}」`)
    if (lastErr) flash(`有文件上传失败：${lastErr}——如果刚更新过程序，请完全退出（Cmd+Q）后重新打开再试`)
    await refresh()
  }

  async function handleUpload(category: (typeof CATEGORIES)[number]): Promise<void> {
    if (!course) {
      flash('先选择或新建一门课程')
      return
    }
    const filters =
      category === '课堂录音'
        ? [{ name: '录音与转写', extensions: ['m4a', 'mp3', 'wav', 'aac', 'txt', 'md', 'docx', 'pdf'] }]
        : [{ name: '文档', extensions: ['pdf', 'pptx', 'ppt', 'docx', 'doc', 'md', 'txt', 'png', 'jpg', 'jpeg', 'xlsx'] }]
    await doUpload(course, category, filters)
    setNewCourse('')
    if (!selected && course) setSelected(course)
  }

  function handleGenerate(): void {
    if (!course) {
      flash('先选择一门课程')
      return
    }
    setShowChat(true)
    setPendingPrompt(
      `【一键生成作业】课程：「${course}」\n` +
        `1. 先读 inbox/10_MBA学习_mba/${course}/ 下的全部材料（含根目录散文件与 作业与要求/、课件/ 子目录），找到作业要求与评分标准，逐条列出；没有作业要求就先停下来问我要。\n` +
        `2. 提炼课件与课堂录音转写里的核心框架与老师强调的工具。\n` +
        `3. 按 mba 分身规范完成作业：结合我的经历取材，有数据有立场有矛盾，学术诚信红线全守。\n` +
        `4. 产出到 outputs/10_MBA学习_mba/{今天日期_${course}_作业}/，md 底稿 + 按要求的成品格式。\n` +
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
      `读取 inbox/10_MBA学习_mba/${course}/课堂录音/ 下的转写纪要，按「概念→框架→案例→我的应用」四层整理成课堂笔记，输出到 outputs/10_MBA学习_mba/{今天日期_${course}_课堂笔记}/。音频没有对应转写的列出文件名提醒我先在钉钉导出。`
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="app-drag flex items-center justify-between">
            <div className="app-no-drag flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">MBA 学习工作台</h2>
              <div className="ml-2 flex rounded-lg border border-slate-200 p-0.5">
                {(['论文', '课程'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${tab === t ? 'bg-jushi-accent text-white' : 'text-slate-500'}`}
                  >
                    {t === '论文' ? '🎓 学位论文' : '📖 课程学习'}
                  </button>
                ))}
              </div>
            </div>
            <div className="app-no-drag flex items-center gap-2">
              {tab === '课程' && (
                <>
                  <button
                    onClick={() => setShowA1((v) => !v)}
                    className={`rounded-full border px-3 py-1 text-xs ${showA1 ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'}`}
                  >
                    🎧 钉钉A1 导入指引
                  </button>
                  <button onClick={handleGenerate} className="rounded-full bg-jushi-accent px-3 py-1 text-xs font-medium text-white">
                    ⚡ 一键生成作业
                  </button>
                </>
              )}
            </div>
          </div>
          {notice && <p className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{notice}</p>}
        </div>

        {tab === '论文' ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold text-slate-400">意向选题（来自学生简况表，可对分身说"换个方向"重新打磨）</div>
              <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-800">{THESIS_TOPIC}</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-500">
                研究方向：工业场景下多模态大模型的产品化路径与市场进入策略 ｜ 框架构想：价值链重塑 · 卖产品→卖能力/服务 · 三种模式成本盈利对比 · 海康/大华/商汤/华为比较案例
              </div>
            </div>

            <div className="mb-2 mt-4 text-xs font-semibold text-slate-500">论文推进（点一步，分身按简况表口径接手）</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {THESIS_STAGES.map((s) => (
                <button
                  key={s.name}
                  onClick={() => {
                    setShowChat(true)
                    setPendingPrompt(s.prompt)
                  }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-jushi-accent"
                >
                  <span className="text-lg">{s.icon}</span>
                  <span className="text-xs font-semibold text-slate-700">{s.name}</span>
                </button>
              ))}
            </div>

            <div className="mb-2 mt-4 text-xs font-semibold text-slate-500">论文材料（归档到 inbox/10_MBA学习_mba/_论文/）</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {THESIS_CATS.map((cat) => (
                <div key={cat} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-700">{cat}</div>
                  <p className="mt-1 flex-1 text-[11px] leading-snug text-slate-400">{THESIS_CAT_DESC[cat]}</p>
                  <button
                    onClick={() =>
                      doUpload('_论文', cat, [
                        { name: '文档', extensions: ['pdf', 'docx', 'doc', 'md', 'txt', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg', 'caj'] }
                      ])
                    }
                    className="mt-2 rounded-lg border border-jushi-accent px-3 py-1.5 text-xs font-medium text-jushi-accent hover:bg-jushi-accent/5"
                  >
                    ⬆ 上传
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-slate-400">
              提示：知网下载的 caj 建议转成 PDF 再传；与导师的微信/邮件沟通可截图上传到「导师意见」。所有论文产出落
              outputs/10_MBA学习_mba/，参考文献库在 _论文工作区/参考文献库.md 持续积累。
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 bg-white px-5 pb-3">
              <div className="flex flex-wrap items-center gap-2">
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
            </div>
            {showA1 && (
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-[12px] leading-relaxed text-slate-600">
                <div className="font-semibold text-slate-700">🎧 钉钉 A1 课堂录音 → 工作台，三步：</div>
                <p className="mt-1">
                  ① 上课用 A1 录音，录完在<b>钉钉 App「AI 助理/闪记」</b>里自动生成转写全文与摘要；② 把<b>转写文本导出</b>
                  （复制为 txt/docx 或分享到电脑），音频可一并导出；③ 回到本页选中课程 → 「上传课堂录音」传上来，之后对分身说「整理这节课的课堂笔记」。
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
                            {cat === '课件' && '课程 PDF/PPT/讲义（含直接放在课程文件夹里的散文件）'}
                            {cat === '作业与要求' && '作业要求原文/评分标准（截图也行）——一键生成作业会先读这里'}
                            {cat === '课堂录音' && '钉钉A1 导出的转写文本与录音（m4a/txt/docx）'}
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
          </>
        )}
      </div>

      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
        <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
      </div>
    </div>
  )
}
