export interface AcrylicStandBaseDimensions {
  width: number
  depth: number
  height: number
}

export const DEFAULT_ACRYLIC_OFFSET = 0.045
export const MAX_ACRYLIC_OFFSET = 0.12

export function clampAcrylicOffset(value: number, fallback = DEFAULT_ACRYLIC_OFFSET): number {
  const finiteValue = Number.isFinite(value) ? value : fallback
  return Math.min(MAX_ACRYLIC_OFFSET, Math.max(0, finiteValue))
}

export function acrylicOffsetPixelRadius(offset: number, density: number): number {
  return Math.max(0, Math.min(48, Math.round(clampAcrylicOffset(offset) * density)))
}

// Character acrylic stands commonly use a 50 x 30 mm base for a 75 x 100 mm
// body, or a 70 x 40 mm base for a 100 x 130 mm body. Keep the virtual base
// close to that shallow oval footprint instead of using a circular plinth.
export function acrylicStandBaseDimensions(panelWidth: number): AcrylicStandBaseDimensions {
  const width = Math.max(0.36, panelWidth * 0.65)
  return {
    width,
    depth: Math.max(0.2, width * 0.55),
    height: 0.045
  }
}
