import * as THREE from 'three'
import { EndType, JoinType, areaD, inflatePathsD, type PathD } from 'clipper2-ts'
import { ACRYLIC_PANEL_DEPTH } from './imageAcrylicCollider'

interface GridPoint {
  x: number
  y: number
}

interface BoundaryEdge {
  from: GridPoint
  to: GridPoint
  direction: number
  used: boolean
}

export interface AcrylicContourOptions {
  alpha: Uint8ClampedArray
  width: number
  height: number
  worldWidth: number
  worldHeight: number
  threshold?: number
  simplifyTolerance?: number
  cornerRadius?: number
}

export interface AcrylicContourGeometryOptions extends AcrylicContourOptions {
  depth?: number
  curveSegments?: number
  offset?: number
}

export interface AcrylicContourGeometryResult {
  geometry: THREE.BufferGeometry
  paths: THREE.Vector2[][]
}

export interface AcrylicMaskConnectionOptions {
  threshold?: number
  bridgeRadius?: number
  maxComponents?: number
}

interface MaskComponent {
  id: number
  pixels: number[]
}

const DEFAULT_ACRYLIC_ALPHA_THRESHOLD = 16

function labelMaskComponents(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): { labels: Int32Array, components: MaskComponent[] } {
  const labels = new Int32Array(width * height)
  labels.fill(-1)
  const components: MaskComponent[] = []
  const queue = new Int32Array(width * height)

  for (let start = 0; start < labels.length; start += 1) {
    if (alpha[start] < threshold || labels[start] >= 0) continue
    const id = components.length
    const pixels: number[] = []
    let head = 0
    let tail = 0
    labels[start] = id
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]
      pixels.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) continue
          const nextX = x + deltaX
          const nextY = y + deltaY
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
          const next = nextY * width + nextX
          if (alpha[next] < threshold || labels[next] >= 0) continue
          labels[next] = id
          queue[tail++] = next
        }
      }
    }
    components.push({ id, pixels })
  }
  return { labels, components }
}

/**
 * Joins disconnected printed islands with narrow clear bridges. A physical
 * contour stand must remain one manufacturable plate even when its artwork
 * contains detached accessories, effects, or diagonally separated pixels.
 */
export function connectAcrylicMaskComponents(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  options: AcrylicMaskConnectionOptions = {}
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || alpha.length < width * height) {
    throw new Error('Invalid acrylic mask dimensions')
  }
  const threshold = Math.min(255, Math.max(1, Math.round(
    options.threshold ?? DEFAULT_ACRYLIC_ALPHA_THRESHOLD
  )))
  const result = alpha.slice()
  const { labels, components } = labelMaskComponents(result, width, height, threshold)
  const maximumComponents = Math.max(1, Math.min(64, Math.round(options.maxComponents ?? 24)))
  const sortedComponents = [...components]
    .sort((left, right) => right.pixels.length - left.pixels.length)
  const largestComponentPixels = sortedComponents[0]?.pixels.length ?? 0
  const minimumComponentPixels = Math.max(
    4,
    Math.ceil(largestComponentPixels * 0.0002),
    Math.ceil(width * height * 0.00005)
  )
  const retained = sortedComponents
    // Exported PNG/WebP files commonly contain a few almost invisible alpha
    // specks around the artwork. Connecting those specks creates long clear
    // spikes, so only bridge islands large enough to be intentional artwork.
    .filter((component, index) => index === 0 || component.pixels.length >= minimumComponentPixels)
    .slice(0, maximumComponents)

  const retainedIds = new Set(retained.map((component) => component.id))
  for (const component of components) {
    if (retainedIds.has(component.id)) continue
    for (const pixel of component.pixels) result[pixel] = 0
  }
  if (retained.length <= 1) return result

  const attached = new Uint8Array(width * height)
  for (const pixel of retained[0].pixels) attached[pixel] = 1
  const unattachedIds = new Set(retained.slice(1).map((component) => component.id))
  const componentsById = new Map(retained.map((component) => [component.id, component]))
  const bridgeRadius = Math.max(1, Math.min(6, Math.round(options.bridgeRadius ?? 2)))
  const queue = new Int32Array(width * height)
  const parent = new Int32Array(width * height)
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ] as const

  while (unattachedIds.size > 0) {
    parent.fill(-2)
    let head = 0
    let tail = 0
    for (let index = 0; index < attached.length; index += 1) {
      if (!attached[index]) continue
      parent[index] = -1
      queue[tail++] = index
    }

    let reachedFrom = -1
    let reachedPixel = -1
    let reachedComponent = -1
    while (head < tail && reachedComponent < 0) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      for (const [deltaX, deltaY] of directions) {
        const nextX = x + deltaX
        const nextY = y + deltaY
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
        const next = nextY * width + nextX
        const componentId = labels[next]
        if (unattachedIds.has(componentId)) {
          reachedFrom = index
          reachedPixel = next
          reachedComponent = componentId
          break
        }
        if (parent[next] !== -2) continue
        parent[next] = index
        queue[tail++] = next
      }
    }
    if (reachedComponent < 0) break

    const path = [reachedPixel]
    for (let cursor = reachedFrom; cursor >= 0; cursor = parent[cursor]) path.push(cursor)
    for (const index of path) {
      const centerX = index % width
      const centerY = Math.floor(index / width)
      for (let deltaY = -bridgeRadius; deltaY <= bridgeRadius; deltaY += 1) {
        for (let deltaX = -bridgeRadius; deltaX <= bridgeRadius; deltaX += 1) {
          if (deltaX ** 2 + deltaY ** 2 > bridgeRadius ** 2) continue
          const x = centerX + deltaX
          const y = centerY + deltaY
          if (x < 0 || x >= width || y < 0 || y >= height) continue
          const bridgePixel = y * width + x
          result[bridgePixel] = 255
          attached[bridgePixel] = 1
        }
      }
    }
    for (const pixel of componentsById.get(reachedComponent)?.pixels ?? []) attached[pixel] = 1
    unattachedIds.delete(reachedComponent)
  }
  return result
}

