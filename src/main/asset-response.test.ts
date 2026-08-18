import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assetContentType, createAssetResponse } from './asset-response'

const temporaryRoots: string[] = []

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unvirtual-asset-response-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('asset responses', () => {
  it('serves a WebP from a Windows-length path with an explicit image MIME type', async () => {
    const root = await createTemporaryRoot()
    const folder = join(root, 'a'.repeat(120), 'b'.repeat(120))
    const path = join(folder, `${'c'.repeat(150)}.webp`)
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    await mkdir(folder, { recursive: true })
    await writeFile(path, bytes)

    expect(path.length).toBeGreaterThan(260)
    const response = await createAssetResponse(path)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('reports useful content types for linked model resources', () => {
    expect(assetContentType('figure.glb')).toBe('model/gltf-binary')
    expect(assetContentType('figure.gltf')).toBe('model/gltf+json')
    expect(assetContentType('texture.ktx2')).toBe('image/ktx2')
    expect(assetContentType('unknown.data')).toBe('application/octet-stream')
  })

  it('returns 404 for a missing asset', async () => {
    const root = await createTemporaryRoot()
    const response = await createAssetResponse(join(root, 'missing.webp'))
    expect(response.status).toBe(404)
  })
})
