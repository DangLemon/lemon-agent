# Lemon AI CLI Reference

Live sources when anything looks stale: `lemon --help`, `lemon <command> --help`,
https://danglemon.github.io/lemon-agent/docs/reference/cli-commands

### Global Flags

```
lemon [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
lemon chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
lemon setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
lemon model                Interactive model/provider picker
lemon fallback [add|remove|list]  Fallback provider chain
lemon config [show|edit|get|set|unset|path|env-path|check|migrate]
lemon login / logout       OAuth sign-in / clear stored auth
lemon doctor [--fix]       Check dependencies and config
lemon status [--all]       Component status
```

### Tools & Skills

```
lemon tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

lemon skills list|browse|search QUERY|inspect ID
lemon skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
lemon skills config        Enable/disable skills per platform
lemon skills check|update|uninstall|publish PATH
lemon skills tap add REPO  Add a GitHub repo as a skill source
lemon bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
lemon mcp add NAME (--url or --command) | remove | list | test NAME
lemon mcp catalog | install NAME     Curated catalog install
lemon mcp configure NAME             Toggle tool selection
lemon mcp serve                      Run Lemon AI as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
lemon gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `lemon photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://danglemon.github.io/lemon-agent/docs/user-guide/messaging/

### Sessions

```
lemon sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
lemon cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
lemon webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
lemon profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
lemon profile rename A B | alias NAME | export NAME | import FILE
```

### Credentials & Pools

```
lemon auth                 Interactive credential manager
lemon auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
lemon auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
lemon desktop / gui        Native desktop app
lemon dashboard            Web admin panel + embedded chat (--stop / --status)
lemon proxy                OpenAI-compatible local proxy backed by an OAuth provider
lemon portal               Quick setup / sign in via Nous Portal
lemon kanban <verb>        Multi-agent work-queue board
lemon project              Named multi-folder workspaces
lemon skin list|use|set    Switch/tweak skins (see references/themes.md)
lemon pets <verb>          Pet mascots (see references/petdex.md)
lemon memory setup|status|off|reset   Memory provider
lemon secrets bitwarden|onepassword   External secret stores
lemon moa                  Mixture-of-Agents slots
lemon hooks / security / backup / import / checkpoints / console
lemon logs [-f] [errors]   View agent/error logs
lemon send                 One-off message through a gateway platform
lemon pairing / plugins / insights / journey / computer-use
lemon acp                  ACP server (IDE integration)
lemon completion bash|zsh|fish
lemon update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `lemon photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `lemon config edit` · [Configuration docs](https://danglemon.github.io/lemon-agent/docs/user-guide/configuration) |
| Tools / toolsets | `lemon tools list` · [Tools reference](https://danglemon.github.io/lemon-agent/docs/reference/tools-reference) |
| Skills catalog | `lemon skills browse` · [Skills catalog](https://danglemon.github.io/lemon-agent/docs/reference/skills-catalog) |
| Provider setup | `lemon model` · [Providers guide](https://danglemon.github.io/lemon-agent/docs/integrations/providers) |
| Env variables | `lemon config env-path` · [Env vars reference](https://danglemon.github.io/lemon-agent/docs/reference/environment-variables) |
| Gateway logs | `~/.lemon-ai/logs/gateway.log` (or `lemon logs`) |
| Sessions | `lemon sessions browse` (reads state.db) |
