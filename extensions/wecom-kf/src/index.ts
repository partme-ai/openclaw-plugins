import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { registerWecomKfFull } from "./runtime/register-full.js";

const plugin = {
  id: "wecom-kf",
  name: "WeCom KF",
  description:
    "OpenClaw WeCom KF (WeChat Work Customer Service) — KF callback + Control Tools; agents/skills optional",
  configSchema: emptyPluginConfigSchema(),
  register: registerWecomKfFull,
};

export default plugin;

export * from "./types/index.js";
