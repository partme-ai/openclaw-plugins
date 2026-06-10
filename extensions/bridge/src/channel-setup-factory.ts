/**
 * @fileoverview Bridge 非 Channel 型插件的 setup 适配占位。
 *
 * @description
 * 在 OpenClaw 多插件形态下，部分 Profile 期望存在「账号解析 / 配置套用 / 输入校验 /
 * 向导元数据」等 setup 钩子。本模块提供最小可用占位，使 Bridge 能以 Base Profile 的
 * channel-setup 管线接入而不实现真实的多账号 Channel 向导。
 *
 * @module channel-setup-factory
 */

/**
 * @description Bridge 的 setup 适配器：解析账号 ID、回传配置、声明无额外校验错误。
 *
 * 字段说明：
 * - `resolveAccountId`：将用户输入或缺省账号归一为非空字符串（默认 `default`）。
 * - `applyAccountConfig`：本插件不对配置做变换，原样返回。
 * - `validateInput`：始终返回 `null` 表示无可报告的校验问题。
 */
export const bridgeSetupAdapter = {
  /**
   * @description 规范化账号标识；空值与仅空白归一为 `default`。
   * @param root0 - 入参对象。
   * @param root0.accountId - 可选账号 ID。
   * @returns 修剪后的账号 ID 或 `default`。
   * @throws 不抛出。
   */
  resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim() || "default",

  /**
   * @description 原样返回传入配置，占位以满足 setup 流水线类型契约。
   * @param root0 - 入参对象。
   * @param root0.cfg - 任意插件配置快照。
   * @returns 与入参相同的 `cfg` 引用。
   * @throws 不抛出。
   */
  applyAccountConfig: ({ cfg }: { cfg: unknown }) => cfg,

  /**
   * @description 无客户端校验逻辑，固定返回 `null`。
   * @returns `null`
   * @throws 不抛出。
   */
  validateInput: () => null,
};

/**
 * @description Bridge 向导元数据：声明渠道 key 与简介列表，供 UI 展示；无表单字段。
 */
export const bridgeSetupWizard = {
  /** @description 与 Bridge 插件逻辑渠道标识一致。 */
  channel: "bridge",
  /** @description 多行介绍文案（通常仅一段标题级说明）。 */
  intro: ["OpenClaw Bridge — 统一 IM 渠道适配层"],
  /** @description 无交互式文本输入项。 */
  textInputs: [],
};
