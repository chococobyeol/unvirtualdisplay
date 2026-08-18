import { join } from 'node:path'

const PACKAGED_TRAY_ICON = 'tray-icon.ico'

export function resolveWindowsTrayIconPath(
  isPackaged: boolean,
  appPath: string,
  resourcesPath: string
): string {
  return isPackaged
    ? join(resourcesPath, PACKAGED_TRAY_ICON)
    : join(appPath, 'build', 'icon.ico')
}
