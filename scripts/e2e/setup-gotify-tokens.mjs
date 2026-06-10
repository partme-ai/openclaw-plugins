/**
 * Bootstrap Gotify tokens — thin wrapper for bootstrap/gotify.mjs
 */
import { bootstrapGotify } from "./bootstrap/gotify.mjs";

bootstrapGotify().catch((err) => {
  console.error("[gotify-setup] FAILED:", err.message);
  process.exit(1);
});
