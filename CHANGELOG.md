# Changelog

## Unreleased

- Fixed editor-to-widget updates with immediate project previews and revision-ordered saves.
- Fixed duplicate scene objects caused by overlapping asynchronous model loads during startup.
- Prevented multiple app processes from creating overlapping widget windows.
- Added Clear and Reset actions, including removal of project-local copied assets.
- Fixed embedded GLB textures blocked while Three.js loaded temporary `blob:` image URLs.
- Preserved the latest previewed edit during application shutdown and flushed edits before project backup or switching.
- Added a clearly labeled display-name editor.
- Added transparent, solid-color, and local-image widget background modes with black image-mode fallback.
- Added direct widget dragging in normal viewing mode; double-click adjustment now exposes eight resize handles without a dedicated move bar.
- Added alpha-aware hit testing so transparent widget pixels pass clicks through without making visible display content inert.
- Added alpha-contour, rectangular, and elliptical acrylic plate shapes with slider and numeric margin controls.
- Fixed flat panels rendering as solid black by moving the print surface in front and using a translucent panel backing.
- Anchored acrylic margin growth above the stand base, preserved selection while changing 2D presentation, and replaced overlapping frame bars with one continuous frame mesh.
- Replaced hidden native transform spinners with always-visible step buttons and stable text caret handling.
- Kept transform labels and X/Y/Z inputs on one compact row while reserving fixed space for values and step buttons.
- Replaced font-dependent stepper glyphs with equal-size CSS triangles.
- Added per-item visibility and trash actions, disabled hidden-item physics, and added a wide catch floor below the display.
- Replaced single bounding-box item collisions with cached VHACD compound mesh colliders and suppressed item-launching impulses while dragging.

## 0.1.0 — 2026-08-15

- Added separate transparent display and editor windows.
- Added minimal gallery, glass showcase, and warm shelf presets.
- Added GLB, GLTF, VRM, FBX, OBJ, PNG, JPG, and WebP import paths.
- Added acrylic stand, panel, frame, and photo-card presentation for images.
- Added free transform editing with simplified Rapier gravity, collision, stacking, automatic sleeping, collision bypass, prevent-toppling, and placement lock.
- Added per-model animation enable, looping, and speed settings.
- Added multiple local display projects, autosave, duplication, `.uvd` backup and restore, and PNG capture.
- Added Korean, English, Japanese, and Simplified Chinese UI resources.
- Added local-only diagnostics export and first-run onboarding.
- Added unsigned macOS Apple Silicon/Intel and Windows x64 packaging.
