/**
 * Gotify Client — 高层业务 Client 封装。
 *
 * 基于 gotify-api 原始函数进一步封装 Gotify Application/Client/Message 管理。
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
