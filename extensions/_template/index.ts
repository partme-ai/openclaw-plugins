import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  id: "TEMPLATE_NAME",
  name: "TEMPLATE_LABEL",
  description: "TEMPLATE_DESCRIPTION",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
  register(api: OpenClawPluginApi) {
    api.logger.info("[TEMPLATE_NAME] Plugin registered");
    // Register channel, tools, hooks here
  },
};

export default plugin;
