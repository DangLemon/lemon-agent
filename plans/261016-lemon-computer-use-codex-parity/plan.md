# Plan: Lemon Hermes Computer Use — Codex-parity (without Codex runtime)

**Date:** 2026-10-16  
**Mode:** `/ak-xia --port` after `--compare`  
**Target:** `lemon-hermes` / `hermes-internal-desktop`  
**Source inspiration:** Codex Sky Computer Use (architecture only)  
**Local reality:** Hermes already ships `tools/computer_use` + `cua-driver` (macOS AX + SOM + approval)

## Privilege — giải thích (câu bạn “chưa hiểu”)

Computer Use = agent có thể **nhìn màn hình + click/gõ** vào app bất kỳ (Mail, Banking, Messages…).  
Đó là quyền ngang người ngồi máy.

**Approval** = bước người dùng xác nhận trước hành động có side-effect:

| Loại | Ví dụ | Cần approve? |
| --- | --- | --- |
| Đọc | `capture` / `list_apps` | Thường không (Hermes: free) |
| Ghi UI | `click`, `type`, `key`, `drag` | **Có** — prompt “Allow?” |
| Nguy hiểm | logout, gửi tin nhắn, xóa | Hard-block hoặc always ask |

Hermes đã có sẵn:

- `tools/computer_use/tool.py` → `_request_approval` / `set_approval_callback`
- `tools/approval*.py` (CLI/gateway)
- macOS TCC: Accessibility + Screen Recording (`permissions.py`, `doctor.py`)

Bạn không cần “ai approve” trừu tượng — **chính bạn (hoặc policy session)** approve từng action destructive, trừ khi bật bypass (`--yolo` — nguy hiểm).

## Fastest + tốt (chốt IP)

| Option | Tốc độ | Chất lượng | Quyết định |
| --- | --- | --- | --- |
| Gắn Sky/Codex binary | Trông nhanh, thực tế fail (auth gate) + rủi ro IP | Không ship được | **Loại** |
| Greenfield rebuild Sky | Rất chậm | Cao nếu làm đủ năm | **Loại** |
| **Enhance Hermes `computer_use` + cua-driver** theo pattern Codex | Nhanh nhất có thể ship | Đã có ~70–80% “dùng được” | **Chọn** |

Codex “full” (Skyshot ritual + tree diff + Skysight history) map sang Hermes như **parity phases**, không day-1 rewrite.

## Gap: Codex Sky vs Hermes hôm nay

| Capability | Codex | Hermes + cua-driver | Gap |
| --- | --- | --- | --- |
| Native Mac AX + screenshot | Skyshot | `capture(som\|ax\|vision)` | Nhỏ |
| Click by element index | `element_index` | `click(element=N)` + SOM | Nhỏ |
| Type / key / scroll / drag / set_value | Có | Có | Nhỏ |
| list apps/windows | Có | `list_apps` / `list_windows` | Nhỏ |
| Browser automation | Plugin riêng | `browser_*` toolset | Song song — giữ cả 2 |
| **Bắt buộc capture mỗi turn trước action** | Hard ritual | Soft (model tự quyết) | Medium — skill/prompt + guard |
| **Incremental AX diff** | Resident tree + diff text | Full tree mỗi capture | Medium–Large |
| **App allowlist / per-app policy** | IPC app policy + elicitation | Approval scopes + sticky target | Medium |
| **Desktop privilege picker UI** | Codex-style levels + app trust | Settings chỉ TCC grant + `approvals.mode` global | Medium — **Phase 1b** |
| **Background focus (không steal cursor)** | SyntheticAppFocus | cua-driver background-FIRST | Nhỏ (đã có) |
| **Skysight history / memory** | Full pipeline | Không | Large — phase sau |
| Lock-screen guardian | Có | Không | P3 |

## Architecture (giữ nguyên xương sống)

```text
Model
  → Hermes computer_use tool (schema.py / tool.py)
      → approval gate
      → CuaBackend (MCP stdio)
          → cua-driver (native)
              → AX + ScreenCaptureKit + input
Browser path riêng: browser_* tools (không trộn vào CU native)
```

Không thêm dependency OpenAI Sky.

## Phases

### Phase 0 — Baseline usable (0.5–1 ngày)

- Chạy `hermes computer-use doctor` / install cua-driver trên máy Lemon.
- UAT: TextEdit + Safari — `capture(som)` → `click(element)` → `type`.
- Bật toolset `computer_use` + `browser` trong desktop build.
- Success: doctor green; 1 demo scriptable pass.

### Phase 1 — “Dùng được như Codex” ritual (2–4 ngày)

- Guard: action mutate yêu cầu `capture` gần đây (TTL / element_token stale) — mirror Codex “must get_app_state first”.
- Skill/system prompt: luôn capture trước khi click; sau action capture lại.
- App targeting UX: resolve localized macOS names (đã có partial trong `cua_backend_capture.py`) + clearer errors.
- Approval UX: mặc định ask cho click/type; remember-per-app optional.
- Success: agent không click mù; stale element fails loud.

