---
name: browser-native-orchestration
description: "Choose browser_* vs computer_use; demo web form + native app."
version: 1.0.0
author: Lemon AI
license: MIT
platforms: [macos, windows, linux]
metadata:
  lemon:
    tags: [browser, computer-use, orchestration, desktop]
    category: desktop
    related_skills: [computer-use]
---

# Browser + Native orchestration

Lemon AI keeps **two** automation paths. Do not mix them for the same control.

| Path | Tools | Use when |
|---|---|---|
| **Browser (DOM)** | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, … | Page content inside a tab: links, forms, SPA UI, DOM text |
| **Native (desktop)** | `computer_use` (`capture` / `click` / `type` / `set_value` / …) | OS chrome, native apps (TextEdit, Finder, Mail), browser *chrome* (address bar, permission sheets, extensions), anything not in the page DOM |

## Decision rules (in order)

1. **Can `browser_*` see the control in `browser_snapshot`?** → use `browser_*`.
2. **Is it a native window / OS dialog / app outside the page?** → `computer_use` (capture first).
3. **Browser permission / save / print / “Open with…” sheet?** → `computer_use` on the frontmost browser app after a fresh capture.
4. **File edit with a known path?** → `read_file` / `write_file` / `patch`, not typing into an editor.
5. **Shell?** → `terminal`, not `computer_use` → Terminal.app.

Never drive a web form with `computer_use` coordinates when `browser_type` works — DOM is more reliable. Never use `browser_*` for TextEdit / Finder / Slack desktop chrome.

## Demo flow (web form + native note)

Goal: fill a public web form field via browser tools, then paste a confirmation line into TextEdit via Computer Use.

```text
# A) Browser — page content
browser_navigate(url="https://example.com")
browser_snapshot()                    # confirm heading / links in DOM
# (for a real form URL: browser_type(ref="@eN", text="...") then browser_click)

# B) Native — TextEdit
computer_use(action="capture", mode="ax", app="TextEdit")
computer_use(action="set_value", element=<AXTextArea index>, value="Form done via browser_*")
computer_use(action="capture", mode="ax")   # tree_diff / verify
computer_use(action="history")              # if history_enabled
```

Scripted local demo (no LLM):

```bash
cd hermes-agent
.venv/bin/python scripts/demo_browser_native_orchestration.py
```

## Privilege / ritual reminders

- CU mutate needs fresh capture + privilege mode (`ask` / `trusted_apps` / `capture_only`).
- Browser tools have their own origin / sandbox policy — unrelated to CU privilege picker.
- Opt-in CU history (`computer_use.history_enabled`) does **not** log browser_* calls.

## Related

- Full CU vocabulary: skill `computer-use`
- Browser dogfood patterns: skill `dogfood` (software-development)
