import type { CasePreset } from '../../../shared/types'
import { CASE_PRESET_META } from '../../../shared/types'

export interface CaseLayout {
  tierCount: 0 | 1 | 2 | 3
  shelfHeights: readonly number[]
  placementSurfaces: readonly number[]
  cameraOffsetY: number
  topHeight: number
  backHeight: number
  backCenterY: number
  frameHeight: number
  frameCenterY: number
}

const LAYOUTS: Record<0 | 1 | 2 | 3, CaseLayout> = {
  0: {
    tierCount: 0,
    shelfHeights: [],
    placementSurfaces: [0],
    cameraOffsetY: -1.05,
    topHeight: 0,
    backHeight: 0,
    backCenterY: 0,
    frameHeight: 0,
    frameCenterY: 0
  },
  1: {
    tierCount: 1,
    shelfHeights: [],
    placementSurfaces: [0],
    cameraOffsetY: -1.19,
    topHeight: 1.55,
    backHeight: 1.52,
    backCenterY: 0.69,
    frameHeight: 1.67,
    frameCenterY: 0.73
  },
  2: {
    tierCount: 2,
    shelfHeights: [1.42],
    placementSurfaces: [1.47, 0],
    cameraOffsetY: -0.595,
    topHeight: 2.74,
    backHeight: 2.71,
    backCenterY: 1.285,
    frameHeight: 2.86,
    frameCenterY: 1.325
  },
  3: {
    tierCount: 3,
    shelfHeights: [1.42, 2.78],
    placementSurfaces: [2.83, 1.47, 0],
    cameraOffsetY: 0,
    topHeight: 3.93,
    backHeight: 3.9,
    backCenterY: 1.88,
    frameHeight: 4.05,
    frameCenterY: 1.92
  }
}

export function getCaseLayout(preset: CasePreset): CaseLayout {
  return LAYOUTS[CASE_PRESET_META[preset].tier]
}
