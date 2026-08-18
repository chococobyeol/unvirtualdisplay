import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { createStlMesh, DEFAULT_STL_COLOR } from './stlModel'

function asciiStl(): ArrayBuffer {
  return new TextEncoder().encode(`solid triangle
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid triangle`).buffer
}

function binaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50)
  const view = new DataView(buffer)
  view.setUint32(80, 1, true)
  view.setFloat32(84 + 8, 1, true)
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]
  vertices.forEach((vertex, index) => {
    const offset = 84 + 12 + index * 12
    vertex.forEach((value, axis) => view.setFloat32(offset + axis * 4, value, true))
  })
  return buffer
}

describe('STL models', () => {
  it.each([
    ['ASCII', asciiStl],
    ['binary', binaryStl]
  ])('creates a renderable mesh from %s STL geometry', (_name, data) => {
    const geometry = new STLLoader().parse(data())
    const mesh = createStlMesh(geometry)
    const material = mesh.material as THREE.MeshStandardMaterial

    expect(mesh.geometry.getAttribute('position').count).toBe(3)
    expect(mesh.geometry.getAttribute('normal').count).toBe(3)
    expect(mesh.geometry.boundingBox?.isEmpty()).toBe(false)
    expect(material.color.getHex()).toBe(DEFAULT_STL_COLOR)
    expect(material.vertexColors).toBe(false)
    expect(material.side).toBe(THREE.DoubleSide)
  })

  it('preserves nonstandard binary STL vertex colors and alpha', () => {
    const geometry = new THREE.BufferGeometry() as THREE.BufferGeometry & { hasColors: boolean; alpha: number }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3))
    geometry.hasColors = true
    geometry.alpha = 0.6

    const material = createStlMesh(geometry).material as THREE.MeshStandardMaterial
    expect(material.vertexColors).toBe(true)
    expect(material.color.getHex()).toBe(0xffffff)
    expect(material.opacity).toBeCloseTo(0.6)
    expect(material.transparent).toBe(true)
  })

  it('rejects an STL without triangles instead of creating an invalid runtime item', () => {
    expect(() => createStlMesh(new THREE.BufferGeometry())).toThrow('STL contains no triangles')
  })
})
