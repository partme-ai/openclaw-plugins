/**
 * Bridge 的轻量 setup 入口。
 *
 * 这里只转交完整插件对象，不在模块加载时启动 Hook、队列或外部连接；运行副作用由
 * OpenClaw 确认插件启用后通过正式注册生命周期触发。
 */
import plugin from "./bridge/plugin-entry.js";

export { plugin };
export default plugin;