### Phase 1b — Desktop privilege picker (Codex-like) (2–3 ngày)

**Mục tiêu:** Trên màn desktop (Settings / toolset `computer_use`), user chọn **mức privilege** rõ ràng như Codex — không chỉ grant TCC.

**Đã có (giữ nguyên, mở rộng):**

| Surface | Path | Hôm nay |
| --- | --- | --- |
| Panel TCC | `apps/desktop/src/app/settings/computer-use-panel.tsx` | Accessibility + Screen Recording + Grant |
| Mount | `apps/desktop/src/app/skills/index.tsx` (khi toolset = `computer_use`) | Embed panel |
| Status/grant API | `GET /api/tools/computer-use/status`, `POST …/permissions/grant` | OS readiness |
| Global approvals | Settings `approvals.mode` = `manual` \| `smart` \| `off` | Shell + CU cùng gate |

**UI mới trên `ComputerUsePanel` (3 tầng privilege):**

1. **Capture only** — `capture` / `list_apps` / `list_windows` OK; mọi mutate (click/type/key/drag/set_value) **blocked** hoặc always-deny.
2. **Ask before act** (default) — mutate → overlay Allow/Deny (giống Codex elicitation); capture free.
3. **Trusted apps** — danh sách bundle-id / app name được always-allow mutate; app ngoài list vẫn hỏi (hoặc block nếu policy = allowlist-only).

**Controls cụ thể (desktop):**

- Segmented / radio: `Capture only` | `Ask before act` | `Trusted apps`.
- Khi chọn Trusted apps: multi-select / chip list app (từ `list_apps` + pin thủ công); nút Remove; persist.
- Toggle phụ: “Remember Allow for this app” trên approval overlay (ghi vào trusted list) — chỉ hiện khi mode ≠ Capture only.
- Link / trạng thái TCC (panel hiện tại) vẫn ở trên cùng — tách rõ **OS privilege** vs **session/app privilege**.
- Không đổi default sang YOLO; `approvals.mode: off` vẫn nguy hiểm và phải cảnh báo rõ nếu user bật.

**Backend / config (Hermes agent):**

- Config keys mới (gợi ý, giữ namespace CU riêng khỏi shell YOLO):
  - `computer_use.privilege_mode`: `capture_only` | `ask` | `trusted_apps`
  - `computer_use.trusted_apps`: `string[]` (bundle id hoặc normalized app name)
- Enforce trong `tools/computer_use/tool.py` **trước** `_request_approval`:
  - `capture_only` → reject mutate sớm với message hướng user mở Settings.
  - `ask` → behavior hiện tại.
  - `trusted_apps` → skip approval nếu target app ∈ list; else ask (hoặc deny nếu flag allowlist-only — default = ask).
- API desktop (tối thiểu):
  - `GET/PUT /api/tools/computer-use/privilege` (hoặc config.get/set qua gateway đã có) đọc/ghi 2 keys trên.
  - Reuse `list_apps` cho picker; không cần Sky IPC.

**Acceptance criteria:**

- [x] Settings → Computer Use hiện 3 mức privilege; default = `ask`.
- [x] `capture_only`: UAT click/type bị chặn; capture vẫn chạy. *(unit: `test_capture_only_blocks_click_allows_capture`)*
- [x] `ask`: click hiện Allow/Deny; Deny không thực thi. *(unit: `test_ask_mode_denies_when_callback_denies`; desktop overlay CU = CLI/TUI callback path)*
- [x] `trusted_apps`: app trong list không hỏi lại; app ngoài list vẫn hỏi. *(unit)*
- [x] Restart app giữ được mode + trusted list. *(persist via `config.yaml` + PUT privilege)*
- [x] TCC grant UI vẫn hoạt động độc lập (thiếu Accessibility → ready=false như cũ).
- [x] Không embed Sky/Codex binary.
- [x] Ritual: blind mutate without fresh capture fails loudly. *(unit: stale_capture)*
- [x] Unit tests privilege_mode + stale-capture.

**Out of scope Phase 1b:**

- Full Codex IPC app-policy protocol.
- Background continuous observation / Skysight.
- Privilege picker trên pure CLI (có thể `lemon config set` — optional follow-up).

**Success:** User nhìn Settings hiểu ngay “agent được phép làm gì”, giống ritual chọn quyền Codex, trên stack Hermes sẵn có.

### Phase 2 — Tree diff / cheaper turns (1–2 tuần) — **SHIPPED 2026-10-16 (MVP)**

- Cache last AX snapshot per (session, app, window) in `tools/computer_use/ax_diff.py` + tool layer.
- `capture(mode=ax)` lần 2+ → `tree_diff` + diff-first summary; `full_tree=true` mở lại dump đầy đủ.
- Match theo index+role (không full `element_token` — token đổi mỗi snapshot_id).
- SOM/vision vẫn full summary; `elements[]` luôn đủ index/token để act.
- Success (UAT): TextEdit re-capture `changed:1 unchanged:45` sau `set_value`.

