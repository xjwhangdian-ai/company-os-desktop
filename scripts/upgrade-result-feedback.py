#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量改造:App 各工作台页面按钮操作 → 同页持久结果横幅(替代 5s 瞬态提示)。"""
import re, pathlib

ROOT = pathlib.Path('/Users/michael_xi/Code/company-os-desktop/src/renderer/src')

# ── 1) 新建共享组件 ────────────────────────────────────────────────
COMPONENT = '''import type { ReactNode } from 'react'

export type NoticeKind = 'success' | 'warning' | 'error' | 'info'

export interface NoticeState {
  text: string
  kind: NoticeKind
}

/** 按提示文本推断结果状态（含失败/错误/❌ → error；待人工/部分/⚠️ → warning；其余默认 success） */
export function noticeKindOf(text: string): NoticeKind {
  if (/失败|错误|出错|无法|未成功|异常|不存在|❌/.test(text)) return 'error'
  if (/待人工|待确认|部分|警告|注意|未完成|跳过|⚠️/.test(text)) return 'warning'
  return 'success'
}

const KIND_META: Record<NoticeKind, { icon: string; cls: string }> = {
  success: { icon: '✅', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  warning: { icon: '⚠️', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  error: { icon: '❌', cls: 'border-red-200 bg-red-50 text-red-700' },
  info: { icon: 'ℹ️', cls: 'border-slate-200 bg-slate-50 text-slate-600' }
}

/**
 * 操作结果横幅：与按钮同页持久显示执行结果，直到下次操作或手动关闭。
 * 用于替代 5 秒自动消失的瞬态提示，保证"点了按钮就能在同页看到结果"。
 */
export function ResultNotice({ notice, onClose }: { notice: NoticeState | null; onClose: () => void }): ReactNode {
  if (!notice) return null
  const meta = KIND_META[notice.kind] ?? KIND_META.info
  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${meta.cls}`}>
      <span className="min-w-0 flex-1">
        <span className="mr-1">{meta.icon}</span>
        {notice.text}
      </span>
      <button onClick={onClose} className="shrink-0 text-xs opacity-60 hover:opacity-100" aria-label="关闭结果提示">
        ✕
      </button>
    </div>
  )
}
'''
(ROOT / 'components' / 'ResultNotice.tsx').write_text(COMPONENT, encoding='utf-8')
print('created components/ResultNotice.tsx')

IMPORT_ADD = [
    "import { ResultNotice, noticeKindOf } from '../components/ResultNotice'",
    "import type { NoticeState } from '../components/ResultNotice'",
]

# ── 2) 各页 flash 函数 → 持久 + 状态色 ──────────────────────────────
FLASH_RE = re.compile(
    r'function flash\((text|t)(?::\s*string)?\): void \{\n\s*setNotice\(\1\)\n\s*setTimeout\(\(\) => setNotice\(null\), \d+\)\n\s*\}'
)
FLASH_NEW = '''function flash(text: string, kind?: NoticeKind): void {
    setNotice({ text, kind: kind ?? noticeKindOf(text) })
  }'''

STATE_OLD = 'const [notice, setNotice] = useState<string | null>(null)'
STATE_NEW = 'const [notice, setNotice] = useState<NoticeState | null>(null)'

# 各页 notice 渲染块 → ResultNotice
RENDER_MAP = {
    'FinanceWorkspace.tsx': [
        ('{notice && <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'SolutionWorkspace.tsx': [
        ('{notice && <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'BiddingWorkspace.tsx': [
        ('{notice && <div className="border-t border-slate-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{notice}</div>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'BrandWorkspace.tsx': [
        ('{notice && <p className="mt-1 text-xs text-emerald-700">{notice}</p>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'MbaWorkspace.tsx': [
        ('{notice && <p className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{notice}</p>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'OperationWorkspace.tsx': [
        ('{notice && <p className="mb-1 text-xs text-emerald-700">{notice}</p>}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'IntelWorkspace.tsx': [
        ('{notice && (\n          <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">\n            {notice}\n          </div>\n        )}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'LegalWorkspace.tsx': [
        ('{notice && (\n          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">\n            {notice}\n          </div>\n        )}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'OpsPolicyWorkspace.tsx': [
        ('{notice && (\n          <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">{notice}</div>\n        )}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
    'SalesWorkspace.tsx': [
        ('{notice && (\n          <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>\n        )}',
         '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}'),
    ],
}

def insert_imports(src: str) -> str:
    lines = src.split('\n')
    last_import = max(i for i, l in enumerate(lines) if l.startswith('import '))
    for imp in reversed(IMPORT_ADD):
        lines.insert(last_import + 1, imp)
    return '\n'.join(lines)

for fname, renders in RENDER_MAP.items():
    p = ROOT / 'pages' / fname
    src = p.read_text(encoding='utf-8')
    orig = src
    assert FLASH_RE.search(src), f'{fname}: flash 函数未找到'
    src = FLASH_RE.sub(FLASH_NEW, src, count=1)
    assert STATE_OLD in src, f'{fname}: notice state 行未找到'
    src = src.replace(STATE_OLD, STATE_NEW, 1)
    for old, new in renders:
        assert old in src, f'{fname}: 渲染块未找到'
        src = src.replace(old, new, 1)
    src = insert_imports(src)
    p.write_text(src, encoding='utf-8')
    print(f'OK   {fname}')

# ── 3) Settings：flashSaved → 持久结果横幅 ─────────────────────────
p = ROOT / 'pages' / 'Settings.tsx'
src = p.read_text(encoding='utf-8')
orig = src
saved_re = re.compile(
    r'function flashSaved\(text: string\): void \{\n\s*setSavedHint\(text\)\n\s*setTimeout\(\(\) => setSavedHint\(null\), 2000\)\n\s*\}'
)
assert saved_re.search(src), 'Settings flashSaved 未找到'
src = saved_re.sub(
    'function flashSaved(text: string, kind?: NoticeKind): void {\n    setNotice({ text, kind: kind ?? noticeKindOf(text) })\n  }',
    src, count=1)
src = src.replace('const [savedHint, setSavedHint] = useState<string | null>(null)',
                  'const [notice, setNotice] = useState<NoticeState | null>(null)', 1)
src = src.replace('{savedHint && <div className="fixed bottom-6 right-6 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">{savedHint}</div>}',
                  '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}')
src = src.replace('{savedHint && (\n          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">\n            {savedHint}\n          </div>\n        )}',
                  '{notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}')
src = insert_imports(src)
p.write_text(src, encoding='utf-8')
print('OK   Settings.tsx')

# ── 4) 审计：无反馈的按钮处理器 ─────────────────────────────────────
print('\n=== 审计：未调用 flash/flashSaved/setNotice 的 onClick 处理器 ===')
for fname in sorted(x.name for x in (ROOT / 'pages').glob('*.tsx')):
    src = (ROOT / 'pages' / fname).read_text(encoding='utf-8')
    handlers = set(re.findall(r'onClick=\{(\w+)\}', src))
    for h in sorted(handlers):
        m = re.search(rf'function {h}\(.*?\)(?::\s*[\w.<>\[\]]+)?\s*\{{(.*?)\n\s*\}}', src, re.S)
        if not m:
            continue
        body = m.group(1)
        if 'flash(' not in body and 'flashSaved(' not in body and 'setNotice(' not in body and 'setSavedHint(' not in body:
            print(f'  {fname}: {h}（无反馈）')
print('=== 审计完成 ===')
