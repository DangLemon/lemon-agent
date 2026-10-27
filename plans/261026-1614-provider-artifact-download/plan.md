# Provider artifact downloads

## Status

Implementation approved. Desktop artifact card uses an opaque ID and profile-scoped durable object store. 30-day retention approved. Existing untracked Desktop ZIP E2E remains untouched.

## Problem and evidence

Desktop blocks unsupported Markdown URL schemes. In `apps/desktop/src/components/assistant-ui/markdown-text.tsx:294-324`, only HTTP(S) links, known media paths, and local filesystem paths get supported renderers. A provider's `sandbox:/...` reference is not a Hermes path. Rewriting its suffix as a local path could open an unrelated file.

The current `MEDIA:` path is text-based. Gateway delivery extracts paths from response text in `gateway/platforms/base.py:3831-3877`; Desktop rewrites `MEDIA:` into `#media:` links in `apps/desktop/src/lib/chat-messages/parts.ts:24-36`. `PreviewAttachment` then downloads through the gateway path bridge in `apps/desktop/src/components/chat/preview-attachment.tsx:99-110` and `apps/desktop/src/lib/media.ts:220-235`. This is the right display/download layer for gateway-owned files, not the provider retrieval contract.

Responses annotations currently disappear during normalization. `agent/codex_responses_adapter.py:936-951` extracts text, then rebuilds `codex_message_items` with only `output_text`; the scanner also does not handle `code_interpreter_call` items (`:909-935`). The existing `apps/desktop/e2e/zip-download.spec.ts` covers only a ZIP generated in the project workspace and returned through `MEDIA:`. It does not establish provider sandbox access.

## Selected architecture

Keep the final assistant Markdown unchanged. Parse only structured `container_file_citation` annotations from a successful, final OpenAI Responses result. Preserve validated citation descriptors as per-turn metadata, separate from normalized transcript text. Do not infer IDs or local paths from `sandbox:/` strings, rewrite Markdown links, or send synthetic `MEDIA:` through model text.

The direct OpenAI API-key artifact adapter validates the descriptor and runtime before fetching the exact container and file through the active official OpenAI client. It enforces a request timeout and a 100 MiB streamed-byte cap, sanitizes the display filename, and writes bytes under `$LEMON_HOME/cache/provider-artifacts/<opaque-id>` through a temporary file and atomic rename. The generated ID is the storage key; the provider filename is never a path component. Keep files for 30 days, then delete them and render the card as unavailable. The user approved this retention policy. Failure removes partial files and leaves the assistant text intact.

The turn result carries staged artifacts separately. Persist a descriptor on the final assistant transcript row and include it in the terminal `message.complete` payload. Desktop adds a typed artifact field and a separate download card. Keep the artifact ID out of model text; never derive it from a provider URI. Do not add a generic gateway callback or reuse the text-based `MEDIA:` extractor. Preserve current `MEDIA:` behavior for model-authored workspace files.

Store immutable bytes by opaque ID in a profile-scoped directory, separate from the 24-hour document cache (`gateway/run.py:4390-4410`). Keep objects for 30 days, then delete them and show expired cards as unavailable. The renderer receives only `{id, filename, content_type, size_bytes, sha256, expires_at}`. A dedicated authenticated endpoint resolves the ID in the active profile, checks that the requested session's display lineage contains it, then streams it as an attachment with `nosniff`. Bind authorization to durable profile/session access, not an ephemeral socket connection ID. Branches may share immutable IDs when their copied transcript contains the descriptor. Orphaned objects expire through garbage collection; rewrites must not delete a shared object immediately. The existing `/api/fs/download` accepts arbitrary absolute paths on unlocked installs (`lemon_cli/web_routers/files.py:701-711`, `web_server_files.py:131-165`); do not use it for provider artifacts.

