/**
 * Base Profile transport shim — KF webhook I/O in `webhook/callback.ts`.
 */
export {
  createKfCallbackHandler,
  consumeAccountStatePatch,
  primeWecomKfCursor,
} from "../webhook/callback.js";

export { processKfEvent, trackAccountEvent } from "../webhook/handler.js";
