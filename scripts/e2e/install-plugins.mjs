/**
 * Build, pack, and install queue/channel plugins into OpenClaw profile `queue-e2e`.
 * @deprecated Prefer `node scripts/e2e/run-e2e.mjs` or import from `./lib/install.mjs`.
 */
import { installPlugins } from "./lib/install.mjs";

installPlugins();
