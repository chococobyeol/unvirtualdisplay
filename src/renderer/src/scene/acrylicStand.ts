export interface AcrylicStandBaseDimensions {
  width: number
  depth: number
  height: number
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
