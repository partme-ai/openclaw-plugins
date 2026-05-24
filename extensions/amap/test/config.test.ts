/**
 * Amap config getter tests.
 */
import { describe, expect, it } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createAmapConfigGetter } from "../src/config.js";

describe("createAmapConfigGetter", () => {
  it("returns undefined when channels.amap missing", () => {
    const api = createMockPluginApi({ config: { channels: {} } });
    expect(createAmapConfigGetter(api as never)()).toBeUndefined();
  });

  it("reads channels.amap from runtime config", () => {
    const api = createMockPluginApi({
      config: {
        channels: {
          amap: { key: "amap-key", poi_id: "poi-1" },
        },
      },
    });
    expect(createAmapConfigGetter(api as never)()).toEqual({
      key: "amap-key",
      poi_id: "poi-1",
    });
  });
});
