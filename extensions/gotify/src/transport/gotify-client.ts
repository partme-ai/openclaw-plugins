/**
 * @file GotifyClient façade —— OOP 风格薄包装（可选依赖）。
 *
 * @description Channel 主流路径仍直接用 `gotify-api` 方法以便注入 `fetchImpl`；
 * 本类适合脚本 / REPL / 未来子命令重用 **已绑定账号** 的语义。
 * **模块角色**：Channel Plugin · Ergonomic helper（非 hot path）。
 */

import type {
  GotifyApplicationInfo,
  GotifyMessagePayload,
  GotifyMessageResponse,
  ResolvedGotifyAccount,
} from "../types.js";
import {
  createApplication,
  listApplications,
  sendGotifyMessage,
} from "./gotify-api.js";

/**
 * 面向调用方的轻量 Gotify client facade。
 *
 * 该类把已解析账号绑定到实例上，适合测试、bootstrap 脚本或未来 CLI 命令复用；
 * channel runtime 仍然直接使用 `gotify-api.ts` 中的函数以便传入 fetch 测试替身。
 */
export class GotifyClient {
  /**
   * @param account - 已解析 Gotify 账号配置。
   */
  constructor(private readonly account: ResolvedGotifyAccount) {}

  /**
   * 发送 Gotify 消息。
   *
   * @param payload - Gotify Message API payload。
   * @returns Gotify 创建后的消息响应。
   */
  async sendMessage(
    payload: GotifyMessagePayload,
  ): Promise<GotifyMessageResponse> {
    return await sendGotifyMessage(this.account, payload);
  }

  /**
   * 创建 Gotify Application。
   *
   * @param params - Application 名称和可选描述。
   * @returns 创建后的 Application 信息。
   */
  async bootstrapApplication(params: {
    name: string;
    description?: string;
  }): Promise<GotifyApplicationInfo> {
    return await createApplication(this.account, params);
  }

  /**
   * 获取当前账号可见的 Gotify Application 列表。
   *
   * @returns Application 列表。
   */
  async getApplications(): Promise<GotifyApplicationInfo[]> {
    return await listApplications(this.account);
  }
}
