- [x] Read the Principles section of the `pstack:poteto-mode` skill.
- [x] Phase A: frame a falsifiable done predicate, scope, blockers, and rigor.
- [x] Phase B: design the implementation units and verification gates.
- [x] Phase C: run each unit red → green → verify against the real artifact.
- [x] Phase D: maintain the decision trail at `plans/261026-1614-provider-artifact-download/decisions.tsv`.
- [x] Phase E: verify end-to-end behavior and report open items.

Implementation units:
- [x] Capture baseline; add citation extraction and final-turn tests.
- [x] Add provider retrieval and durable opaque-ID object storage.
- [x] Add transcript descriptor persistence and authenticated scoped download route.
- [x] Add Desktop live/history hydration and separate file card.
- [x] Rerun Electron build and artifact-card E2E after the latest response cleanup. Build and artifact download E2E pass; legacy untracked ZIP E2E remains unresolved.
- [x] Obtain independent review of the current response cleanup implementation. Final exact-packet review found an open-after-validation symlink race; the fix now opens with `O_NOFOLLOW`, validates the opened regular file, and bounds checksum reads. The regression suite passes.
- [x] Commit staged response lifecycle fixes and open a PR from `fix/fileblocks` into `main`.

Unit 1 baseline: isolated citation tests first exposed missing `provider_artifact_citations`. After fixing test imports, failure showed `assert [] == [{...citation...}]` for completed Responses messages. Existing test files were restored after accidental replacement attempts; final regressions live in new files.

Blockers found while grounding:
- [ ] Verify exact final citation object/status from a redacted Responses fixture. No fixture evidence yet.
- [ ] Confirm official SDK response method for streaming container bytes in the locked OpenAI SDK version.
- [ ] Design authentication for fixed ID endpoint using the existing Desktop session auth and request-selected profile; current browser-control store scope is incompatible.
- [ ] Align citation extraction/incomplete-turn behavior with response normalization, preflight, and replay paths.
- [ ] Recover the provider-artifact design rationale absent from the initial output directory, if any existing intended records can be found.
