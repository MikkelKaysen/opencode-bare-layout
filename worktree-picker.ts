import { resolve as resolvePath } from "node:path";

export interface WorktreeEntry {
  path: string;
  branch?: string;
}

export interface WorktreeChoice {
  title: string;
  value: string;
  description: string;
}

/** Parse `git worktree list --porcelain` into recorded paths and branch names. */
export function parseWorktrees(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of out.replace(/\r\n/g, "\n").split("\n\n")) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        const value = line.slice("worktree ".length);
        if (value) path = value;
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        if (ref.startsWith("refs/heads/") && ref.length > "refs/heads/".length) {
          branch = ref.slice("refs/heads/".length);
        }
      }
    }
    if (path) entries.push(branch ? { path, branch } : { path });
  }
  return entries;
}

/**
 * Lets the user choose a linked worktree with a branch, then either:
 *   - moves the given session there (when `sessionID` is set; the session's
 *     current worktree is omitted from the choices), or
 *   - creates a new session in it and navigates to that session (when there
 *     is no session; the current worktree stays in the choices).
 * Cancelling is a no-op in both modes. The UI and Git operations are injected
 * so the selection flow can be tested without a running TUI.
 */
export async function pickExistingWorktree(input: {
  sessionID?: string;
  location?: string;
  list: (location: string) => Promise<string>;
  select: (choices: readonly WorktreeChoice[]) => Promise<string | undefined>;
  move: (sessionID: string, directory: string) => Promise<void>;
  create: (directory: string) => Promise<{ id: string }>;
  navigate: (sessionID: string) => void;
  toast: (message: string) => void;
}): Promise<void> {
  if (!input.location) {
    input.toast("Could not determine the active location.");
    return;
  }
  const location = input.location;
  const moveMode = input.sessionID !== undefined;

  try {
    const current = resolvePath(location);
    const choices = parseWorktrees(await input.list(location))
      .filter(
        (entry): entry is WorktreeEntry & { branch: string } =>
          Boolean(entry.branch) &&
          (!moveMode || resolvePath(location, entry.path) !== current),
      )
      .map((entry) => ({
        title: entry.branch,
        value: entry.path,
        description: entry.path,
      }));

    if (choices.length === 0) {
      input.toast(
        moveMode
          ? "No other linked worktrees found."
          : "No linked worktrees with branches found.",
      );
      return;
    }

    const directory = await input.select(choices);
    if (directory === undefined) return;
    if (input.sessionID !== undefined) {
      await input.move(input.sessionID, directory);
      return;
    }
    const created = await input.create(directory);
    input.navigate(created.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.toast(`Could not switch worktrees: ${message}`);
  }
}
