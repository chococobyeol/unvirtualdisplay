import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { prepareImportedModelForScene } from './importedModel'

describe('prepareImportedModelForScene', () => {
  it('enables shadows without overwriting loader-defined material sides', () => {
    const surface = new THREE.MeshBasicMaterial({ side: THREE.FrontSide })
    const outline = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
    const doubleSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    const multiMaterialMesh = new THREE.Mesh(new THREE.BoxGeometry(), [surface, outline, doubleSided])
    const singleMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
    const singleMaterialMesh = new THREE.Mesh(new THREE.BoxGeometry(), singleMaterial)
    const content = new THREE.Group()
    content.add(multiMaterialMesh, singleMaterialMesh)

    prepareImportedModelForScene(content)

    expect(multiMaterialMesh.castShadow).toBe(true)
    expect(multiMaterialMesh.receiveShadow).toBe(true)
    expect(singleMaterialMesh.castShadow).toBe(true)
    expect(singleMaterialMesh.receiveShadow).toBe(true)
    expect(surface.side).toBe(THREE.FrontSide)
    expect(outline.side).toBe(THREE.BackSide)
    expect(doubleSided.side).toBe(THREE.DoubleSide)
    expect(singleMaterial.side).toBe(THREE.BackSide)
  })
})
