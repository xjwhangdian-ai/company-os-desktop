import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

function uniqueDestPath(destDir: string, fileName: string): string {
  mkdirSync(destDir, { recursive: true })
  let dest = join(destDir, fileName)
  if (!existsSync(dest)) return dest
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let i = 1
  while (existsSync(dest)) {
    dest = join(destDir, `${stem}_${i}${ext}`)
    i++
  }
  return dest
}

/** 通用上传：8 个非 bidding 分身用，文件落 inbox/，返回相对数据目录的路径供拼进聊天 prompt */
export function uploadToInbox(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'inbox')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `inbox/${basename(dest)}` }
}

/** bidding 专属：招标原文件落 bidding/ 根目录（触发分身自动建项目文件夹） */
export function uploadToBiddingRoot(dataDir: string, sourcePath: string): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'bidding')
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `bidding/${basename(dest)}` }
}

/** bidding 专属：素材库 5 分类各自的上传入口 */
export function uploadToMaterialLibrary(
  dataDir: string,
  category: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, 'bidding', '_素材库', category)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `bidding/_素材库/${category}/${basename(dest)}` }
}

/**
 * 法务专属：合同/法律材料落 法务/待审/。合同类型（销售合同/工程合同/其他）编码进文件名前缀
 * 【类型】，不额外起分类子文件夹——待审目录本来就该是"当前要处理的东西一眼看完"的平铺列表，
 * 分类信息够用文件名标出来就行，不用为了分类牺牲这个。
 */
export function uploadToLegalPending(
  dataDir: string,
  sourcePath: string,
  category: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, '法务', '待审')
  const fileName = `【${category}】${basename(sourcePath)}`
  const dest = uniqueDestPath(destDir, fileName)
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `法务/待审/${basename(dest)}` }
}

/** 法务专属：合同模板按类型存进 法务/_模板/合同模板/{category}/，供"与模板对比"功能匹配 */
export function uploadToLegalTemplate(
  dataDir: string,
  category: string,
  sourcePath: string
): { absPath: string; relativePath: string } {
  const destDir = join(dataDir, '法务', '_模板', '合同模板', category)
  const dest = uniqueDestPath(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return { absPath: dest, relativePath: `法务/_模板/合同模板/${category}/${basename(dest)}` }
}