function pointKey(point: GridPoint): string {
  return `${point.x}:${point.y}`
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y
}

function signedArea(points: readonly GridPoint[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function removeCollinearPoints(points: readonly GridPoint[]): GridPoint[] {
  if (points.length <= 3) return [...points]
  return points.filter((current, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    const next = points[(index + 1) % points.length]
    return (current.x - previous.x) * (next.y - current.y)
      !== (current.y - previous.y) * (next.x - current.x)
  })
}

function segmentDistanceSquared(point: GridPoint, start: GridPoint, end: GridPoint): number {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  if (segmentX === 0 && segmentY === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  }
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY)
      / (segmentX ** 2 + segmentY ** 2)
  ))
  const distanceX = point.x - (start.x + segmentX * projection)
  const distanceY = point.y - (start.y + segmentY * projection)
  return distanceX ** 2 + distanceY ** 2
}

function simplifyOpenPath(points: readonly GridPoint[], toleranceSquared: number): GridPoint[] {
  if (points.length <= 2) return [...points]
  let furthestIndex = -1
  let furthestDistance = toleranceSquared
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = segmentDistanceSquared(points[index], points[0], points[points.length - 1])
    if (distance > furthestDistance) {
      furthestIndex = index
      furthestDistance = distance
    }
  }
  if (furthestIndex < 0) return [points[0], points[points.length - 1]]
  const left = simplifyOpenPath(points.slice(0, furthestIndex + 1), toleranceSquared)
  const right = simplifyOpenPath(points.slice(furthestIndex), toleranceSquared)
  return [...left.slice(0, -1), ...right]
}

function ringSection(points: readonly GridPoint[], start: number, end: number): GridPoint[] {
  const section: GridPoint[] = [points[start]]
  let index = start
  while (index !== end) {
    index = (index + 1) % points.length
    section.push(points[index])
  }
  return section
}

function simplifyClosedPath(points: readonly GridPoint[], tolerance: number): GridPoint[] {
  const corners = removeCollinearPoints(points)
  if (corners.length <= 4 || tolerance <= 0) return corners

  let anchor = 0
  for (let index = 1; index < corners.length; index += 1) {
    if (corners[index].x < corners[anchor].x
      || (corners[index].x === corners[anchor].x && corners[index].y < corners[anchor].y)) {
      anchor = index
    }
  }
  let opposite = anchor
  let maximumDistance = -1
  for (let index = 0; index < corners.length; index += 1) {
    const distance = (corners[index].x - corners[anchor].x) ** 2
      + (corners[index].y - corners[anchor].y) ** 2
    if (distance > maximumDistance) {
      opposite = index
      maximumDistance = distance
    }
  }
  if (opposite === anchor) return corners

  const toleranceSquared = tolerance ** 2
  const first = simplifyOpenPath(ringSection(corners, anchor, opposite), toleranceSquared)
  const second = simplifyOpenPath(ringSection(corners, opposite, anchor), toleranceSquared)
  const simplified = removeCollinearPoints([
    ...first.slice(0, -1),
    ...second.slice(0, -1)
  ])
  return simplified.length >= 3 ? simplified : corners
}

