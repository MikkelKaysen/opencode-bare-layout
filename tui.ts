import { execFile } from "node:child_process";
import { Plugin } from "@opencode/plugin/tui";
import { pickExistingWorktree } from "./worktree-picker.ts";

function listWorktreePorcelain(location: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: location, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export default Plugin.define({
  id: "bare-layout",
  setup(ctx) {
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "bare-layout.worktree-existing-picker",
          title: "Choose existing worktree",
          description:
            "Search a linked worktree; move this session there, or open a new session in it",
          group: "Worktree",
          bind: false,
          palette: true,
          slash: { name: "worktree:existing" },
          run: async () => {
            const route = ctx.ui.router.current();
            const sessionID = route.type === "session" ? route.sessionID : undefined;
            const session = sessionID
              ? ctx.data.session.get(sessionID)
              : undefined;
            const location =
              session?.location.directory ??
              ctx.location?.directory ??
              ctx.data.location.default().directory;

            await pickExistingWorktree({
              sessionID,
              location,
              list: listWorktreePorcelain,
              select: (choices) =>
                ctx.ui.dialog.select({
                  title: "Choose an existing worktree",
                  options: choices,
                }),
              move: (id, directory) =>
                ctx.client.session.move({ sessionID: id, directory }),
              create: (directory) =>
                ctx.client.session.create({ location: { directory } }),
              navigate: (id) =>
                ctx.ui.router.navigate({ type: "session", sessionID: id }),
              toast: (message) =>
                ctx.ui.toast.show({
                  title: "Existing worktree",
                  message,
                  variant: "error",
                }),
            });
          },
        },
      ],
    }));
  },
});
