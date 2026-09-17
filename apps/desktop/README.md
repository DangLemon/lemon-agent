# Lemon AI Desktop ☤

<p align="center">
  <a href="https://github.com/DangLemon/lemon-agent/actions/workflows/lemon-desktop-installers.yml"><img src="https://img.shields.io/badge/Lemon%20Installers-macOS%20%C2%B7%20Windows-FFD700?style=for-the-badge" alt="Lemon AI installers"></a>
  <a href="https://github.com/DangLemon/lemon-agent/releases"><img src="https://img.shields.io/badge/Internal%20Releases-Lemon%20AI-FFD700?style=for-the-badge" alt="Internal Lemon AI releases"></a>
  <a href="https://github.com/DangLemon/lemon-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
</p>

**The native desktop app for Lemon AI**, the company build of [Lemon AI](../../README.md). It keeps the same agent core, skills, memory, and gateway compatibility in a native window — with streaming tool output, previews, a file browser, voice, and settings, no terminal required. Available for **macOS, Windows, and Linux**.

<table>
<tr><td><b>Chat with the full agent</b></td><td>Streaming responses, live tool activity, structured tool summaries, and the same conversation history as compatible Lemon AI surfaces.</td></tr>
<tr><td><b>Side-by-side previews</b></td><td>Render web pages, files, and tool outputs in a right-hand pane while you keep chatting.</td></tr>
<tr><td><b>File browser</b></td><td>Explore and preview the working directory without leaving the app.</td></tr>
<tr><td><b>Voice</b></td><td>Talk to Lemon AI and hear it back.</td></tr>
<tr><td><b>Settings & onboarding</b></td><td>Manage providers, models, tools, and credentials from a real UI. First-run setup gets you to your first message in seconds.</td></tr>
<tr><td><b>Stays current</b></td><td>Built-in updates pull the latest agent and rebuild the app in place.</td></tr>
</table>

---

## Install

### Install Lemon AI (recommended)

Already have the compatible CLI installed? Run:

```bash
lemon desktop
```

It builds and launches the GUI against your existing install — same config, keys, sessions, and skills. If Lemon AI cannot find a usable runtime or saved remote connection, first launch lets you connect to an existing gateway or install the local runtime. Local onboarding then walks you through choosing a provider and model.

### Lemon AI installers

The Lemon AI installer workflow is [`.github/workflows/lemon-desktop-installers.yml`](../../.github/workflows/lemon-desktop-installers.yml). Pull requests that touch Desktop packaging build verified macOS arm64 DMG and Windows x64 NSIS artifacts. A `lemon-v<version>` tag on `main` publishes those verified artifacts to a Lemon AI prerelease.

---

## Updating

The app checks for updates in the background and offers a one-click update when one is ready. You can also update any time from the CLI:

```bash
lemon update
```

---

## Requirements

The installer handles everything for you (Python 3.11+, a portable Git, ripgrep).

---

## Development

Want to hack on the app itself? Install workspace deps from the repo root once, then run the dev server from this directory:

```bash
npm install          # from repo root — links apps/desktop, web, apps/shared
cd apps/desktop
npm run dev          # Vite renderer + Electron, which boots the Python backend
```

Point the app at a specific source checkout, or sandbox it away from your real config:

```bash
# throwaway Lemon runtime home, separate Electron userData, distinct app name to avoid the single-instance lock
../scripts/dev-sandbox.sh npm run dev
LEMON_DESKTOP_LEMON_ROOT=/path/to/clone npm run dev
LEMON_HOME=/tmp/throwaway npm run dev
npm run dev:fake-boot   # exercise the startup overlay with deterministic delays
```

### Building installers

```bash
npm run dist:mac     # DMG + zip
npm run dist:win     # NSIS + MSI
npm run dist:linux   # AppImage + deb + rpm
npm run pack         # unpacked app under release/ (no installer)
```

