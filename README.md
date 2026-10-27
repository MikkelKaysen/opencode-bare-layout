# opencode-plugin-bare-layout

OpenCode plugin (`bare-layout`) that manages git worktrees for repositories stored as a **bare** git repo, with linked worktrees nested beneath the bare root. Newly created worktrees use `<bare-root>/<branch>`.

## Purpose

When the session's location is (or is inside) a bare-layout repository, the plugin:

- registers a worktree strategy (`bare-layout`) so built-in worktree create / remove / list follow this layout;
- registers a searchable TUI picker for linked worktrees, plus a branch command that moves the session into a worktree so that directory's `AGENTS.md`, `opencode.json`, agents and skills get loaded.

The server-side worktree strategy and branch command are registered only when the layout matches, so they are safe to keep enabled globally. The TUI picker uses the active location's Git worktree list and reports when no suitable linked worktrees are available.

## Bare-layout requirements

```
repo.git/                        (bare repo, core.bare = true)
├── master/                      (branch: master)
├── feature/.../
└── hotfix/.../
```

Detection requires that the git common dir is a bare repository and every linked worktree has an associated branch and lives beneath `<bareRoot>`. Existing worktree directory names do not need to match their branch names; when attaching to an existing branch, the plugin reuses Git's recorded worktree directory. Newly created worktrees continue to use `<bareRoot>/<branch>`.

## Commands

- `/worktree:existing` — open a searchable selection dialog for recorded linked worktrees. Branch names are shown as titles and full recorded paths as descriptions. The bare repository and branchless/malformed entries are omitted.
  - Inside a session, selecting a worktree moves that session to its recorded directory and omits the session's current worktree from the choices. Cancelling leaves the session unchanged.
  - From the home/new-session screen (no active session), selecting a worktree creates a new session in its recorded directory and opens it. The current worktree stays in the choices. Cancelling creates nothing.
  - The location is taken from the active session, then the TUI's current location, then the default location.
- `/worktree:new <branch> [base]` — create the branch from `base` (default: `neogit.baseBranch` git config, else `master`) and attach to it.

The colon-containing `/worktree:new` name is registered by the server plugin; if the host rejects it, the plugin retries that command as `/worktree-new`.

## Package

- Package name: `opencode-plugin-bare-layout`
- Internal plugin and strategy id: `bare-layout`
- Server entry point: `./index.ts`
- TUI entry point: `./tui.ts` (package export `opencode-plugin-bare-layout/tui`)
- SDK dependency: `@opencode/plugin` (pinned to `2.0.14`)

## Installation

This package is loaded as a local directory in the global OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
"plugins": [
  "github:MikkelKaysen/opencode-bare-layout"
]
```

Run `npm install` in this directory once to install the local SDK dependency.
