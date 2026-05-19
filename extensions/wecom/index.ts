import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  id: "wecom",
  register(api: OpenClawPluginApi) {
    api.logger.info("[wecom] Plugin registered");
  },
};

export default plugin;
