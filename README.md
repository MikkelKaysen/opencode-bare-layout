# opencode-plugin-bare-layout

OpenCode plugin (`bare-layout`) that manages git worktrees for repositories stored as a **bare** git repo, with linked worktrees nested beneath the bare root. Newly created worktrees use `<bare-root>/<branch>`.

## Purpose

When the session's location is (or is inside) a bare-layout repository, the plugin:

- registers a worktree strategy (`bare-layout`) so built-in worktree create / remove / list follow this layout;
- registers a searchable TUI picker for linked worktrees, plus branch commands that move the session into a worktree so that directory's `AGENTS.md`, `opencode.json`, agents and skills get loaded.

The server-side worktree strategy and branch commands are registered only when the layout matches, so they are safe to keep enabled globally. The TUI picker uses the active session's Git worktree list and reports when no other linked worktrees are available.

## Bare-layout requirements

```
repo.git/                        (bare repo, core.bare = true)
├── master/                      (branch: master)
├── feature/.../
└── hotfix/.../
```

Detection requires that the git common dir is a bare repository and every linked worktree has an associated branch and lives beneath `<bareRoot>`. Existing worktree directory names do not need to match their branch names; when attaching to an existing branch, the plugin reuses Git's recorded worktree directory. Newly created worktrees continue to use `<bareRoot>/<branch>`.

## Commands

- `/worktree:existing` — open a searchable selection dialog for recorded linked worktrees. Branch names are shown as titles and full recorded paths as descriptions. The bare repository, branchless/malformed entries, and the session's current directory are omitted. Selecting a worktree moves the active session to its recorded directory; cancelling leaves the session unchanged.
- `/worktree-existing <query>` — direct branch-query compatibility path: attach to an existing branch's worktree, creating the worktree if it does not exist yet. The query is resolved against local branches (`refs/heads`) in this order:
  1. exact branch name (case-sensitive);
  2. unique case-insensitive substring of the branch name;
  3. typo-tolerant match against the branch's name components (split on `/`, `-`, `_`, `.`), using edit distance where an adjacent transposition counts as one edit. Tolerance is conservative: queries under 5 characters get none, 5–8 characters allow 1 edit, longer allow 2. E.g. `321312` selects `feature/321321-somethin-some-other`.

  If several branches tie at any step, the command fails and lists the candidates instead of choosing; use the exact name. If nothing matches, the command fails as before and no branch is created.
- `/worktree:new <branch> [base]` — create the branch from `base` (default: `neogit.baseBranch` git config, else `master`) and attach to it.

The colon-free `/worktree-existing` command is intentionally separate from the TUI picker's `/worktree:existing` name. If the host rejects `/worktree:new`, the server plugin retries that command as `/worktree-new`.

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
