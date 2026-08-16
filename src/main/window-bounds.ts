import type { Rectangle } from 'electron'

const EDGE_MARGIN = 24
const MIN_WIDTH = 320
const MIN_HEIGHT = 240
const MAX_INITIAL_WIDTH = 420
const INITIAL_ASPECT_RATIO = 4 / 3

export function getDefaultDisplayBounds(workArea: Rectangle): Rectangle {
  const margin = workArea.width >= MIN_WIDTH + EDGE_MARGIN * 2
    && workArea.height >= MIN_HEIGHT + EDGE_MARGIN * 2
    ? EDGE_MARGIN
    : 0
  const availableWidth = Math.max(MIN_WIDTH, workArea.width - margin * 2)
  const availableHeight = Math.max(MIN_HEIGHT, workArea.height - margin * 2)
  const preferredWidth = Math.min(MAX_INITIAL_WIDTH, Math.max(MIN_WIDTH, Math.round(workArea.width * 0.22)))
  const width = Math.min(preferredWidth, availableWidth)
  const height = Math.min(Math.max(MIN_HEIGHT, Math.round(width / INITIAL_ASPECT_RATIO)), availableHeight)

  return {
    x: workArea.x + Math.max(0, workArea.width - width - margin),
    y: workArea.y + Math.max(0, workArea.height - height - margin),
    width,
    height
  }
}
