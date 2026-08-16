import type { CameraSettings } from './types'

const CAMERA_EPSILON = 0.0001

export function cameraSettingsEqual(left: CameraSettings, right: CameraSettings): boolean {
  return Math.abs(left.position.x - right.position.x) < CAMERA_EPSILON
    && Math.abs(left.position.y - right.position.y) < CAMERA_EPSILON
    && Math.abs(left.position.z - right.position.z) < CAMERA_EPSILON
    && Math.abs(left.target.x - right.target.x) < CAMERA_EPSILON
    && Math.abs(left.target.y - right.target.y) < CAMERA_EPSILON
    && Math.abs(left.target.z - right.target.z) < CAMERA_EPSILON
    && Math.abs(left.fov - right.fov) < CAMERA_EPSILON
}
