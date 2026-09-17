---
sidebar_position: 9
title: "Import from Other Agents"
description: "One-command import of a Claude Code (~/.claude) or OpenAI Codex CLI (~/.codex) setup into Lemon AI — instructions, allowlists, MCP servers, skills, and memories."
---

# Import from Other Agents

`lemon import-agent` imports your existing **Claude Code** or **OpenAI Codex CLI** setup into Lemon AI with one command. It follows the same preview-first pattern as [`lemon claw migrate`](../guides/migrate-from-openclaw.md): you always see a per-item plan before anything is written, and `--dry-run` never touches disk.

```bash
lemon import-agent                    # auto-detect ~/.claude or ~/.codex
lemon import-agent claude-code        # import from ~/.claude
lemon import-agent codex              # import from ~/.codex
lemon import-agent claude-code --dry-run          # preview only
lemon import-agent codex --source /path/to/.codex # custom location
lemon import-agent claude-code --overwrite --yes  # replace conflicts, skip prompts
```

## What gets imported

### Claude Code (`~/.claude`)

| Claude Code | Lemon AI |
|---|---|
| `CLAUDE.md` (global instructions) | Memory entries in `~/.lemon-ai/memories/MEMORY.md` |
| `settings.json` → `permissions.allow` (`Bash(...)` rules) | `command_allowlist` in `config.yaml` |
| `settings.json` → `permissions.deny` (`Bash(...)` rules) | `approvals.deny` in `config.yaml` |
| `mcpServers` (from `~/.claude.json` and `settings.json`) | `mcp_servers` in `config.yaml` |
| `skills/<name>/` (dirs with `SKILL.md`) | `~/.lemon-ai/skills/claude-code-imports/<name>/` |
| `commands/*.md` (slash commands) | Skipped with a note — convert them into skills |

Claude's `Bash(npm run test:*)` prefix rules become `npm run test*` globs. Non-`Bash` permission rules (`Read(...)`, `WebFetch`, ...) gate Claude-specific tools and are reported as unmapped rather than imported.

### Codex CLI (`~/.codex`)

| Codex CLI | Lemon AI |
|---|---|
| `AGENTS.md` (global instructions) | Memory entries in `~/.lemon-ai/memories/MEMORY.md` |
| `config.toml` → `[mcp_servers.*]` | `mcp_servers` in `config.yaml` |
| `memories/*.md` | Memory entries in `~/.lemon-ai/memories/MEMORY.md` |
| `skills/<name>/` (dirs with `SKILL.md`) | `~/.lemon-ai/skills/codex-imports/<name>/` |

## What is never imported

**API keys and credentials.** Credential files (`~/.claude/.credentials.json`, `~/.codex/auth.json`) are never read, and MCP server environment variables or headers with secret-looking names (`*_TOKEN`, `*_API_KEY`, `Authorization`, ...) are stripped and listed in the report so you can re-add them deliberately. Run `lemon setup` to configure providers, or add secrets to `~/.lemon-ai/.env`.

## Behavior notes

- **Preview first, always.** The command prints the full plan before applying; in non-interactive sessions it stops at the preview unless you pass `--yes`.
- **Merges, not replaces.** Memory entries are deduplicated against your existing `MEMORY.md`; allowlist/denylist patterns merge with what's already in `config.yaml`.
- **Conflicts are skipped by default.** An MCP server or skill that already exists in Lemon AI is reported as a conflict; pass `--overwrite` to replace it.
- **Malformed files don't abort the run.** A broken `settings.json` or `config.toml` becomes a per-item error in the report while everything else still imports.
- Coming from OpenClaw instead? Use [`lemon claw migrate`](../guides/migrate-from-openclaw.md).