function traceBoundaryLoops(filled: readonly boolean[], width: number, height: number): GridPoint[][] {
  const edges: BoundaryEdge[] = []
  const starts = new Map<string, number[]>()
  const occupied = (x: number, y: number): boolean => (
    x >= 0 && x < width && y >= 0 && y < height && filled[y * width + x]
  )
  const addEdge = (from: GridPoint, to: GridPoint, direction: number): void => {
    const index = edges.length
    edges.push({ from, to, direction, used: false })
    const key = pointKey(from)
    const matches = starts.get(key) ?? []
    matches.push(index)
    starts.set(key, matches)
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!occupied(x, y)) continue
      if (!occupied(x, y - 1)) addEdge({ x, y }, { x: x + 1, y }, 0)
      if (!occupied(x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 }, 1)
      if (!occupied(x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 }, 2)
      if (!occupied(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y }, 3)
    }
  }

  const loops: GridPoint[][] = []
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (edges[startIndex].used) continue
    const firstEdge = edges[startIndex]
    const loop: GridPoint[] = [firstEdge.from]
    let edgeIndex = startIndex
    let closed = false

    for (let step = 0; step <= edges.length; step += 1) {
      const edge = edges[edgeIndex]
      edge.used = true
      if (samePoint(edge.to, loop[0])) {
        closed = true
        break
      }
      loop.push(edge.to)
      const candidates = (starts.get(pointKey(edge.to)) ?? []).filter((candidate) => !edges[candidate].used)
      if (candidates.length === 0) break
      edgeIndex = candidates.sort((left, right) => {
        const leftTurn = (edges[left].direction - edge.direction + 4) % 4
        const rightTurn = (edges[right].direction - edge.direction + 4) % 4
        const rank = (turn: number): number => turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3
        return rank(leftTurn) - rank(rightTurn)
      })[0]
    }
    if (closed && loop.length >= 3) loops.push(loop)
  }
  return loops
}

function roundedCorner(points: readonly GridPoint[], index: number, radius: number): {
  center: GridPoint
  before: GridPoint
  after: GridPoint
} {
  const center = points[index]
  const previous = points[(index + points.length - 1) % points.length]
  const next = points[(index + 1) % points.length]
  const previousLength = Math.hypot(previous.x - center.x, previous.y - center.y)
  const nextLength = Math.hypot(next.x - center.x, next.y - center.y)
  const distance = Math.min(radius, previousLength * 0.25, nextLength * 0.25)
  const towards = (target: GridPoint, length: number): GridPoint => length > 0
    ? {
        x: center.x + (target.x - center.x) * distance / length,
        y: center.y + (target.y - center.y) * distance / length
      }
    : { ...center }
  return {
    center,
    before: towards(previous, previousLength),
    after: towards(next, nextLength)
  }
}

