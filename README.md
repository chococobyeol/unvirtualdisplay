# Unvirtual Display

Unvirtual Display is a local-first Electron desktop app for arranging 3D figures and 2D collectibles in a transparent display window.

## Development

Node.js 22.12 or newer is required.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run dist:dir
```

## Current product structure

- A transparent, borderless display window and a separate editor window
- Transparent, solid-color, and local-image widget backgrounds
- Alpha-aware click-through, direct widget dragging, and a double-click resize frame
- Local JSON projects with imported files copied into each project's asset folder
- Multiple saved displays with one active display
- Revision-ordered local save, immediate editor-to-widget previews, project clear/reset, `.uvd` backup/restore, and PNG capture
- Three.js rendering for display-case presets and imported assets
- Rapier gravity, simplified collision, stacking, automatic sleeping, per-item collision bypass, prevent-toppling, and placement lock
- GLB, GLTF, VRM, FBX, OBJ, STL, PNG, JPG, and WebP import
- Acrylic stand, panel, frame, and photo-card presentation for 2D images, including contour/rectangle/ellipse acrylic plates and numeric margins
- Korean, English, Japanese, and Simplified Chinese interface resources
- First-run onboarding, keyboard shortcuts, and user-exported local diagnostics
- Unsigned Windows and macOS package configuration through electron-builder

Project data is stored under Electron's per-user application-data directory. The app does not use accounts, cloud sync, telemetry, or remote error reporting.

The detailed product decisions are in [PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md).

Release documentation is under [`docs/`](./docs/), including unsigned installation instructions, privacy, third-party notices, and the release checklist.
