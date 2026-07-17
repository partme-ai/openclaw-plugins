/**
 * Node.js 内置 SQLite 的运行时加载边界。
 *
 * tsup/esbuild 8.x 会把较新的 `node:sqlite` 静态导入错误改写为 npm 包 `sqlite`。
 * `createRequire` 会原样保留协议字符串，并让单元测试可以只 mock 这一层；生产环境
 * 仍由 OpenClaw 要求的 Node.js 22+ 提供实现，不引入第三方 SQLite 依赖。
 */
import { createRequire } from 'node:module';

export type DatabaseSyncInstance = import('node:sqlite').DatabaseSync;

/** 内置 SQLite 同步构造器；在模块加载时解析，缺少 Node 22 能力时立即失败。 */
export const DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync as typeof import('node:sqlite').DatabaseSync;
