# Release checklist

## Automated checks

- [x] TypeScript main, preload, and renderer checks
- [x] Project creation, save, duplication, deletion, asset copy, path traversal rejection, and `.uvd` round-trip tests
- [x] Production renderer and Electron bundles
- [x] No npm audit vulnerabilities reported

## Smoke tests completed on 2026-08-15

- [x] Packaged Apple Silicon app launches
- [x] Secure preload bridge starts in a sandboxed renderer
- [x] Editor and transparent display windows open separately
- [x] Local OBJ import renders
- [x] Animated GLB import renders and its animation setting remains enabled
- [x] Gravity drops imported objects onto a shelf and saves the settled transform
- [x] First-run onboarding renders in the packaged app
- [x] Apple Silicon and Intel macOS DMG/ZIP artifacts generated
- [x] Windows x64 NSIS and ZIP artifacts generated

## Required before public itch.io release

- [ ] Install, launch, update, and uninstall on a clean Windows 10 x64 machine
- [ ] Install, launch, suspend/resume, and uninstall on a clean Windows 11 x64 machine
- [ ] Launch the Intel macOS build on an Intel Mac
- [ ] Test multiple monitors, DPI scaling, display disconnect, and sleep/wake on both operating systems
- [ ] Test representative GLB, GLTF with external textures, VRM 0.x, VRM 1.0, FBX, OBJ, transparent PNG, JPG, and WebP files
- [ ] Test a deliberately broken model and an oversized model
- [ ] Confirm keyboard navigation and all four UI languages
- [ ] Publish SHA-256 checksums beside the downloads
- [ ] Add itch.io install-warning instructions and link the privacy notice
- [ ] Confirm the final source-code and application license
