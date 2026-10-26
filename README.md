# opencode-plugin-bare-layout

OpenCode plugin (`bare-layout`) that manages git worktrees for repositories stored as a **bare** git repo, with every worktree nested directly under the bare root as `<bare-root>/<branch>`.

## Purpose

When the session's location is (or is inside) a bare-layout repository, the plugin:

- registers a worktree strategy (`bare-layout`) so built-in worktree create / remove / list follow this layout;
- registers slash commands that attach the session to a branch's worktree and move the session into it, so that directory's `AGENTS.md`, `opencode.json`, agents and skills get loaded.

When the layout does not match, nothing is registered, so the plugin is safe to keep enabled globally.

## Bare-layout requirements

```
repo.git/                        (bare repo, core.bare = true)
├── master/                      (branch: master)
├── feature/.../
└── hotfix/.../
```

Detection requires that the git common dir is a bare repository and every linked worktree lives at `<bareRoot>/<branch>`.

## Commands

- `/worktree:existing <query>` — attach to an existing branch's worktree, creating the worktree if it does not exist yet. The query is resolved against local branches (`refs/heads`) in this order:
  1. exact branch name (case-sensitive);
  2. unique case-insensitive substring of the branch name;
  3. typo-tolerant match against the branch's name components (split on `/`, `-`, `_`, `.`), using edit distance where an adjacent transposition counts as one edit. Tolerance is conservative: queries under 5 characters get none, 5–8 characters allow 1 edit, longer allow 2. E.g. `321312` selects `feature/321321-somethin-some-other`.

  If several branches tie at any step, the command fails and lists the candidates instead of choosing; use the exact name. If nothing matches, the command fails as before and no branch is created.
- `/worktree:new <branch> [base]` — create the branch from `base` (default: `neogit.baseBranch` git config, else `master`) and attach to it.

If the `:` names are rejected by the host, the plugin retries with `worktree-existing` / `worktree-new`.

## Package

- Package name: `opencode-plugin-bare-layout`
- Internal plugin and strategy id: `bare-layout`
- Entry point: `./index.ts`
- SDK dependency: `@opencode/plugin` (pinned to `2.0.14`)

## Installation

This package is loaded as a local directory in the global OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
"plugins": [
  "github:MikkelKaysen/opencode-bare-layout"
]
```

Run `npm install` in this directory once to install the local SDK dependency.