export function alphaMaskToAcrylicShapes(options: AcrylicContourOptions): THREE.Shape[] {
  const { alpha, width, height, worldWidth, worldHeight } = options
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || alpha.length < width * height || worldWidth <= 0 || worldHeight <= 0) {
    throw new Error('Invalid acrylic contour dimensions')
  }
  const threshold = Math.min(255, Math.max(1, Math.round(
    options.threshold ?? DEFAULT_ACRYLIC_ALPHA_THRESHOLD
  )))
  const filled = Array.from({ length: width * height }, (_, index) => alpha[index] >= threshold)
  const loops = traceBoundaryLoops(filled, width, height)
    // Canvas-space outer boundaries are clockwise/positive. Internal holes are
    // intentionally filled because a cutout stand remains clear acrylic there.
    .filter((loop) => signedArea(loop) >= 1)
    // Keep enough points for broad curves to remain round. The following
    // corner pass removes the one-pixel stair steps without turning a curved
    // head or costume edge into a handful of large flat facets.
    .map((loop) => simplifyClosedPath(loop, options.simplifyTolerance ?? 0.82))
    .filter((loop) => loop.length >= 3)

  const toWorld = (point: GridPoint): THREE.Vector2 => new THREE.Vector2(
    (point.x / width - 0.5) * worldWidth,
    (0.5 - point.y / height) * worldHeight
  )
  const cornerRadius = Math.max(0, Math.min(3, options.cornerRadius ?? 1.8))
  return loops.map((loop) => {
    const centers = loop.map(toWorld)
    const oriented = THREE.ShapeUtils.isClockWise(centers) ? loop : [...loop].reverse()
    const shape = new THREE.Shape()
    if (cornerRadius === 0) {
      const points = oriented.map(toWorld)
      shape.moveTo(points[0].x, points[0].y)
      for (const point of points.slice(1)) shape.lineTo(point.x, point.y)
      shape.closePath()
      return shape
    }
    const corners = oriented.map((_, index) => {
      const corner = roundedCorner(oriented, index, cornerRadius)
      return {
        center: toWorld(corner.center),
        before: toWorld(corner.before),
        after: toWorld(corner.after)
      }
    })
    const lastAfter = corners[corners.length - 1].after
    shape.moveTo(lastAfter.x, lastAfter.y)
    for (const corner of corners) {
      shape.lineTo(corner.before.x, corner.before.y)
      shape.quadraticCurveTo(corner.center.x, corner.center.y, corner.after.x, corner.after.y)
    }
    shape.closePath()
    return shape
  })
}

function sampledShapePoints(shape: THREE.Shape, curveSegments: number): THREE.Vector2[] {
  const points = shape.getPoints(curveSegments)
  const unique: THREE.Vector2[] = []
  for (const point of points) {
    const previous = unique.at(-1)
    if (!previous || previous.distanceToSquared(point) > 1e-12) unique.push(point)
  }
  if (unique.length > 1 && unique[0].distanceToSquared(unique[unique.length - 1]) <= 1e-12) unique.pop()
  return unique
}

function resampleClosedPoints(
  points: readonly THREE.Vector2[],
  spacing: number,
  maximumPoints = 4096
): THREE.Vector2[] {
  if (points.length < 3) return [...points]
  const lengths = points.map((point, index) => point.distanceTo(points[(index + 1) % points.length]))
  const perimeter = lengths.reduce((sum, length) => sum + length, 0)
  if (perimeter <= 1e-9) return [...points]
  const count = Math.max(points.length, Math.min(maximumPoints, Math.ceil(perimeter / Math.max(spacing, 1e-6))))
  const result: THREE.Vector2[] = []
  let segment = 0
  let segmentStart = 0
  for (let index = 0; index < count; index += 1) {
    const distance = perimeter * index / count
    while (segment < lengths.length - 1 && segmentStart + lengths[segment] < distance) {
      segmentStart += lengths[segment]
      segment += 1
    }
    const start = points[segment]
    const end = points[(segment + 1) % points.length]
    const amount = lengths[segment] > 1e-9 ? (distance - segmentStart) / lengths[segment] : 0
    result.push(start.clone().lerp(end, amount))
  }
  return result
}

function polishClosedPoints(points: readonly THREE.Vector2[], passes = 2): THREE.Vector2[] {
  let result = points.map((point) => point.clone())
  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((point, index, source) => {
      const previous2 = source[(index + source.length - 2) % source.length]
      const previous = source[(index + source.length - 1) % source.length]
      const next = source[(index + 1) % source.length]
      const next2 = source[(index + 2) % source.length]
      return new THREE.Vector2(
        (previous2.x + previous.x * 4 + point.x * 6 + next.x * 4 + next2.x) / 16,
        (previous2.y + previous.y * 4 + point.y * 6 + next.y * 4 + next2.y) / 16
      )
    })
  }
  return result
}

