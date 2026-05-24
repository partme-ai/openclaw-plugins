/**
 * Rednode (xhs) config getter smoke tests.
 */
import { describe, expect, it } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createXhsConfigGetter } from "../src/config.js";

describe("createXhsConfigGetter", () => {
  it("returns undefined when channels.xhs is missing", () => {
    const api = createMockPluginApi({ config: { channels: {} } });
    const getConfig = createXhsConfigGetter(api);
    expect(getConfig()).toBeUndefined();
  });

  it("reads channels.xhs from runtime config", () => {
    const api = createMockPluginApi({
      config: {
        channels: {
          xhs: { app_key: "k1", app_secret: "s1" },
        },
      },
    });
    const getConfig = createXhsConfigGetter(api);
    expect(getConfig()).toEqual({ app_key: "k1", app_secret: "s1" });
  });
});
