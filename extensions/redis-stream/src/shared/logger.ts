/**
 * 轻量级 logger —— 统一日志前缀，避免各模块散落 console 语句。
 *
 * Gateway 启动账户时通过 `setLoggers` 注入宿主日志器。默认实现必须静默，避免插件在
 * 注册早期或单元测试中绕过 OpenClaw 的结构化日志、脱敏和采集链路直接写控制台。
 */

const PREFIX = "[openclaw-redis-stream]";

type LogFn = (message: string, ...args: unknown[]) => void;

const noop: LogFn = () => undefined;
let _info: LogFn = noop;
let _warn: LogFn = noop;
let _error: LogFn = noop;

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    _info(`${PREFIX} ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    _warn(`${PREFIX} ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    _error(`${PREFIX} ${msg}`, ...args);
  },

  /** 替换为自定义 logger（如 OpenClaw rt.log） */
  setLoggers(opts: { info?: LogFn; warn?: LogFn; error?: LogFn }): void {
    _info = opts.info ?? noop;
    _warn = opts.warn ?? noop;
    _error = opts.error ?? noop;
  },

  /** 清除旧 Gateway 实例的日志引用，避免热重载后继续写入已停止的宿主。 */
  resetLoggers(): void {
    _info = noop;
    _warn = noop;
    _error = noop;
  },
};
