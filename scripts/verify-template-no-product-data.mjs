import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const productDir = join(projectRoot, 'resources', 'company-os-template', 'libraries', '01_销售_sales', '产品库')

function listForbiddenFiles(dir) {
  const files = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) files.push(...listForbiddenFiles(path))
    else if (name.isFile() && name.name !== '.gitkeep' && statSync(path).size >= 0) files.push(path)
  }
  return files
}

const forbidden = listForbiddenFiles(productDir)
if (forbidden.length > 0) {
  console.error('安装模板中检测到产品库业务数据，已终止打包：')
  for (const file of forbidden) console.error(`- ${relative(projectRoot, file)}`)
  process.exit(1)
}

console.log('安装模板检查通过：不包含产品库清单或图片数据。')