function createVectorOffsetPaths(options: AcrylicContourGeometryOptions): THREE.Vector2[][] {
  const shapes = alphaMaskToAcrylicShapes(options)
  if (shapes.length === 0) return []
  const curveSegments = Math.max(2, Math.min(12, Math.round(options.curveSegments ?? 8)))
  const pixelSize = Math.min(options.worldWidth / options.width, options.worldHeight / options.height)
  const sourcePaths: PathD[] = shapes
    .map((shape) => polishClosedPoints(
      resampleClosedPoints(sampledShapePoints(shape, curveSegments), pixelSize * 0.55)
    ))
    .filter((points) => points.length >= 3)
    .map((points) => points.map((point) => ({ x: point.x, y: point.y })))
  if (sourcePaths.length === 0) return []

  const offset = Math.max(0, options.offset ?? 0)
  const inflated = offset > 1e-6
    ? inflatePathsD(
        sourcePaths,
        offset,
        JoinType.Round,
        EndType.Polygon,
        2,
        6,
        Math.max(pixelSize * 0.12, 1e-6)
      )
    : sourcePaths
  if (inflated.length === 0) return []

  // The artwork's transparent internal gaps remain clear acrylic. Clipper
  // marks holes with the opposite winding, so retain only paths matching the
  // largest outer contour while keeping disconnected outer islands.
  const largest = inflated.reduce((current, path) => (
    Math.abs(areaD(path)) > Math.abs(areaD(current)) ? path : current
  ), inflated[0])
  const outerSign = Math.sign(areaD(largest)) || 1
  return inflated
    .filter((path) => path.length >= 3 && Math.sign(areaD(path)) === outerSign)
    .map((path) => path.map((point) => new THREE.Vector2(point.x, point.y)))
}

/**
 * Builds only the continuous outside wall. The clear front/back surfaces are
 * alpha-masked planes in SceneRuntime. Keeping caps out of this geometry
 * avoids triangulation spikes on detailed silhouettes and lets every wall
 * vertex be shared by its two neighbours for genuinely smooth lighting.
 */
export function createAcrylicContourGeometry(options: AcrylicContourGeometryOptions): AcrylicContourGeometryResult | null {
  const contourPaths = createVectorOffsetPaths(options)
  if (contourPaths.length === 0) return null
  const depth = Math.max(0.002, options.depth ?? ACRYLIC_PANEL_DEPTH)
  const pixelSize = Math.min(options.worldWidth / options.width, options.worldHeight / options.height)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  const renderedPaths: THREE.Vector2[][] = []
  for (const contourPath of contourPaths) {
    const points = resampleClosedPoints(contourPath, pixelSize * 0.45)
    if (points.length < 3) continue
    renderedPaths.push(points)
    const clockwise = THREE.ShapeUtils.isClockWise(points)
    const normalWindow = Math.max(2, Math.min(12, Math.round(pixelSize * 2.5 / Math.max(
      points[0].distanceTo(points[1]),
      1e-6
    ))))
    const offset = positions.length / 3
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const previous = points[(index + points.length - normalWindow) % points.length]
      const next = points[(index + normalWindow) % points.length]
      const tangent = next.clone().sub(previous).normalize()
      const normalX = clockwise ? -tangent.y : tangent.y
      const normalY = clockwise ? tangent.x : -tangent.x
      positions.push(point.x, point.y, -depth / 2)
      positions.push(point.x, point.y, depth / 2)
      normals.push(normalX, normalY, 0, normalX, normalY, 0)
    }
    for (let index = 0; index < points.length; index += 1) {
      const next = (index + 1) % points.length
      const back = offset + index * 2
      const front = back + 1
      const nextBack = offset + next * 2
      const nextFront = nextBack + 1
      if (clockwise) {
        indices.push(back, nextFront, nextBack, back, front, nextFront)
      } else {
        indices.push(back, nextBack, nextFront, back, nextFront, front)
      }
    }
  }

  if (indices.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  return { geometry, paths: renderedPaths }
}

export function createAcrylicContourCapGeometry(
  worldWidth: number,
  worldHeight: number,
  depth = ACRYLIC_PANEL_DEPTH
): THREE.BufferGeometry {
  const halfWidth = worldWidth / 2
  const halfHeight = worldHeight / 2
  const halfDepth = depth / 2
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -halfWidth, -halfHeight, halfDepth,
    halfWidth, -halfHeight, halfDepth,
    halfWidth, halfHeight, halfDepth,
    -halfWidth, halfHeight, halfDepth,
    -halfWidth, -halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth,
    halfWidth, halfHeight, -halfDepth,
    -halfWidth, halfHeight, -halfDepth
  ], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1
  ], 2))
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6
  ])
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}
