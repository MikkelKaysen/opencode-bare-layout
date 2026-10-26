import { execFile } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { Plugin } from "@opencode/plugin";
import type { CommandInvocation } from "@opencode/plugin/promise/command";

/**
 * bare-layout
 *
 * Worktree strategy for repositories stored as a *bare* git repo with every
 * worktree nested directly under the bare root as <bare-root>/<branch>:
 *
 *   atoz.git/                        (bare repo, core.bare = true)
 *   ├── master/                      (branch: master)
 *   ├── feature/385225-cancel-ebdn/  (branch: feature/385225-cancel-ebdn)
 *   └── hotfix/.../
 *
 * When the session's location is (or is inside) such a repository this
 * plugin registers:
 *
 *   - a worktree strategy (ctx.worktree) so the built-in worktree
 *     create / remove / list operations follow this exact layout;
 *   - /worktree:existing <branch>    — attach to an existing branch's
 *     worktree (creating the worktree if it does not exist yet);
 *   - /worktree:new <branch> [base]  — create the branch from `base`
 *     (default: neogit.baseBranch, else master) and attach to it.
 *
 * Both commands then move the session into the worktree directory so that
 * directory's AGENTS.md / opencode.json / agents / skills get loaded.
 *
 * When the layout does not match, nothing is registered, so the plugin is
 * safe to keep enabled globally.
 */

type GitResult = { ok: boolean; out: string };

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        done({ ok: !err, out: (err ? stderr : stdout).trim() });
      },
    );
  });
}

/** Parse `git worktree list --porcelain` into { path, branch? } entries. */
function parseWorktrees(out: string): { path: string; branch?: string }[] {
  const entries: { path: string; branch?: string }[] = [];
  for (const block of out.split("\n\n")) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch "))
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    if (path) entries.push({ path, branch });
  }
  return entries;
}

function isSafeBranch(ref: string): boolean {
  return (
    ref.length > 0 &&
    !ref.startsWith("-") &&
    !ref.startsWith("/") &&
    !ref.includes("..") &&
    !ref.includes("\0")
  );
}

/**
 * Detects the bare-root layout from a directory inside the repository.
 * Returns the bare root when:
 *   - the git common dir is a bare repository, AND
 *   - every linked worktree lives at <bareRoot>/<branch>.
 * Returns null otherwise.
 */
async function detectBareLayout(startDir: string): Promise<string | null> {
  let common = await git(startDir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!common.ok) {
    const rel = await git(startDir, ["rev-parse", "--git-common-dir"]);
    if (!rel.ok) return null;
    common = { ok: true, out: resolvePath(startDir, rel.out) };
  }
  const bareRoot = common.out;
  const isBare = await git(bareRoot, ["rev-parse", "--is-bare-repository"]);
  if (!isBare.ok || isBare.out !== "true") return null;
  const list = await git(bareRoot, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return null;
  for (const wt of parseWorktrees(list.out)) {
    if (wt.path === bareRoot) continue;
    if (!wt.branch || wt.path !== bareRoot + "/" + wt.branch) return null;
  }
  return bareRoot;
}

/**
 * Ensures a worktree exists at <bareRoot>/<branch>:
 *   - existing branch -> git worktree add <dest> <branch>
 *   - missing branch  -> git worktree add -b <branch> <dest> <base>
 *     (base: explicit > neogit.baseBranch > master; only when allowNew)
 * Idempotent: returns <dest> immediately when the worktree already exists.
 */
async function ensureWorktree(
  bareRoot: string,
  branch: string,
  opts: { allowNew: boolean; base?: string },
): Promise<string> {
  const dest = bareRoot + "/" + branch;
  const list = await git(bareRoot, ["worktree", "list", "--porcelain"]);
  if (list.ok && list.out.split("\n").includes("worktree " + dest)) return dest;
  const head = await git(bareRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    "refs/heads/" + branch,
  ]);
  let cmd: string[];
  if (head.ok) {
    cmd = ["worktree", "add", dest, branch];
  } else if (opts.allowNew) {
    const baseCfg = await git(bareRoot, ["config", "--get", "neogit.baseBranch"]);
    const base = opts.base ?? (baseCfg.ok && baseCfg.out ? baseCfg.out : "master");
    cmd = ["worktree", "add", "-b", branch, dest, base];
  } else {
    throw new Error(
      `bare-layout: branch "${branch}" does not exist (use /worktree:new to create it)`,
    );
  }
  const add = await git(bareRoot, cmd);
  if (!add.ok)
    throw new Error(`bare-layout: failed to create worktree at ${dest}:\n${add.out}`);
  return dest;
}

