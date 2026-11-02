# Strict full gate

- [x] Read the Principles section of the **poteto-mode** skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
  - [x] Unit 1: Reproduce and classify the bot-mode full-E2E failure.
  - [x] Unit 2: Add missing parser-limit behavior tests and make them green.
  - [x] Unit 3: Add deterministic real fixtures for every requested format.
  - [x] Unit 4: Keep an Electron runtime regression that opens every fixture and checks its renderer.
  - [x] Unit 5: Run focused runtime checks, then the complete E2E suite. Current source passed 61 tests with 23 intentional skips and no unexpected or flaky results.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back. Final gates passed after review fixes.
- [x] Swarm: Frame.
- [x] Swarm: Fan out.
- [x] Swarm: Aggregate.
- [x] Swarm: Report.

Definition of done: parser-limit tests cover every remaining admission boundary; a committed Electron E2E opens XLSX, CSV, TSV, ZIP, DOCX, PPTX, audio, video, and a remote raster image through their real renderer paths; the built worker loads; the full Playwright E2E suite exits 0; focused lint, typecheck, UI, Electron, Python, and production build gates exit 0.

Rigor: high. The feature parses untrusted archives and crosses renderer, worker, Electron IPC, and Python gateway boundaries.

Throughput checkpoint: resolve the existing E2E failure and parser coverage before expanding the runtime test. Do not call the gate green until the complete suite exits 0.
