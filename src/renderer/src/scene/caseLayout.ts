import type { AcrylicCaseVariant, CasePreset } from '../../../shared/types'
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
  placementBounds: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
    floorSurface: number
  }
}

export interface AcrylicCaseProfile {
  width: number
  depth: number
  wallHeight: number
}

export const ACRYLIC_CASE_BASE_HEIGHT = 0.12
export const ACRYLIC_CASE_PANEL_THICKNESS = 0.05
export const ACRYLIC_CASE_PROFILES: Record<AcrylicCaseVariant, AcrylicCaseProfile> = {
  low: { width: 3.5, depth: 2.7, wallHeight: 1.8 },
  standard: { width: 3.1, depth: 2.65, wallHeight: 2.8 },
  tall: { width: 2.2, depth: 2.15, wallHeight: 3.55 }
}

const SHELF_PLACEMENT_BOUNDS = {
  minX: -2.48,
  maxX: 2.48,
  minZ: -1.12,
  maxZ: 1.12,
  floorSurface: -0.18
} as const

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
    frameCenterY: 0,
    placementBounds: {
      minX: -5,
      maxX: 5,
      minZ: -5,
      maxZ: 5,
      floorSurface: 0
    }
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
    frameCenterY: 0.73,
    placementBounds: SHELF_PLACEMENT_BOUNDS
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
    frameCenterY: 1.325,
    placementBounds: SHELF_PLACEMENT_BOUNDS
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
    frameCenterY: 1.92,
    placementBounds: SHELF_PLACEMENT_BOUNDS
  }
}

function createAcrylicLayout(profile: AcrylicCaseProfile): CaseLayout {
  const totalHeight = ACRYLIC_CASE_BASE_HEIGHT + profile.wallHeight + ACRYLIC_CASE_PANEL_THICKNESS
  const placementInset = 0.08
  return {
    tierCount: 1,
    shelfHeights: [],
    placementSurfaces: [ACRYLIC_CASE_BASE_HEIGHT],
    cameraOffsetY: (totalHeight - LAYOUTS[3].frameHeight) / 2,
    topHeight: totalHeight,
    backHeight: profile.wallHeight,
    backCenterY: ACRYLIC_CASE_BASE_HEIGHT + profile.wallHeight / 2,
    frameHeight: totalHeight,
    frameCenterY: totalHeight / 2,
    placementBounds: {
      minX: -(profile.width / 2 - placementInset),
      maxX: profile.width / 2 - placementInset,
      minZ: -(profile.depth / 2 - placementInset),
      maxZ: profile.depth / 2 - placementInset,
      floorSurface: 0
    }
  }
}

const ACRYLIC_LAYOUTS: Record<AcrylicCaseVariant, CaseLayout> = {
  low: createAcrylicLayout(ACRYLIC_CASE_PROFILES.low),
  standard: createAcrylicLayout(ACRYLIC_CASE_PROFILES.standard),
  tall: createAcrylicLayout(ACRYLIC_CASE_PROFILES.tall)
}

export function getCaseLayout(preset: CasePreset): CaseLayout {
  const meta = CASE_PRESET_META[preset]
  if (meta.style === 'acrylic') return ACRYLIC_LAYOUTS[meta.acrylicCaseVariant ?? 'standard']
  return LAYOUTS[meta.tier]
}
