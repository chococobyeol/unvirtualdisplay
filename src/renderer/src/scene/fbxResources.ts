const FBX_TEXTURE_EXTENSION = /\.(?:png|jpe?g|webp|bmp|tga|dds|ktx2)(?:[?#].*)?$/i

export function redirectFbxTextureUrl(modelUrl: string, requestedUrl: string): string {
  if (!FBX_TEXTURE_EXTENSION.test(requestedUrl) || /^(?:data|blob):/i.test(requestedUrl)) return requestedUrl

  const normalized = requestedUrl.replaceAll('\\', '/')
  const textureName = normalized.slice(normalized.lastIndexOf('/') + 1)
  const modelBase = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1)
  return textureName && modelBase ? `${modelBase}${textureName}` : requestedUrl
}
