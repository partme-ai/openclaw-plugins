/** Load a built plugin entry with the host's real package resolution rules. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} entryPath Absolute or cwd-relative installed plugin entry.
 * @returns {Promise<void>}
 */
export async function probeInstalledPlugin(entryPath) {
  if (typeof entryPath !== "string" || entryPath.trim() === "") {
    throw new TypeError("probeInstalledPlugin requires an entry path");
  }
  const resolvedEntry = resolve(entryPath);
  try {
    await import(pathToFileURL(resolvedEntry).href);
  } catch (cause) {
    throw new Error(`Plugin entry ${resolvedEntry} failed to load: ${String(cause)}`, { cause });
  }
}
