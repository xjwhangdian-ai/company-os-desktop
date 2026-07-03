import { useEffect, useState } from 'react'
import type { MaterialLibraryCounts } from '@shared/agent-types'
import { FileDropzone } from './FileDropzone'

const CATEGORIES: { key: keyof MaterialLibraryCounts; label: string; hint: string }[] = [
  { key: '产品资料', label: '产品资料', hint: '产品配置、技术参数、选型清单' },
  { key: '产品检测报告', label: '产品检测报告', hint: '技术响应佐证、检测/认证加分项' },
  { key: '产品解决方案', label: '产品解决方案', hint: '项目理解、总体技术方案、案例' },
  { key: '人员资质', label: '人员资质', hint: '项目实施人员资质证明' },
  { key: '类似项目合同', label: '类似项目合同', hint: '智能化类/装备类历史合同' }
]

/**
 * 素材库五分类粗判：只统计文件数量供参考"大概率缺什么"，不做语义匹配——
 * 精确判断仍由 bidding 分身在实际生成投标文件时完成，这里不代替 AI 做判断。
 */
export function MaterialChecklist({ refreshKey }: { refreshKey?: number }): React.JSX.Element {
  const [counts, setCounts] = useState<MaterialLibraryCounts | null>(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    window.api.bidding.materialCounts().then(setCounts)
  }, [refreshKey, bump])

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        以下是 bidding/_素材库/ 各分类的文件数量粗判，仅供参考——0 个文件大概率是缺口，具体是否够用由 bidding
        分身在生成投标文件时判断。
      </p>
      {CATEGORIES.map((cat) => (
        <div key={cat.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{cat.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  counts && counts[cat.key] > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                }`}
              >
                {counts ? counts[cat.key] : '…'} 个文件
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-400">{cat.hint}</p>
          </div>
          <FileDropzone
            compact
            uploadFn={(p) => window.api.upload.biddingMaterial(cat.key, p)}
            onUploaded={() => setBump((b) => b + 1)}
          />
        </div>
      ))}
    </div>
  )
}