```text
ProviderFileCitation { container_id, file_id, filename }
ProviderArtifactRef { id, filename, content_type, size_bytes, sha256, expires_at }
TurnResult { final_response, provider_artifacts: list[ProviderArtifactRef], ... }

extract_citations(responses_result) -> list[ProviderFileCitation]
materialize_citations(active_provider_client, citations) -> list[ProviderArtifactRef]
attach_artifacts(final_assistant_row, refs) -> None
authorize_artifact_download(profile, session_lineage, id) -> bytes
render_assistant_file_cards(refs) -> Desktop components
```

The adapter is enabled only when runtime resolution proves `provider=openai-api`, `api_mode=codex_responses`, endpoint exactly `https://api.openai.com/v1`, and active `OPENAI_API_KEY` authentication. Do not enable it for Codex OAuth (`https://chatgpt.com/backend-api/codex`), custom endpoints, or compatible proxies. Do not pass the OpenAI API key to another endpoint.

## Alternatives and trade-offs

1. **Rewrite `sandbox:` as a local path or `MEDIA:`.** Rejected. The provider reference does not identify a Hermes filesystem path. A rewrite risks reading or delivering an unrelated local file.
2. **Append synthetic `MEDIA:` to the final answer.** Rejected. It mutates model-authored text and couples provider retrieval to a text-parsing delivery contract. Persisted artifact metadata keeps transcript text unchanged and gives Desktop a typed card target.
3. **Use the existing browser-control `ArtifactStore`.** Rejected. It is one-shot, 10 MiB capped, 5-minute TTL, and scoped to browser-control principals, not Desktop sessions. It cannot serve a repeatable file card as-is.
4. **Add a separate registry table.** Deferred. Artifact IDs already live on durable assistant message rows; a second index creates another owner and consistency path. Add a registry only if independent artifact listing, quotas, or retention queries become necessary.
5. **Keep bytes only for the live terminal event.** Rejected. Reconnect/reload would lose the card. Persist the opaque descriptor on the assistant row, then project it in `message.complete`.
6. **Persist provider references and fetch on click.** Deferred. This requires provider credential ownership, expiry, and retry behavior. Eager retrieval avoids provider-container expiry but adds latency to finalization.

## Implementation sequence after approval

1. Add a redacted final Responses fixture with `container_file_citation`. Verify descriptor fields and confirm that text remains unchanged. Do not rely on citation offsets for link rewriting.
2. Add failing normalization tests for valid and malformed citation IDs, duplicates, unsupported annotations, incomplete results, and preserved assistant text.
3. Add failing adapter tests with an injected OpenAI SDK client. Verify official host and API-key route, exact container and file IDs, timeout, streamed-byte ceiling, safe filename, and atomic cleanup.
4. Add a per-turn result and store verified bytes in a profile-scoped object directory. Store only an opaque descriptor in the final assistant row's `display_metadata`; include it in `message.complete`.
5. Add a Desktop download endpoint that accepts only the opaque ID. Validate format, expiry, profile, and membership in the requesting session's display lineage. Never accept paths or provider URLs. Keep objects immutable and multi-read; garbage-collect expired objects after the retention window. Leave early orphan cleanup out until it can account for branch copies and archived rows safely.
6. Extend Desktop live completion and history hydration to map artifact metadata into a typed assistant-message field. Keep artifact-only assistant rows visible. Render a separate card beside the text; use Electron's authenticated profile route to fetch by ID, then save or preview through the native dialog.
7. Add tests for artifact persistence, compaction/reload, branch sharing, session/profile denial, expiry, live completion, artifact-only rows, checksum/size handling, and download. Keep `apps/desktop/e2e/zip-download.spec.ts` unchanged. Run focused Python tests, gateway tests, Desktop typecheck and tests, then ZIP E2E.

## Acceptance criteria

