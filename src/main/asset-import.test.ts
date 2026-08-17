import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planAssetImports } from './asset-import'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unvirtual-asset-plan-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('planAssetImports', () => {
  it('copies nested glTF resources without adding dependency textures as exhibits', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, 'textures'))
    const model = join(root, 'figure.gltf')
    const binary = join(root, 'figure.bin')
    const texture = join(root, 'textures', 'diffuse.png')
    await writeFile(model, JSON.stringify({ buffers: [{ uri: 'figure.bin' }], images: [{ uri: 'textures/diffuse.png' }] }))
    await writeFile(binary, new Uint8Array([1]))
    await writeFile(texture, new Uint8Array([2]))

    const plans = await planAssetImports([model, binary, texture])

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ kind: 'model', extension: 'gltf', entryRelativePath: 'figure.gltf' })
    expect(plans[0].files.map((file) => file.relativePath).sort()).toEqual([
      'figure.bin',
      'figure.gltf',
      'textures/diffuse.png'
    ])
  })

  it('includes OBJ material files and their textures', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, 'materials'))
    await mkdir(join(root, 'textures'))
    const model = join(root, 'figure.obj')
    const material = join(root, 'materials', 'figure.mtl')
    const texture = join(root, 'textures', 'body color.png')
    await writeFile(model, 'mtllib materials/figure.mtl\no Figure\nv 0 0 0\n')
    await writeFile(material, 'newmtl Body\nmap_Kd -s 1 1 1 ../textures/body color.png\n')
    await writeFile(texture, new Uint8Array([3]))

    const [plan] = await planAssetImports([model])

    expect(plan.files.map((file) => file.relativePath).sort()).toEqual([
      'figure.obj',
      'materials/figure.mtl',
      'textures/body color.png'
    ])
  })

  it('keeps an independently selected image as an exhibit', async () => {
    const root = await temporaryRoot()
    const image = join(root, 'standee.png')
    await writeFile(image, new Uint8Array([4]))

    expect(await planAssetImports([image])).toMatchObject([
      { kind: 'image', extension: 'png', entryRelativePath: 'standee.png' }
    ])
  })
})
