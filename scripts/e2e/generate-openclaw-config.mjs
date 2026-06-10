/**
 * Generate ~/.openclaw-queue-e2e/openclaw.json for installed-plugin E2E.
 * @deprecated Prefer `lib/config.mjs` via run-e2e orchestrator.
 */
import { generateOpenClawConfig } from "./lib/config.mjs";

generateOpenClawConfig();
