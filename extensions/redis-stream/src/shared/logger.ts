/**
 * 轻量级 logger —— 统一日志前缀，避免各模块散落 console 语句。
 *
 * 当 OpenClaw runtime 可用时可通过 setLogger 替换实现，
 * 否则退回到带前缀的 console 方法。
 */

const PREFIX = "[openclaw-redis-stream]";

type LogFn = (message: string, ...args: unknown[]) => void;

let _info: LogFn = (msg, ...args) => console.log(`${PREFIX} ${msg}`, ...args);
let _warn: LogFn = (msg, ...args) => console.warn(`${PREFIX} ${msg}`, ...args);
let _error: LogFn = (msg, ...args) =>
  console.error(`${PREFIX} ${msg}`, ...args);

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    _info(msg, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    _warn(msg, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    _error(msg, ...args);
  },

  /** 替换为自定义 logger（如 OpenClaw rt.log） */
  setLoggers(opts: { info?: LogFn; warn?: LogFn; error?: LogFn }): void {
    if (opts.info) _info = opts.info;
    if (opts.warn) _warn = opts.warn;
    if (opts.error) _error = opts.error;
  },
};