### Phase 3 — History lite (không full Skysight) — **SHIPPED 2026-10-16 (MVP)**

- Opt-in: `computer_use.history_enabled` (default **false**), ring buffer + optional jsonl (`history_persist`).
- Module `tools/computer_use/history.py`; tool `action=history`; API `GET/PUT /api/tools/computer-use/history`.
- Summarize on demand (“what did I just do”); text/value redact dài; clear khi release session.
- Success (UAT): default OFF; enabled → capture/set_value hiện trong timeline; TextEdit marker OK.

### Phase 4 — Browser + Native orchestration — **SHIPPED 2026-10-16**

- Skill `browser-native-orchestration` + decision table trong `computer-use` SKILL.
- Demo script `scripts/demo_browser_native_orchestration.py` (example.com via `browser_*` + TextEdit via CU).
- Success (UAT): **PASS** — browser navigate/snapshot OK; TextEdit marker + history_count=2.

### Out of scope (explicit)

- Embed/call `SkyComputerUseService` / `@oai/sky` / Codex IPC.
- Full Skysight continuous observation / App Group OpenAI.
- Port sang goclaw-lemon trong plan này (có thể MCP-expose sau).

## Risk & rollback

| Risk | Mitigation |
| --- | --- |
| Expect “full Skysight day 1” | Ship Phase 1 as usable; Phase 2–3 incremental |
| cua-driver version drift | Pin contract ≥ 0.20; doctor in CI/smoke |
| Approval fatigue | Per-app always-allow + Trusted apps list; never default yolo / privilege=`ask` |
| Privilege UI confusing vs TCC | Copy tách 2 khối: “macOS permissions” vs “What Lemon may do” |
| Trusted list quá rộng | Default empty; only add via explicit Allow+Remember hoặc Settings picker |
| Privacy | History opt-in only |

Rollback: feature-flag toolset `computer_use` off; browser vẫn chạy. Privilege mode có thể force `ask` qua config nếu UI lỗi.

## Implementation handoff (xia)

```text
Plan ready at
/Users/dang/Documents/ChatGPT/lemon-hermes/plans/261016-lemon-computer-use-codex-parity/plan.md
To implement, run /ck:cook (or /ak:cook) on that plan path.
```

### Manifests (xia deliverable)

- **Source:** Codex Sky architecture notes (`reverse-codex/COMPUTER-USE.md`) — inspiration only  
- **Anatomy:** capture/action/approval/resident-diff/history  
- **Dependency matrix:** EXISTS Hermes CU + cua-driver + `ComputerUsePanel`; NEW privilege_mode + trusted_apps + ritual guards + diff cache; CONFLICT Sky binary  
- **Decision matrix:** rebuild-via-enhance Hermes; dual browser+native; approval = user/session; **privilege UI = extend Settings panel (user approved 2026-10-16)**  
- **Risk score:** Medium (parity scope) / Critical if anyone reopens Sky embed  

## Implementation status (2026-10-16 cook)

**Shipped in `hermes-agent`:** Phase 1 ritual guard + Phase 1b privilege picker + API.

| Area | Files |
| --- | --- |
| Policy | `tools/computer_use/privilege.py` |
| Enforce | `tools/computer_use/tool.py` (privilege → fresh capture → approval) |
| Defaults | `lemon_cli/config_defaults.py` (`privilege_mode`, `trusted_apps`, `capture_ttl_seconds`, `require_fresh_capture`) |
| API | `GET/PUT /api/tools/computer-use/privilege` in `lemon_cli/web_routers/tools.py` |
| Desktop | `apps/desktop/.../computer-use-panel.tsx` + `api/toolsets.ts` + types |
| Tests | `tests/tools/test_computer_use_privilege.py` |

**Phase 0 UAT (2026-10-16):** report `plans/261016-lemon-computer-use-codex-parity/uat-261016.md`
1. `lemon computer-use doctor` — **PASS** (TCC OK)
2. Privilege matrix scripted — **10/10 PASS**
3. TextEdit content land — **FAIL** (driver/AX; không phải privilege)
4. Settings UI 3 radio — **PASS** (Playwright CDP; xem `uat-261016.md` + `uat-privilege-ui.png`)

**Plan status: COMPLETE (Phase 0–4 MVP)** trên `DangLemon/lemon-agent` (`hermes-agent`).

| Follow-up | Status |
| --- | --- |
| Sync `hermes-internal-desktop` | **Done** — copied CU parity + History UI files from lemon-agent |
| Desktop History toggle UI | **Done** — `4afd52179d` pushed |
| Full LLM `lemon chat` UAT | **PASS** 2026-10-16 — `gpt-5.6-luna`/`dfsadfasdf`; marker in TextEdit; session `20261016_205155_7b8e49` (cần token synthesis trên runtime `~/.lemon-ai/lemon-agent`) |

## Next decision (one)

Không còn phase mở. Next: restart Lemon AI.app (hoặc update install từ `main`) để GUI dùng cùng CU token path đã UAT PASS trên CLI.
