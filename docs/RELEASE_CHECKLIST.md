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
- [x] Apple Silicon macOS DMG artifact generated
- [x] Windows x64 Setup artifact generated
- [x] Linux x64 AppImage artifact generated

## Required before public itch.io release

- [ ] Install, launch, update, and uninstall on a clean Windows 10 x64 machine
- [ ] Install, launch, suspend/resume, and uninstall on a clean Windows 11 x64 machine
- [ ] Install, launch, suspend/resume, and remove the app on an Apple Silicon Mac
- [ ] Launch the AppImage and verify project save/restore on a clean Linux x64 machine
- [ ] Test multiple monitors, DPI scaling, display disconnect, and sleep/wake on supported operating systems
- [ ] Test representative GLB, GLTF with external textures, VRM 0.x, VRM 1.0, FBX, OBJ, STL, transparent PNG, JPG, and WebP files
- [ ] Test a deliberately broken model and an oversized model
- [ ] Confirm keyboard navigation and all four UI languages
- [x] Publish SHA-256 checksums with the itch.io download instructions
- [x] Add itch.io install-warning instructions
- [x] Add three representative screenshots to the itch.io page
- [ ] Link the privacy notice
- [ ] Confirm the final source-code and application license
