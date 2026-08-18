import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'vrm', 'fbx', 'obj', 'stl'])
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
export const SUPPORT_EXTENSIONS = new Set(['bin', 'mtl'])

export interface AssetImportFile {
  sourcePath: string
  relativePath: string
}

export interface AssetImportPlan {
  sourcePath: string
  entryRelativePath: string
  extension: string
  kind: 'model' | 'image'
  files: AssetImportFile[]
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function localUri(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^(?:data|https?|blob):/i.test(value) || value.startsWith('//')) return null
  const withoutSuffix = value.split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(withoutSuffix).replaceAll('\\', '/')
  } catch {
    return withoutSuffix.replaceAll('\\', '/')
  }
}

function dependencyWithinRoot(root: string, dependencyPath: string): { sourcePath: string; relativePath: string } | null {
  if (!dependencyPath || isAbsolute(dependencyPath)) return null
  const sourcePath = resolve(root, dependencyPath)
  const relativePath = relative(root, sourcePath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null
  return { sourcePath, relativePath: relativePath.split(sep).join('/') }
}

async function existingDependency(root: string, dependencyPath: string): Promise<AssetImportFile | null> {
  const dependency = dependencyWithinRoot(root, dependencyPath)
  return dependency && await isFile(dependency.sourcePath) ? dependency : null
}

async function gltfDependencies(path: string): Promise<AssetImportFile[]> {
  try {
    const root = dirname(path)
    const document = JSON.parse(await readFile(path, 'utf8')) as {
      buffers?: { uri?: unknown }[]
      images?: { uri?: unknown }[]
    }
    const uris = [...document.buffers ?? [], ...document.images ?? []]
      .map((entry) => localUri(entry.uri))
      .filter((uri): uri is string => Boolean(uri))
    return (await Promise.all(uris.map((uri) => existingDependency(root, uri))))
      .filter((entry): entry is AssetImportFile => Boolean(entry))
  } catch {
    return []
  }
}

async function resolveMtlReference(mtlFolder: string, modelRoot: string, value: string): Promise<AssetImportFile | null> {
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  for (let start = 0; start < tokens.length; start += 1) {
    const candidate = tokens.slice(start).join(' ')
    const sourcePath = resolve(mtlFolder, candidate)
    const relativePath = relative(modelRoot, sourcePath)
    if (relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && await isFile(sourcePath)) {
      return { sourcePath, relativePath: relativePath.split(sep).join('/') }
    }
  }
  return null
}

async function mtlDependencies(path: string, modelRoot: string): Promise<AssetImportFile[]> {
  try {
    const dependencies: AssetImportFile[] = []
    const folder = dirname(path)
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
      const match = line.trim().match(/^(?:map_[a-z0-9_]+|bump|disp|decal|refl|norm)\s+(.+)$/i)
      if (!match) continue
      const dependency = await resolveMtlReference(folder, modelRoot, match[1])
      if (dependency) dependencies.push(dependency)
    }
    return dependencies
  } catch {
    return []
  }
}

async function objDependencies(path: string): Promise<AssetImportFile[]> {
  try {
    const root = dirname(path)
    const dependencies: AssetImportFile[] = []
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/)
    for (const line of lines) {
      const match = line.trim().match(/^mtllib\s+(.+)$/i)
      if (!match) continue
      const raw = match[1].trim()
      const references = await isFile(resolve(root, raw)) ? [raw] : raw.split(/\s+/)
      for (const reference of references) {
        const mtl = await existingDependency(root, reference)
        if (!mtl) continue
        dependencies.push(mtl, ...await mtlDependencies(mtl.sourcePath, root))
      }
    }
    return dependencies
  } catch {
    return []
  }
}

function uniqueFiles(files: AssetImportFile[]): AssetImportFile[] {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = normalize(file.sourcePath)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function planAssetImports(paths: readonly string[]): Promise<AssetImportPlan[]> {
  const selected = [...new Set(paths.map((path) => resolve(path)))]
    .filter((path) => {
      const extension = extname(path).slice(1).toLowerCase()
      return MODEL_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension) || SUPPORT_EXTENSIONS.has(extension)
    })
  const consumedDependencies = new Set<string>()
  const plans: AssetImportPlan[] = []

  for (const sourcePath of selected) {
    const extension = extname(sourcePath).slice(1).toLowerCase()
    if (!MODEL_EXTENSIONS.has(extension)) continue
    const entryRelativePath = sourcePath.slice(dirname(sourcePath).length + 1)
    const dependencies = extension === 'gltf'
      ? await gltfDependencies(sourcePath)
      : extension === 'obj'
        ? await objDependencies(sourcePath)
        : []
    dependencies.forEach((file) => consumedDependencies.add(normalize(file.sourcePath)))
    plans.push({
      sourcePath,
      entryRelativePath,
      extension,
      kind: 'model',
      files: uniqueFiles([{ sourcePath, relativePath: entryRelativePath }, ...dependencies])
    })
  }

  for (const sourcePath of selected) {
    const extension = extname(sourcePath).slice(1).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(extension) || consumedDependencies.has(normalize(sourcePath))) continue
    const entryRelativePath = sourcePath.slice(dirname(sourcePath).length + 1)
    plans.push({
      sourcePath,
      entryRelativePath,
      extension,
      kind: 'image',
      files: [{ sourcePath, relativePath: entryRelativePath }]
    })
  }

  return plans
}
