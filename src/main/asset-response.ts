import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, toNamespacedPath } from 'node:path'
import { Readable } from 'node:stream'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bin': 'application/octet-stream',
  '.bmp': 'image/bmp',
  '.dds': 'image/vnd-ms.dds',
  '.fbx': 'application/octet-stream',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.mtl': 'text/plain; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tga': 'image/x-tga',
  '.vrm': 'model/gltf-binary',
  '.webp': 'image/webp'
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function assetContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Serves project assets from Node's filesystem layer instead of sending a
 * file:// URL back through Chromium. Besides making the response MIME type
 * deterministic, this keeps long Windows paths out of Chromium's file loader.
 */
export async function createAssetResponse(path: string, method = 'GET'): Promise<Response> {
  try {
    const filesystemPath = toNamespacedPath(path)
    const info = await stat(filesystemPath)
    if (!info.isFile()) return new Response('Not found', { status: 404 })

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Content-Length': String(info.size),
      'Content-Type': assetContentType(path),
      'Cross-Origin-Resource-Policy': 'cross-origin'
    })
    if (method === 'HEAD') return new Response(null, { status: 200, headers })

    const body = Readable.toWeb(createReadStream(filesystemPath)) as ReadableStream<Uint8Array>
    return new Response(body, { status: 200, headers })
  } catch (error) {
    if (isMissingFileError(error)) return new Response('Not found', { status: 404 })
    throw error
  }
}