- A documented direct OpenAI API-key Responses citation yields a separate Desktop file card after successful finalization.
- The same card appears from live completion and reloaded transcript history, including compaction and a branch copied from the transcript. Its authenticated download retrieves the staged file until expiry; expired cards show unavailable state.
- The final assistant text stays byte-for-byte unchanged; no synthetic `MEDIA:` is added.
- Provider retrieval never interprets `sandbox:/` as a local path and never follows a citation-supplied URL.
- OAuth Codex, custom endpoints, compatible proxies, and unsupported providers issue no file request and receive no OpenAI API key.
- Artifact IDs are random, validated, immutable, profile-scoped. Download authorization checks that the requested session's displayed transcript contains the ID; the renderer cannot choose a path, provider URL, or owner scope. Branch copies may reuse an ID only when the copied row contains its descriptor. Expired IDs stop serving bytes.
- Invalid IDs, failed statuses, oversized content, and interrupted downloads leave no partial stored artifacts. They do not erase the assistant text.
- The existing workspace `MEDIA:` behavior remains unchanged and its ZIP E2E still passes.

## Risks and unresolved details

- SDK 2.24.0 exposes container-file listing and binary content retrieval, but the approved final-response path needs a real redacted fixture to verify which citation fields and statuses arrive.
- The user approved a separate Desktop file card. Existing `/api/fs/download` accepts arbitrary absolute paths on an unlocked local install. The card uses opaque IDs and a dedicated download endpoint instead.
- Assistant-row metadata survives current message cloning. The compaction allowlist at `agent/context_compressor.py:4724-4805` is specific to user summary carriers, not assistant rows. In-place compaction keeps archived display rows, but continuation display depends on lineage reads; verify a compressed row and a branch copy.
- Branches can share an opaque object ID when their transcript includes the assistant descriptor. Session access must check the descriptor in the requested session's display lineage, not an unstable row ID or original socket connection.
- The object directory needs an explicit byte cap, MIME policy, retention, and profile ownership. Start with expiry-based cleanup; reference-counting or registry-based orphan collection adds complexity because branches can share IDs. Do not reuse browser-control `ArtifactStore` unchanged because its one-shot semantics, memory-only index, and 10 MiB cap do not match repeatable Desktop downloads.
- Artifact-only assistant rows currently disappear from Desktop hydration when they have no text or reasoning. Update the empty-row filters in live completion, hydration, and branch selection; otherwise the card vanishes despite a valid descriptor.
- Eager retrieval adds latency. Provider containers may expire before later retrieval, so click-time fetching is not selected.
- Do not generalize the adapter or enable OAuth/custom endpoints until their retrieval and authentication contracts are verified.

## Throughput checkpoint

Smallest safe vertical slice: retain one validated final Responses citation outside assistant text, fetch it through the verified direct OpenAI client, write to a profile-scoped durable object keyed by a random ID, persist the descriptor on the assistant row, then render and download the Desktop card through the authenticated ID route.

## Synthesis

Candidate A uses assistant-row `display_metadata` as descriptor owner plus profile-scoped object storage. Candidate B adds a registry table; Candidate C keeps only a transient event. Independent reviews favored A when IDs are opaque and bytes durable. B adds lifecycle ownership without solving row-ID remapping. C cannot restore cards after reload. Grafts from B/C: strict profile/session authorization, immutable shared IDs, explicit expiry, artifact-only row rendering. Source confirms the compactor allowlist is user-summary-specific and copied assistant rows keep metadata. Verify compressed-history and branch hydration in tests.

## Implementation result

Implemented in `fix/fileblocks`. Provider citations stay in turn metadata; bytes use durable profile-scoped storage; assistant rows retain opaque descriptors for reload and branch display. Desktop renders a separate card and downloads through the authenticated ID route. Final assistant text and the existing `MEDIA:` path remain unchanged. Retrieval is gated to direct OpenAI API-key Responses runtime.

Focused checks pass: 220 Python tests, Desktop typecheck, 9 UI tests, Desktop build, Electron artifact-card download E2E, Python compile, and `git diff --check`. The user-owned untracked ZIP E2E fails on this branch; it passed before feature work, but no clean-base rerun was possible because the spec is untracked. ESLint is unavailable because the workspace lacks `eslint` and `@eslint/js`. A simulated Windows test checks lock-file growth; actual Windows execution remains unverified on this macOS host. Independent review found a custom-`LEMON_HOME` route mismatch; the route now resolves the same store as materialization, with a regression test.

No commit or push yet. Reverify current patch and obtain a final independent review before commit/PR.