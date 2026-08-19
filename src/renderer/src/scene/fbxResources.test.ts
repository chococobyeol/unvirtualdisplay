import { describe, expect, it } from 'vitest'
import { redirectFbxTextureUrl } from './fbxResources'

describe('redirectFbxTextureUrl', () => {
  const modelUrl = 'uvd-asset://project-id/import-id/figure.fbx'

  it('loads a nested texture from beside the copied FBX', () => {
    expect(redirectFbxTextureUrl(
      modelUrl,
      'uvd-asset://project-id/import-id/textures/body%20color.png'
    )).toBe('uvd-asset://project-id/import-id/body%20color.png')
  })

  it('handles old Windows paths embedded in an FBX', () => {
    expect(redirectFbxTextureUrl(modelUrl, String.raw`C:\exports\textures\face.jpg`))
      .toBe('uvd-asset://project-id/import-id/face.jpg')
  })

  it('leaves the model and embedded image URLs untouched', () => {
    expect(redirectFbxTextureUrl(modelUrl, modelUrl)).toBe(modelUrl)
    expect(redirectFbxTextureUrl(modelUrl, 'data:image/png;base64,AAAA'))
      .toBe('data:image/png;base64,AAAA')
  })
})
