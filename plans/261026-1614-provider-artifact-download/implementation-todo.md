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
- [x] Rerun focused verification after latest review fixes. 221 Python tests, Desktop typecheck, 9 UI tests, build, and artifact-card Electron E2E pass. Legacy untracked ZIP E2E failure remains unresolved.
- [ ] Obtain independent review. Earlier isolated reviewers could not inspect the patch; last review found and fixed custom-home route mismatch. Final current-patch review is pending.
- [ ] Commit and create PR after an independent verdict.

Unit 1 baseline: isolated citation tests first exposed missing `provider_artifact_citations`. After fixing test imports, failure showed `assert [] == [{...citation...}]` for completed Responses messages. Existing test files were restored after accidental replacement attempts; final regressions live in new files.

Blockers found while grounding:
- [ ] Verify exact final citation object/status from a redacted Responses fixture. No fixture evidence yet.
- [ ] Confirm official SDK response method for streaming container bytes in the locked OpenAI SDK version.
- [ ] Design authentication for fixed ID endpoint using the existing Desktop session auth and request-selected profile; current browser-control store scope is incompatible.
- [ ] Align citation extraction/incomplete-turn behavior with response normalization, preflight, and replay paths.
- [ ] Recover the provider-artifact design rationale absent from the initial output directory, if any existing intended records can be found.
