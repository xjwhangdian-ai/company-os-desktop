import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { FinanceEmployee, FinanceLedger, FinanceOverview, FinanceTask, OutputEntry } from '@shared/agent-types'

// ============ 财务工作台（记账/报税/工资社保，替代第三方财税代理） ============
// 定位：把财税代理公司的「记账、报税、凭证相关服务」搬进 App——
//   票据归档 → input/08_财务_finance/票据/{YYYY-MM}/（输入侧）
//   记账凭证/报税底稿/工资表 → outputs/08_财务_finance/{YYYY-MM}_xxx/（finance 分身产出）
//   员工配置/发薪日/月度任务勾选 → 财务/财税台账.json（App 托管，path-guard 拦分身直写）
// 红线：App 与分身只做「提醒 + 底稿 + 台账」，实际申报在电子税务局由人完成；
//       口径以税务机关与税务师为准，社保基数等地方数字由分身联网查并标注来源。

const LEDGER_REL = join('财务', '财税台账.json')
const RECEIPTS_ROOT_REL = join('input', '08_财务_finance', '票据')

function ledgerPath(dataDir: string): string {
  return join(dataDir, LEDGER_REL)
}

function defaultLedger(): FinanceLedger {
  return {
    version: 1,
    发薪日: 10,
    员工: [
      { id: 'emp-legal', 姓名: '法定代表人（本人）', 角色: '法定代表人', 月工资: '', 参保: true },
      { id: 'emp-001', 姓名: '员工一', 角色: '员工', 月工资: '', 参保: true }
    ],
    月度勾选: {}
  }
}

export function readLedger(dataDir: string): FinanceLedger {
  const p = ledgerPath(dataDir)
  if (!existsSync(p)) return defaultLedger()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    const base = defaultLedger()
    return {
      version: 1,
      发薪日: typeof raw?.发薪日 === 'number' && raw.发薪日 >= 1 && raw.发薪日 <= 28 ? raw.发薪日 : base.发薪日,
      员工: Array.isArray(raw?.员工) && raw.员工.length > 0 ? raw.员工 : base.员工,
      月度勾选: raw?.月度勾选 && typeof raw.月度勾选 === 'object' ? raw.月度勾选 : {}
    }
  } catch {
    return defaultLedger()
  }
}