export default Plugin.define({
  id: "bare-layout",
  async setup(ctx) {
    try {
      const startDir = ctx.location?.directory;
      if (typeof startDir !== "string" || !startDir) return;
      const bareRoot = await detectBareLayout(startDir);
      if (!bareRoot) return;

      // Worktree strategy: built-in worktree operations follow this layout.
      await ctx.worktree.transform((editor) => {
        editor.add({
          id: "bare-layout",
          create: async (input) => {
            const raw = input.branch ?? "";
            const branch = raw.startsWith("refs/heads/")
              ? raw.slice("refs/heads/".length)
              : raw;
            if (!isSafeBranch(branch)) {
              throw new Error(
                `bare-layout: unsupported branch ref "${input.branch ?? ""}"`,
              );
            }
            return {
              directory: await ensureWorktree(bareRoot, branch, {
                allowNew: true,
              }),
            };
          },
          remove: async (input) => {
            if (!input.directory.startsWith(bareRoot + "/")) {
              throw new Error(
                `bare-layout: ${input.directory} is not a worktree of this layout`,
              );
            }
            const cmd = [
              "worktree",
              "remove",
              ...(input.force ? ["--force"] : []),
              input.directory,
            ];
            const r = await git(bareRoot, cmd);
            if (!r.ok)
              throw new Error(
                `bare-layout: failed to remove ${input.directory}:\n${r.out}`,
              );
          },
          list: async () => {
            const entries: { directory: string; type: "root" | "worktree" }[] =
              [{ directory: bareRoot, type: "root" }];
            const list = await git(bareRoot, ["worktree", "list", "--porcelain"]);
            if (list.ok) {
              for (const wt of parseWorktrees(list.out)) {
                if (wt.path === bareRoot) continue;
                entries.push({ directory: wt.path, type: "worktree" });
              }
            }
            return entries;
          },
        });
      });

      // Slash commands.
      const commandDefs = (existingName: string, newName: string) => [
        {
          name: existingName,
          description:
            "Move the session into the worktree of an existing branch, creating the worktree if it does not exist yet. Usage: /" +
            existingName +
            " <branch>",
          execute: async ({
            sessionID,
            prompt,
            delivery,
          }: CommandInvocation) => {
            const branch = prompt.text.trim().split(/\s+/).filter(Boolean)[0] ?? "";
            if (!isSafeBranch(branch))
              throw new Error("usage: /" + existingName + " <branch>");
            const dest = await ensureWorktree(bareRoot, branch, {
              allowNew: false,
            });
            await ctx.session.move({ sessionID, directory: dest, delivery });
          },
        },
        {
          name: newName,
          description:
            "Create a new branch from a base ref (defaults to neogit.baseBranch, else master) and move the session into its worktree. Usage: /" +
            newName +
            " <branch> [base]",
          execute: async ({
            sessionID,
            prompt,
            delivery,
          }: CommandInvocation) => {
            const [branch, base] = prompt.text
              .trim()
              .split(/\s+/)
              .filter(Boolean);
            if (!isSafeBranch(branch ?? ""))
              throw new Error("usage: /" + newName + " <branch> [base]");
            if (base !== undefined && !isSafeBranch(base))
              throw new Error(`bare-layout: invalid base ref "${base}"`);
            const dest = await ensureWorktree(bareRoot, branch, {
              allowNew: true,
              base,
            });
            await ctx.session.move({ sessionID, directory: dest, delivery });
          },
        },
      ];

      try {
        await ctx.command.transform((editor) => {
          for (const def of commandDefs("worktree:existing", "worktree:new"))
            editor.add(def);
        });
      } catch (err) {
        console.error(
          "[bare-layout] command registration with ':' names failed, retrying with '-':",
          err,
        );
        try {
          await ctx.command.transform((editor) => {
            for (
              const def of commandDefs("worktree-existing", "worktree-new")
            )
              editor.add(def);
          });
        } catch (err2) {
          console.error("[bare-layout] command registration failed:", err2);
        }
      }
    } catch (err) {
      console.error("[bare-layout] setup failed; registering nothing:", err);
    }
  },
});