Local installer builds write artifacts under `apps/desktop/release/`. GitHub builds run through [the Lemon Desktop Installers workflow](../../.github/workflows/lemon-desktop-installers.yml), upload the macOS and Windows installer artifacts for pull requests, and publish a prerelease when a `lemon-v<version>` tag is pushed from `main`. The current CI path uses ad-hoc macOS signing and unsigned Windows artifacts unless release signing credentials are configured (`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_*` for macOS, `WIN_CSC_*` for Windows).

### Internal Desktop Harness

Internal builds use [`lemon-ai-desktop.config.json`](./lemon-ai-desktop.config.json) by default for every desktop `dev`, `pack`, `dist`, and packaged smoke-test command. The validated resource is bundled as `lemon-ai-harness.json`; `LEMON_DESKTOP_HARNESS_CONFIG` can still point to another approved resource for CI or a controlled build.

That manifest pins the first-launch source repository to `DangLemon/lemon-agent`. The Desktop bootstrap runner downloads `scripts/install.sh` or `scripts/install.ps1` from that repository at the build stamp ref, then passes the same repository identity to every installer stage. Ordinary builds and direct installer runs still default to `DangLemon/lemon-agent`.

Keep secrets outside the manifest. The provider key is represented only as `model.api_key: ${LEMON_AI_COMPANY_API_KEY}`, and Amazon Ads OAuth client credentials are represented only as `${AMAZON_ADS_CLIENT_ID}` and `${AMAZON_ADS_CLIENT_SECRET}`. The MCP OAuth runtime uses `oauth.redirect_port`, so the Amazon callback port is stored as `oauth.redirect_port: 8000` with `oauth.redirect_uri: http://localhost:8000/auth/callback`.

Internal package identity is applied at build and early Electron startup. The packaged app is named `Lemon AI`, uses app id `com.lemondigital.lemonai`, writes Electron `userData` under the Lemon AI app name, and produces installer files named `Lemon-AI-${version}-${os}-${arch}.${ext}`. The upstream `Lemon AI` product name in `package.json` remains the ordinary build default and is rewritten only when the internal harness is active.

### How it works

The packaged app ships the Electron shell and a native React chat surface. On
first launch it installs the Lemon AI runtime into the Lemon home
(`~/.lemon-ai`, or `%LOCALAPPDATA%\Lemon AI` on Windows). The backend still
receives the compatibility variable `LEMON_HOME`, whose value is this Lemon
path, so existing CLI modules and commands continue to work.

The app has three boundaries:

- **Electron** resolves and validates a runnable backend, owns native
  filesystem/git/window capabilities, and exposes a narrow preload bridge.
- **React** owns the Desktop routes, panes, interaction state, and
  `@assistant-ui/react` transcript.
- **Lemon AI** runs as a headless `lemon serve` process and exposes the
  `tui_gateway` JSON-RPC/WebSocket API. The renderer connects through
  [`apps/shared`](../shared/), which is also used by the browser dashboard.

Backend resolution is an ordered ladder:

1. `LEMON_DESKTOP_LEMON_ROOT`
2. the current source checkout during development
3. a completed managed install
4. `LEMON_DESKTOP_LEMON`, or the compatible CLI on `PATH`
5. a system Python that can import the Lemon AI runtime
6. the first-launch bootstrap installer

Candidates are probed before use; an existing shim or interpreter is not enough.
A runtime that predates `serve` falls back to headless
`dashboard --no-open`. This is compatibility for the backend command only and
does not launch or embed the dashboard UI.

The Electron orchestration entry point is `electron/main.ts`; pure resolution,
probe, hardening, and platform policies live in focused modules beside it. The
renderer is under `src/`, with shared atoms in `src/store` and transport/native
adapters in `src/lib`.

Before changing the app, read:

- [`AGENTS.md`](./AGENTS.md): architecture, state ownership, resolver/fallback,
  transport, performance, and testing rules.
- [`DESIGN.md`](./DESIGN.md): visual system, information architecture, motion,
  direct manipulation, and keyboard behavior.

### Connections, projects, and switching

Desktop supports a managed local backend, explicit remote gateways, and Lemon AI
Cloud connections. Remote and cloud modes use the same remote-capability path;
authentication and discovery differ, not the renderer feature model.

