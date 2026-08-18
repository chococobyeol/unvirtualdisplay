import * as THREE from 'three'

interface StlGeometry extends THREE.BufferGeometry {
  hasColors?: boolean
  alpha?: number
}

export const DEFAULT_STL_COLOR = 0xb8b0a4

export function createStlMesh(source: THREE.BufferGeometry): THREE.Mesh {
  const geometry = source as StlGeometry
  const positions = geometry.getAttribute('position')
  if (!positions || positions.count < 3) throw new Error('STL contains no triangles.')

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const hasVertexColors = geometry.hasColors === true && geometry.hasAttribute('color')
  const sourceAlpha = typeof geometry.alpha === 'number' && Number.isFinite(geometry.alpha)
    ? THREE.MathUtils.clamp(geometry.alpha, 0, 1)
    : 1
  const material = new THREE.MeshStandardMaterial({
    color: hasVertexColors ? 0xffffff : DEFAULT_STL_COLOR,
    metalness: 0.04,
    opacity: sourceAlpha,
    roughness: 0.58,
    side: THREE.DoubleSide,
    transparent: sourceAlpha < 1,
    vertexColors: hasVertexColors
  })
  return new THREE.Mesh(geometry, material)
}
