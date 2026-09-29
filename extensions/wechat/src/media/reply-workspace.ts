import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

/** Current reply turn only; the host supplies workspaceDir after preparing its agent run. */
export type WeixinReplyWorkspace = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
};

const activeReplyWorkspace = new AsyncLocalStorage<WeixinReplyWorkspace>();

export function runWithWeixinReplyWorkspace<T>(
  context: WeixinReplyWorkspace,
  run: () => Promise<T>,
): Promise<T> {
  return activeReplyWorkspace.run(context, run);
}

/** Accept only a workspace provided by the host for this exact routed turn. */
export function captureWeixinReplyWorkspace(context: WeixinReplyWorkspace): void {
  const active = activeReplyWorkspace.getStore();
  if (
    !active?.agentId ||
    !active.sessionKey ||
    context.agentId !== active.agentId ||
    context.sessionKey !== active.sessionKey ||
    !context.workspaceDir ||
    !path.isAbsolute(context.workspaceDir)
  ) {
    return;
  }
  active.workspaceDir = context.workspaceDir;
}
