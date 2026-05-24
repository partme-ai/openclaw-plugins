import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { weixinPlugin } from "./channel.js";
import { assertHostCompatibility } from "./shared/compat.js";
import { WeixinConfigSchema } from "./config.js";
import { setWeixinRuntime } from "./runtime.js";

export { weixinPlugin } from "./channel.js";

export default {
  id: "openclaw-weixin",
  name: "Weixin",
  description: "Weixin channel (getUpdates long-poll + sendMessage)",
  configSchema: buildChannelConfigSchema(WeixinConfigSchema),
  register(api: OpenClawPluginApi) {
    // Fail-fast: reject incompatible host versions before any side-effects.
    assertHostCompatibility(api.runtime?.version);

    if (api.runtime) {
      setWeixinRuntime(api.runtime);
    }

    api.registerChannel({ plugin: weixinPlugin });
  },
};
