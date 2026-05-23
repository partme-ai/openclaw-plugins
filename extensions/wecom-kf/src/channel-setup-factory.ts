/**
 * Base Profile setup factory shim — wizard lives in `channel/onboarding.ts`.
 */
import { wecomKfOnboardingAdapter } from "./channel/onboarding.js";

/** Setup adapter placeholder; KF uses channel/onboarding for wizard flow. */
export const wecomKfSetupAdapter = {
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,
  validateInput: () => null,
};

/** Setup wizard re-export for Base Profile path. */
export const wecomKfSetupWizard = wecomKfOnboardingAdapter;
