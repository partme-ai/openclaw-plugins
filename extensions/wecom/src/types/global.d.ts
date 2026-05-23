/**
 * 全局类型补丁：部分构建/测试环境下 Node Buffer 与 Timeout 声明补全。
 * 不参与运行时逻辑。
 */

declare global {
    var Buffer: any;
    namespace NodeJS {
        interface Timeout { }
    }
}

export { };
