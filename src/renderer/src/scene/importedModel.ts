import * as THREE from 'three'

export function prepareImportedModelForScene(content: THREE.Object3D): void {
  content.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}
