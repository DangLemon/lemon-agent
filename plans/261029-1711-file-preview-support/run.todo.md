# Figure-it-out run

- [x] Read the Principles section of the **poteto-mode** skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
  - [x] Unit 1: format model, bounded byte loader and parser fixtures. Parser tests pass.
  - [x] Unit 2: bounded XLSX and CSV/TSV previews. Focused renderer tests pass.
  - [x] Unit 3: bounded ZIP listing and DOCX/PPTX text previews. Focused renderer tests pass.
  - [x] Unit 4: audio/video right-rail preview. Focused tests and renderer/Electron typechecks pass.
  - [x] Unit 5: local/remote card actions. Focused UI tests and renderer typecheck pass.
  - [x] Unit 6: remote raster stream allowlist. Focused Python tests pass; failing-before evidence unavailable because pytest was installed after the fix.
  - [x] Unit 7: integration, app verification and hardening. Electron booted, ZIP preview rendered, and the built worker chunk loaded without runtime errors.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back. Final gates passed on the current source.

throughput checkpoint: parser scaffold and fixtures first; renderers only after bounded parsing tests pass.