When no usable local runtime or saved remote connection exists, the first-run
screen offers **Connect to existing gateway** before starting the local installer.
Desktop probes the gateway to discover token or OAuth authentication, requires a
successful HTTP and WebSocket connection test, and saves the connection using
the same encrypted Desktop configuration used by Settings. A saved remote
connection bypasses this choice on later launches. The regular Desktop build
still includes the local-install option; this is a remote operating mode, not a
separate client-only application.

In remote mode the gateway host is the execution boundary: agent tools,
terminal commands, and file operations run against the remote Lemon AI host, not
the computer displaying the Desktop UI.

Remote gateways that sit behind an access proxy may require extra headers on
every HTTP and WebSocket request. Configure them per connection in Settings →
Connections (Extra gateway headers), or add a `headers` object to Desktop's
Electron `userData/connection.json` remote block:

```json
{
  "mode": "remote",
  "remote": {
    "url": "https://lemon.example.com",
    "authMode": "token",
    "token": { "encoding": "safeStorage", "value": "..." },
    "headers": {
      "CF-Access-Client-Id": { "encoding": "safeStorage", "value": "..." },
      "CF-Access-Client-Secret": { "encoding": "safeStorage", "value": "..." }
    }
  }
}
```

Per-profile remote entries under `profiles[name].headers` use the same shape.
Desktop applies these headers only to matching remote gateway requests, treats
`https` and `wss` as the same gateway origin for WebSocket upgrades, and drops
transport- or Lemon AI-managed header names such as `Authorization`, `Cookie`,
`Host`, `Origin`, `Referer`, and `X-Lemon-Session-Token`.

Projects are the workspace abstraction. A project may own multiple folders,
repositories, worktrees, and sessions; a bare new chat remains detached unless
the user enters a project or configures a default project directory. Use the
Projects UI rather than adding a second per-session folder-picker workflow.

Changing profiles or connection modes is a soft workspace switch, not another
cold boot. The shell and current management overlay remain mounted while
gateway-bound nanostores are wiped, query-backed data is invalidated, and the
new connection repopulates skeletons. This prevents rows or transcripts from
the previous gateway bleeding into the next one. Switching changes only the
foreground view and request route: it does not cancel turns or stop a backend,
and retained background sockets continue receiving events from running jobs.

### Verification

Run before opening a PR (lint may surface pre-existing warnings but must exit cleanly):

```bash
npm run fix
npm run typecheck
npm run lint
npm run test:ui
npm run test:desktop:platforms
```

Run `npm run test:desktop:all` for install, boot, update, packaging, or other
release-path changes.

### Troubleshooting

Boot logs land in `LEMON_HOME/logs/lemon-ai-desktop.log` for the internal build (includes backend output and recent Python tracebacks) — check it first if the app reports a boot failure.

**macOS / Linux:**

```bash
# Force a clean first-launch setup
rm "$HOME/.lemon-ai/lemon-agent/.lemon-ai-bootstrap-complete"
# Rebuild a broken Python venv
rm -rf "$HOME/.lemon-ai/lemon-agent/venv"
# Reset a stuck macOS microphone prompt (macOS only)
tccutil reset Microphone com.lemondigital.lemonai
```

**Windows (PowerShell):**

```powershell
# Force a clean first-launch setup
Remove-Item "$env:LOCALAPPDATA\Lemon AI\lemon-agent\.lemon-ai-bootstrap-complete"
# Rebuild a broken Python venv
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Lemon AI\lemon-agent\venv"
```

> The Lemon AI home on Windows is `%LOCALAPPDATA%\Lemon AI`. The backend compatibility variable is still named `LEMON_HOME`; set it only when you intentionally relocate the runtime.

---

## Upstream

- [Lemon AI documentation](https://github.com/DangLemon/lemon-agent/docs/)
- [Lemon AI upstream repository](https://github.com/DangLemon/lemon-agent)

---

## License

MIT — see [LICENSE](../../LICENSE).

Built for Lemon Digital on top of [Lemon AI](https://github.com/DangLemon/lemon-agent).
