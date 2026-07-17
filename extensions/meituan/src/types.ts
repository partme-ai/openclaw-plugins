/** 管理员从已审批美团业务文档复制并加入白名单的单个 MTOp operation。 */
export type MeituanOperation = {
  name: string;
  description?: string;
  apiPath: string;
  businessId: number;
  requiresAuth: boolean;
  /** `write` 操作必须在每次工具调用中显式 `confirm=true`；缺省按 write 处理。 */
  riskLevel: "read" | "write";
  /** 当前 operation 接受的平台标准成功码，默认仅 `OP_SUCCESS`。 */
  successCodes: string[];
};

/** OpenClaw 受信任 agentAccountId 到门店授权 Token 的绑定，Agent 参数无法选择或覆盖。 */
export type MeituanAccountCredential = {
  accountId: string;
  appAuthToken: string;
};

/** 经过运行时严格校验、可直接交给 MeituanClient 的插件配置。 */
export type MeituanPluginConfig = {
  enabled: true;
  developerId: string;
  signKey: string;
  appAuthToken?: string;
  accounts: MeituanAccountCredential[];
  requireAccountBinding: boolean;
  /** 仅供已解析运行时使用；false 表示受信任账号未命中强制凭据绑定。 */
  accountBindingMatched: boolean;
  apiBaseUrl: string;
  version: string;
  operations: MeituanOperation[];
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  /** Tool Result 独立上限，防止合法的大响应挤占模型上下文和会话存储。 */
  maxToolResultBytes: number;
  maxRequestsPerMinute: number;
  allowCustomApiBaseUrl: boolean;
  ownerOnly: boolean;
};

/** 美团 MTOp 标准响应；具体 data 结构由 operation 对应业务文档决定。 */
export type MeituanApiResponse = Record<string, unknown>;
