import type { QualityPreset } from '../../../shared/types'

export interface RenderQualitySettings {
  pixelRatioLimit: number
  shadowMapSize: number
  shadowsEnabled: boolean
}

const QUALITY_SETTINGS: Record<QualityPreset, RenderQualitySettings> = {
  low: {
    pixelRatioLimit: 1,
    shadowMapSize: 1024,
    shadowsEnabled: false
  },
  balanced: {
    pixelRatioLimit: 1.5,
    shadowMapSize: 1024,
    shadowsEnabled: true
  },
  high: {
    pixelRatioLimit: 2,
    shadowMapSize: 2048,
    shadowsEnabled: true
  }
}

export function renderQualitySettings(quality: QualityPreset): RenderQualitySettings {
  return QUALITY_SETTINGS[quality]
}

export function renderPixelRatio(quality: QualityPreset, devicePixelRatio: number): number {
  return Math.min(Math.max(devicePixelRatio, 1), renderQualitySettings(quality).pixelRatioLimit)
}

export function renderShadowsEnabled(quality: QualityPreset, projectShadowsEnabled: boolean): boolean {
  return projectShadowsEnabled && renderQualitySettings(quality).shadowsEnabled
}
