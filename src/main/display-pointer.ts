export interface DisplayPoint {
  x: number
  y: number
}

export interface DisplayBounds extends DisplayPoint {
  width: number
  height: number
}

export interface DisplayPointerRecoveryState {
  platform: NodeJS.Platform
  pointerIgnored: boolean
  editing: boolean
  clickThrough: boolean
  visible: boolean
}

export function toDisplayClientPoint(cursor: DisplayPoint, bounds: DisplayBounds): DisplayPoint | null {
  const x = cursor.x - bounds.x
  const y = cursor.y - bounds.y
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null
  return { x, y }
}

export function shouldRecoverDisplayPointer(state: DisplayPointerRecoveryState): boolean {
  return state.platform === 'win32'
    && state.pointerIgnored
    && !state.editing
    && !state.clickThrough
    && state.visible
}