function writeLedger(dataDir: string, ledger: FinanceLedger): void {
  const p = ledgerPath(dataDir)
  mkdirSync(join(dataDir, '财务'), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function saveEmployees(dataDir: string, 员工: FinanceEmployee[], 发薪日: number): FinanceLedger {
  const ledger = readLedger(dataDir)
  ledger.员工 = 员工.filter((e) => e.姓名.trim())
  if (发薪日 >= 1 && 发薪日 <= 28) ledger.发薪日 = 发薪日
  writeLedger(dataDir, ledger)
  return ledger
}

// ── 月度财税任务清单（一般纳税人口径） ──────────────────────────

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 生成某月的财税任务清单。日期为通行口径（申报期遇节假日顺延），
 * 具体截止以电子税务局当月公告为准——说明里已标注。
 */
function buildMonthTasks(year: number, month: number, 发薪日: number): FinanceTask[] {
  const m = String(month).padStart(2, '0')
  const tasks: FinanceTask[] = [
    {
      key: 'salary',
      名称: `发放工资（每月${发薪日}号）`,
      截止: `${year}-${m}-${String(发薪日).padStart(2, '0')}`,
      说明: '2 名参保人员（法定代表人+员工）；发放后记得留存工资表与银行回单'
    },
    {
      key: 'iit',
      名称: '个税申报（工资薪金·累计预扣）',
      截止: `${year}-${m}-15`,
      说明: '自然人电子税务局（扣缴端）申报上月工资个税；申报期遇节假日顺延，以当月公告为准'
    },
    {
      key: 'vat',
      名称: '增值税及附加税申报（一般纳税人·月报）',
      截止: `${year}-${m}-15`,
      说明: '电子税务局申报上月增值税+城建税/教育费附加/地方教育附加；进项发票记得先勾选认证'
    },
    {
      key: 'social',
      名称: '社保/医保缴费核对',
      截止: `${year}-${m}-25`,
      说明: '2 人参保；核对当月社保医保扣款是否成功、基数是否正确'
    },
    {
      key: 'bookkeeping',
      名称: '本月记账（凭证+账册+报表）',
      截止: `${year}-${m}-28`,
      说明: '票据传进「记账报税」页 → AI 编制记账凭证与月度报表底稿 → 人工复核'
    }
  ]
  // 季度首月：申报上季度企业所得税预缴
  if ([1, 4, 7, 10].includes(month)) {
    tasks.splice(3, 0, {
      key: 'cit-quarter',
      名称: '企业所得税季度预缴申报',
      截止: `${year}-${m}-15`,
      说明: '申报上季度企业所得税预缴；小微优惠条件是否适用请以申报表自动判定为准'
    })
  }
  // 年度事项
  if (month === 5) {
    tasks.push({ key: 'cit-annual', 名称: '企业所得税汇算清缴（年度）', 截止: `${year}-05-31`, 说明: '上年度汇算清缴，5月31日前完成' })
  }
  if (month === 6) {
    tasks.push({ key: 'annual-report', 名称: '工商年报（年度）', 截止: `${year}-06-30`, 说明: '国家企业信用信息公示系统报送上年度年报' })
  }
  if (month === 9) {
    tasks.push({ key: 'disability-fund', 名称: '残保金申报（年度）', 截止: `${year}-09-30`, 说明: '浙江申报期通常在下半年，具体月份以当年公告为准（待确认）；30人以下企业多可免征，申报仍需做' })
  }
  return tasks
}

export function getOverview(dataDir: string, ym?: string): FinanceOverview {
  const now = new Date()
  const key = ym ?? monthKey(now)
  const [y, m] = key.split('-').map(Number)
  const ledger = readLedger(dataDir)
  const done = ledger.月度勾选[key] ?? {}
  const tasks = buildMonthTasks(y, m, ledger.发薪日).map((t) => ({ ...t, done: Boolean(done[t.key]) }))
  const todayIsPayday = now.getDate() === ledger.发薪日 && key === monthKey(now)
  return {
    月份: key,
    任务: tasks,
    员工: ledger.员工,
    发薪日: ledger.发薪日,
    今天是发薪日: todayIsPayday,
    本月票据数: countReceipts(dataDir, key)
  }
}

export function toggleTask(dataDir: string, ym: string, taskKey: string, done: boolean): void {
  const ledger = readLedger(dataDir)
  if (!ledger.月度勾选[ym]) ledger.月度勾选[ym] = {}
  ledger.月度勾选[ym][taskKey] = done
  writeLedger(dataDir, ledger)
}

// ── 票据归档 ─────────────────────────────────────────────

function receiptsDir(dataDir: string, ym: string): string {
  return join(dataDir, RECEIPTS_ROOT_REL, ym)
}

function countReceipts(dataDir: string, ym: string): number {
  const dir = receiptsDir(dataDir, ym)
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((n) => !n.startsWith('.')).length
}

/** 票据（发票/回单/工资凭证扫描件）落 input/08_财务_finance/票据/{YYYY-MM}/，重名自动加序号 */
export function uploadReceipt(dataDir: string, ym: string, sourcePath: string): { relativePath: string } {
  const dir = receiptsDir(dataDir, ym)
  mkdirSync(dir, { recursive: true })
  const ext = extname(sourcePath)
  const stem = basename(sourcePath, ext)
  let dest = join(dir, basename(sourcePath))
  let i = 1
  while (existsSync(dest)) {
    dest = join(dir, `${stem}_${i}${ext}`)
    i += 1
  }
  copyFileSync(sourcePath, dest)
  return { relativePath: join(RECEIPTS_ROOT_REL, ym, basename(dest)) }
}

export function listReceipts(dataDir: string, ym: string): OutputEntry[] {
  const dir = receiptsDir(dataDir, ym)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      const full = join(dir, name)
      const st = statSync(full)
      return {
        name,
        path: full,
        relativePath: join(RECEIPTS_ROOT_REL, ym, name),
        isDirectory: false,
        size: st.size,
        mtimeMs: st.mtimeMs
      }
    })
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
}
