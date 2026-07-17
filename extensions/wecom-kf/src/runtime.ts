/**
 * Base Profile Runtime 兼容入口，真实状态管理位于 `runtime/index.ts`。
 * set/get 必须随插件启动和停止生命周期成对使用，避免热重载持有旧宿主引用。
 */
export { setWecomRuntime, getWecomRuntime } from "./runtime/index.js";
