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

  it('imports STL as a standalone model without linked resources', async () => {
    const root = await temporaryRoot()
    const model = join(root, 'sculpture.stl')
    await writeFile(model, 'solid sculpture\nendsolid sculpture\n')

    expect(await planAssetImports([model])).toMatchObject([{
      kind: 'model',
      extension: 'stl',
      entryRelativePath: 'sculpture.stl',
      files: [{ sourcePath: model, relativePath: 'sculpture.stl' }]
    }])
  })

  it('copies a nested FBX texture beside the model without adding it as an exhibit', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, 'textures'))
    const model = join(root, 'figure.fbx')
    const texture = join(root, 'textures', 'body color.png')
    await writeFile(model, 'Video: 1, "Video::Body", "Clip" {\n  RelativeFilename: "textures\\\\body color.png"\n}\n')
    await writeFile(texture, new Uint8Array([5]))

    const plans = await planAssetImports([model, texture])

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ kind: 'model', extension: 'fbx', entryRelativePath: 'figure.fbx' })
    expect(plans[0].files.map((file) => file.relativePath).sort()).toEqual([
      'body color.png',
      'figure.fbx'
    ])
  })

  it('finds an adjacent FBX texture when the file contains an old absolute Windows path', async () => {
    const root = await temporaryRoot()
    const model = join(root, 'figure.fbx')
    const texture = join(root, 'face.jpg')
    await writeFile(model, 'RelativeFilename: "C:\\\\exports\\\\textures\\\\face.jpg"\n')
    await writeFile(texture, new Uint8Array([6]))

    const [plan] = await planAssetImports([model])

    expect(plan.files).toEqual([
      { sourcePath: model, relativePath: 'figure.fbx' },
      { sourcePath: texture, relativePath: 'face.jpg' }
    ])
  })

  it('reads external texture names from binary FBX string properties', async () => {
    const root = await temporaryRoot()
    const model = join(root, 'binary.fbx')
    const texture = join(root, 'binary-texture.webp')
    const reference = Buffer.from('binary-texture.webp')
    const stringProperty = Buffer.alloc(5 + reference.length)
    stringProperty[0] = 0x53
    stringProperty.writeUInt32LE(reference.length, 1)
    reference.copy(stringProperty, 5)
    await writeFile(model, Buffer.concat([Buffer.from('Kaydara FBX Binary  '), stringProperty]))
    await writeFile(texture, new Uint8Array([7]))

    const [plan] = await planAssetImports([model])

    expect(plan.files.map((file) => file.relativePath)).toEqual(['binary.fbx', 'binary-texture.webp'])
  })

  it('accepts a selected TGA support texture without adding it as an exhibit', async () => {
    const root = await temporaryRoot()
    const model = join(root, 'figure.fbx')
    const texture = join(root, 'body.tga')
    await writeFile(model, 'RelativeFilename: "body.tga"\n')
    await writeFile(texture, new Uint8Array([9]))

    const plans = await planAssetImports([model, texture])

    expect(plans).toHaveLength(1)
    expect(plans[0].files.map((file) => file.relativePath)).toEqual(['figure.fbx', 'body.tga'])
  })

  it('does not copy an FBX texture from outside the model folder', async () => {
    const parent = await temporaryRoot()
    const root = join(parent, 'model')
    await mkdir(root)
    const model = join(root, 'figure.fbx')
    const outsideTexture = join(parent, 'secret.png')
    await writeFile(model, 'RelativeFilename: "../secret.png"\n')
    await writeFile(outsideTexture, new Uint8Array([8]))

    const [plan] = await planAssetImports([model])

    expect(plan.files).toEqual([{ sourcePath: model, relativePath: 'figure.fbx' }])
  })
})
