/**
 * @module agent/handler
 *
 * 企业微信 **Agent 模式** POST 回调业务处理器。
 *
 * **职责**：
 * - 消费上游 {@link handleWecomAgentWebhookRequest} 已完成验签/解密的 XML 明文
 * - 基于持久化 dedup（`claimWecomAgentInboundMsgid`）按 msgId 去重
 * - 过滤 event/系统发送者等非用户意图消息
 * - 下载媒体、ASR、动态路由、会话记录，并调度 OpenClaw Agent 回复
 * - 通过 Agent API（非被动 XML 回复）向用户投递文本与媒体
 *
 * **上下游**：
 * - 上游：`agent/webhook.ts` 完成 XML 加解密与 target 路由后传入 `verifiedPost`
 * - 下游：`api-client` 发送消息；`webhook/dedup` 持久化幂等
 *
 * **关键导出**：`handleAgentWebhook`、`shouldProcessAgentInboundMessage`
 */

import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import type { ResolvedAgentAccount } from "../types/index.js";
import {
    extractMsgType,
    extractFromUser,
    extractContent,
    extractChatId,
    extractMediaId,
    extractMsgId,
    extractFileName,
    extractAgentId,
} from "../shared/xml-parser.js";
import { sendText, downloadMedia, uploadMedia, sendMedia as sendAgentMedia } from "./api-client.js";
import type { WecomAgentInboundMessage } from "../types/index.js";
import { resolveWeComAccountMulti } from "../config/accounts.js";
import { sendWelcomeMessage, shouldSendWelcome } from "./welcome.js";
import { transcribeVoice, isVoiceAsrEnabled } from "./asr.js";
import { createStream, updateStream } from "./stream.js";
import { buildWecomUnauthorizedCommandPrompt, resolveWecomCommandAuthorization } from "../shared/command-auth.js";
import { buildWecomPairingReplyText, checkWecomDmPolicy } from "../config/dm-policy.js";
import { checkGroupPolicy } from "../config/group-policy.js";
import { processDynamicRouting } from "../config/dynamic-routing.js";
import { CHANNEL_ID } from "../types/const.js";
import { resolveWecomMediaMaxBytes } from "../config/wecom-config.js";
import { claimWecomAgentInboundMsgid } from "../webhook/dedup.js";

/** HTTP 错误响应末尾的可选帮助文案（当前为空，预留扩展） */
const ERROR_HELP = "";

/**
 * 启发式判断 Buffer 是否像文本文件（非二进制）。
 *
 * 采样前 4KB，非可打印字符占比超过 2% 则视为二进制。
 *
 * @param buffer - 待检测的文件内容
 * @returns 是否更像文本
 */
function looksLikeTextFile(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 4096);
    if (sampleSize === 0) return true;
    let bad = 0;
    for (let i = 0; i < sampleSize; i++) {
        const b = buffer[i]!;
        const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d; // \t \n \r
        const isPrintable = b >= 0x20 && b !== 0x7f;
        if (!isWhitespace && !isPrintable) bad++;
    }
    // 非可打印字符占比太高，基本可判断为二进制
    return bad / sampleSize <= 0.02;
}

/**
 * 分析 Buffer 的可打印字符比例，用于日志诊断 file 消息类型。
 *
 * @param buffer - 待分析内容
 */
function analyzeTextHeuristic(buffer: Buffer): { sampleSize: number; badCount: number; badRatio: number } {
    const sampleSize = Math.min(buffer.length, 4096);
    if (sampleSize === 0) return { sampleSize: 0, badCount: 0, badRatio: 0 };
    let badCount = 0;
    for (let i = 0; i < sampleSize; i++) {
        const b = buffer[i]!;
        const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
        const isPrintable = b >= 0x20 && b !== 0x7f;
        if (!isWhitespace && !isPrintable) badCount++;
    }
    return { sampleSize, badCount, badRatio: badCount / sampleSize };
}

/** 将 Buffer 头部字节格式化为十六进制预览字符串（调试用）。 */
function previewHex(buffer: Buffer, maxBytes = 32): string {
    const n = Math.min(buffer.length, maxBytes);
    if (n <= 0) return "";
    return buffer
        .subarray(0, n)
        .toString("hex")
        .replace(/(..)/g, "$1 ")
        .trim();
}

/**
 * 若内容为文本，截取前 maxChars 字符作为 Agent 上下文预览。
 *
 * @param buffer - 文件内容
 * @param maxChars - 最大预览字符数
 */
function buildTextFilePreview(buffer: Buffer, maxChars: number): string | undefined {
    if (!looksLikeTextFile(buffer)) return undefined;
    const text = buffer.toString("utf8");
    if (!text.trim()) return undefined;
    const truncated = text.length > maxChars ? `${text.slice(0, maxChars)}\n…(已截断)` : text;
    return truncated;
}

/**
 * **AgentWebhookParams (Webhook 处理器参数)**
 *
 * 传递给 Agent Webhook 处理函数的上下文参数集合。
 * @property req Node.js 原始请求对象
 * @property res Node.js 原始响应对象
 * @property agent 解析后的 Agent 账号信息
 * @property config 全局插件配置
 * @property core OpenClaw 插件运行时
 * @property log 可选日志输出函数
 * @property error 可选错误输出函数
 */
export type AgentWebhookParams = {
    req: IncomingMessage;
    res: ServerResponse;
    /**
     * 上游已完成验签/解密时传入，避免重复协议处理。
     * 仅用于 POST 消息回调流程。
     */
    verifiedPost?: {
        timestamp: string;
        nonce: string;
        signature: string;
        encrypted: string;
        decrypted: string;
        parsed: WecomAgentInboundMessage;
    };
    agent: ResolvedAgentAccount;
    config: OpenClawConfig;
    core: PluginRuntime;
    log?: (msg: string) => void;
    error?: (msg: string) => void;
};

/** Agent 入站消息是否进入 AI 会话的判定结果 */
export type AgentInboundProcessDecision = {
    /** 是否应继续 dispatch Agent */
    shouldProcess: boolean;
    /** 跳过或接受的原因码（如 event:enter_chat、missing_sender） */
    reason: string;
};

/**
 * 仅允许“用户意图消息”进入 AI 会话。
 * - event 回调（如 enter_agent/subscribe）不应触发会话与自动回复
 * - 系统发送者（sys）不应触发会话与自动回复
 * - 缺失发送者时默认丢弃，避免写入异常会话
 */
export function shouldProcessAgentInboundMessage(params: {
    msgType: string;
    fromUser: string;
    eventType?: string;
}): AgentInboundProcessDecision {
    const msgType = String(params.msgType ?? "").trim().toLowerCase();
    const fromUser = String(params.fromUser ?? "").trim();
    const normalizedFromUser = fromUser.toLowerCase();
    const eventType = String(params.eventType ?? "").trim().toLowerCase();

    if (msgType === "event") {
        return {
            shouldProcess: false,
            reason: `event:${eventType || "unknown"}`,
        };
    }

    if (!fromUser) {
        return {
            shouldProcess: false,
            reason: "missing_sender",
        };
    }

    if (normalizedFromUser === "sys") {
        return {
            shouldProcess: false,
            reason: "system_sender",
        };
    }

    return {
        shouldProcess: true,
        reason: "user_message",
    };
}

/** 从 XML 解析结果中规范化 AgentId 为有限数字，无效时返回 undefined。 */
function normalizeAgentId(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value ?? "").trim();
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * **resolveQueryParams (解析查询参数)**
 *
 * 辅助函数：从 IncomingMessage 中解析 URL 查询字符串，用于获取签名、时间戳等参数。
 */
function resolveQueryParams(req: IncomingMessage): URLSearchParams {
    const url = new URL(req.url ?? "/", "http://localhost");
    return url.searchParams;
}

/**
 * 处理 Agent POST 消息回调。
 *
 * 流程：校验 preverified 信封 → msgId 持久化 dedup → 立即回 success →
 * 异步 welcome / processAgentMessage。
 *
 * @param params - Webhook 上下文，须含上游已解密的 `verifiedPost`
 */
async function handleMessageCallback(params: AgentWebhookParams): Promise<boolean> {
    const { req, res, verifiedPost, agent, config, core, log, error } = params;

    try {
        if (!verifiedPost) {
            error?.("[wecom-agent] inbound: missing preverified envelope");
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(`invalid request - 缺少上游验签结果${ERROR_HELP}`);
            return true;
        }

        log?.(`[wecom-agent] inbound: method=${req.method ?? "UNKNOWN"} remote=${req.socket?.remoteAddress ?? "unknown"}`);
        const query = resolveQueryParams(req);
        const querySignature = query.get("msg_signature") ?? "";

        const encrypted = verifiedPost.encrypted;
        const decrypted = verifiedPost.decrypted;
        const msg = verifiedPost.parsed;
        const timestamp = verifiedPost.timestamp;
        const nonce = verifiedPost.nonce;
        const signature = verifiedPost.signature || querySignature;
        log?.(
            `[wecom-agent] inbound: using preverified envelope timestamp=${timestamp ? "yes" : "no"} nonce=${nonce ? "yes" : "no"} msg_signature=${signature ? "yes" : "no"} encryptLen=${encrypted.length}`,
        );

        log?.(`[wecom-agent] inbound: decryptedBytes=${Buffer.byteLength(decrypted, "utf8")}`);

        const inboundAgentId = normalizeAgentId(extractAgentId(msg));
        if (
            inboundAgentId !== undefined &&
            typeof agent.agentId === "number" &&
            Number.isFinite(agent.agentId) &&
            inboundAgentId !== agent.agentId
        ) {
            error?.(
                `[wecom-agent] inbound: agentId mismatch ignored expectedAgentId=${agent.agentId} actualAgentId=${String(extractAgentId(msg) ?? "")}`,
            );
        }
        const msgType = extractMsgType(msg);
        const fromUser = extractFromUser(msg);
        const chatId = extractChatId(msg);
        const msgId = extractMsgId(msg);
        const eventType = String((msg as Record<string, unknown>).Event ?? "").trim().toLowerCase();
        // 持久化 dedup：同一 msgId 在 TTL 内重复回调时短路，避免重复 dispatch
        if (msgId) {
            const claimed = await claimWecomAgentInboundMsgid(agent.accountId, msgId);
            if (!claimed) {
                log?.(`[wecom-agent] duplicate msgId=${msgId} from=${fromUser} chatId=${chatId ?? "N/A"} type=${msgType}; skipped`);
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end("success");
                return true;
            }
        }
        const content = String(extractContent(msg) ?? "");

        const preview = content.length > 100 ? `${content.slice(0, 100)}…` : content;
        log?.(`[wecom-agent] ${msgType} from=${fromUser} chatId=${chatId ?? "N/A"} msgId=${msgId ?? "N/A"} content=${preview}`);

        // 先返回 success (Agent 模式使用 API 发送回复，不用被动回复)
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");

        // Send welcome message for enter_chat/subscribe events
        if (msgType === "event" && eventType && shouldSendWelcome(eventType)) {
            const channelAccount = resolveWeComAccountMulti({
                cfg: config,
                accountId: agent.accountId,
            });
            sendWelcomeMessage(agent, fromUser, { channelConfig: channelAccount.config }).catch((err) => {
                error?.(`[wecom-agent] welcome message failed: ${String(err)}`);
            });
        }

        const decision = shouldProcessAgentInboundMessage({
            msgType,
            fromUser,
            eventType,
        });
        if (!decision.shouldProcess) {
            log?.(
                `[wecom-agent] skip processing: type=${msgType || "unknown"} event=${eventType || "N/A"} from=${fromUser || "N/A"} reason=${decision.reason}`,
            );
            return true;
        }

        // 异步处理消息
        processAgentMessage({
            agent,
            config,
            core,
            fromUser,
            chatId,
            msgType,
            content,
            msg,
            log,
            error,
        }).catch((err) => {
            error?.(`[wecom-agent] process failed: ${String(err)}`);
        });

        return true;
    } catch (err) {
        error?.(`[wecom-agent] callback failed: ${String(err)}`);
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`error - 回调处理失败${ERROR_HELP}`);
        return true;
    }
}

/**
 * **processAgentMessage (处理 Agent 消息)**
 *
 * 异步处理解密后的消息内容，并触发 OpenClaw Agent。
 * 流程：
 * 1. 路由解析：根据 userid或群ID 确定 Agent 路由。
 * 2. 媒体处理：如果是图片/文件等，下载资源。
 * 3. 上下文构建：创建 Inbound Context。
 * 4. 会话记录：更新 Session 状态。
 * 5. 调度回复：将 Agent 的响应通过 `api-client` 发送回企业微信。
 */
async function processAgentMessage(params: {
    agent: ResolvedAgentAccount;
    config: OpenClawConfig;
    core: PluginRuntime;
    fromUser: string;
    chatId?: string;
    msgType: string;
    content: string;
    msg: WecomAgentInboundMessage;
    log?: (msg: string) => void;
    error?: (msg: string) => void;
}): Promise<void> {
    const { agent, config, core, fromUser, chatId, content, msg, msgType, log, error } = params;

    const isGroup = Boolean(chatId);
    const peerId = isGroup ? chatId! : fromUser;
    const mediaMaxBytes = resolveWecomMediaMaxBytes(config);
    const channelAccount = resolveWeComAccountMulti({
        cfg: config,
        accountId: agent.accountId,
    });
    const policyAccount = {
        ...channelAccount,
        config: {
            ...channelAccount.config,
            dmPolicy: agent.config.dmPolicy ?? channelAccount.config.dmPolicy,
            allowFrom: agent.config.allowFrom ?? channelAccount.config.allowFrom,
        },
    };

    if (isGroup) {
        const groupPolicyResult = checkGroupPolicy({
            chatId: peerId,
            senderId: fromUser,
            account: channelAccount,
            config,
            runtime: { log, error } as Parameters<typeof checkGroupPolicy>[0]["runtime"],
        });
        if (!groupPolicyResult.allowed) {
            log?.(`[wecom-agent] group policy blocked chatId=${peerId} sender=${fromUser}`);
            return;
        }
    }

    const dmPolicyResult = await checkWecomDmPolicy({
        senderId: fromUser,
        isGroup,
        account: policyAccount,
        runtime: { log, error } as Parameters<typeof checkWecomDmPolicy>[0]["runtime"],
        logPrefix: "[wecom-agent]",
        sendPairingReply: async ({ senderId, code }) => {
            const text = buildWecomPairingReplyText(senderId, code);
            await sendText({ agent, toUser: senderId, chatId: undefined, text });
        },
    });
    if (!dmPolicyResult.allowed) {
        log?.(
            `[wecom-agent] dm policy blocked sender=${fromUser} pairingSent=${String(dmPolicyResult.pairingSent ?? false)}`,
        );
        return;
    }

    // 处理媒体文件
    const attachments: any[] = []; // TODO: define specific type
    let finalContent = content;
    let mediaPath: string | undefined;
    let mediaType: string | undefined;

    if (["image", "voice", "video", "file"].includes(msgType)) {
        const mediaId = extractMediaId(msg);
        if (mediaId) {
            try {
                log?.(`[wecom-agent] downloading media: ${mediaId} (${msgType})`);
                const { buffer, contentType, filename: headerFileName } = await downloadMedia({ agent, mediaId, maxBytes: mediaMaxBytes });
                const xmlFileName = extractFileName(msg);
                const originalFileName = (xmlFileName || headerFileName || `${mediaId}.bin`).trim();
                const heuristic = analyzeTextHeuristic(buffer);

                // 推断文件名后缀
                const extMap: Record<string, string> = {
                    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
                    "audio/amr": "amr", "audio/speex": "speex", "video/mp4": "mp4",
                };
                const textPreview = msgType === "file" ? buildTextFilePreview(buffer, 12_000) : undefined;
                const looksText = Boolean(textPreview);
                const originalExt = path.extname(originalFileName).toLowerCase();
                const normalizedContentType =
                    looksText && originalExt === ".md" ? "text/markdown" :
                    looksText && (!contentType || contentType === "application/octet-stream")
                        ? "text/plain; charset=utf-8"
                        : contentType;

                const ext = extMap[normalizedContentType] || (looksText ? "txt" : "bin");
                const filename = `${mediaId}.${ext}`;

                log?.(
                    `[wecom-agent] file meta: msgType=${msgType} mediaId=${mediaId} size=${buffer.length} maxBytes=${mediaMaxBytes} ` +
                    `contentType=${contentType} normalizedContentType=${normalizedContentType} originalFileName=${originalFileName} ` +
                    `xmlFileName=${xmlFileName ?? "N/A"} headerFileName=${headerFileName ?? "N/A"} ` +
                    `textHeuristic(sample=${heuristic.sampleSize}, bad=${heuristic.badCount}, ratio=${heuristic.badRatio.toFixed(4)}) ` +
                    `headHex="${previewHex(buffer)}"`,
                );

                // 使用 Core SDK 保存媒体文件
                const saved = await core.channel.media.saveMediaBuffer(
                    buffer,
                    normalizedContentType,
                    "inbound", // context/scope
                    mediaMaxBytes, // limit
                    originalFileName
                );

                log?.(`[wecom-agent] media saved to: ${saved.path}`);
                mediaPath = saved.path;
                mediaType = normalizedContentType;

                // ASR for voice messages
                if (msgType === "voice" && isVoiceAsrEnabled(agent)) {
                    try {
                        const transcript = await transcribeVoice(agent, buffer);
                        if (transcript) {
                            finalContent = content
                                ? `${content}\n[语音识别]: ${transcript}`
                                : `[语音识别]: ${transcript}`;
                            log?.(`[wecom-agent] voice ASR: transcript="${transcript.slice(0, 100)}"`);
                        }
                    } catch (err) {
                        error?.(`[wecom-agent] voice ASR failed: ${String(err)}`);
                        finalContent = content
                            ? `${content}\n[语音识别失败]`
                            : "[语音识别失败]";
                    }
                }

                // 构建附件
                attachments.push({
                    name: originalFileName,
                    mimeType: normalizedContentType,
                    url: pathToFileURL(saved.path).href, // 使用跨平台安全的文件 URL
                });

                // 更新文本提示
                if (textPreview) {
                    finalContent = [
                        content,
                        "",
                        "文件内容预览：",
                        "```",
                        textPreview,
                        "```",
                        `(已下载 ${buffer.length} 字节)`,
                    ].join("\n");
                } else {
                    if (msgType === "file") {
                        finalContent = [
                            content,
                            "",
                            `已收到文件：${originalFileName}`,
                            `文件类型：${normalizedContentType || contentType || "未知"}`,
                            "提示：当前仅对文本/Markdown/JSON/CSV/HTML/PDF（可选）做内容抽取；其他二进制格式请转为 PDF 或复制文本内容。",
                            `(已下载 ${buffer.length} 字节)`,
                        ].join("\n");
                    } else {
                        finalContent = `${content} (已下载 ${buffer.length} 字节)`;
                    }
                }
                log?.(`[wecom-agent] file preview: enabled=${looksText} finalContentLen=${finalContent.length} attachments=${attachments.length}`);
            } catch (err) {
                error?.(`[wecom-agent] media processing failed: ${String(err)}`);
                finalContent = [
                    content,
                    "",
                    `媒体处理失败：${String(err)}`,
                    `提示：可在 OpenClaw 配置中提高 channels.wecom.media.maxBytes（当前=${mediaMaxBytes}）`,
                    `例如：openclaw config set channels.wecom.media.maxBytes ${50 * 1024 * 1024}`,
                ].join("\n");
            }
        } else {
            const keys = Object.keys((msg as unknown as Record<string, unknown>) ?? {}).slice(0, 50).join(",");
            error?.(`[wecom-agent] mediaId not found for ${msgType}; keys=${keys}`);
        }
    }

    // 解析路由
    const route = core.channel.routing.resolveAgentRoute({
        cfg: config,
        channel: "wecom",
        accountId: agent.accountId,
        peer: { kind: isGroup ? "group" : "direct", id: peerId },
    });

    // ===== 动态 Agent 路由处理 =====
    const routingResult = processDynamicRouting({
        route,
        config,
        core,
        accountId: agent.accountId,
        chatType: isGroup ? "group" : "dm",
        chatId: peerId,
        senderId: fromUser,
        log: (msg) => log?.(msg.replace(/^\[dynamic-routing\]/, "[wecom-agent]")),
        error: (msg) => error?.(msg.replace(/^\[dynamic-routing\]/, "[wecom-agent]")),
    });

    // 应用动态路由结果
    if (routingResult.routeModified) {
        route.agentId = routingResult.finalAgentId;
        route.sessionKey = routingResult.finalSessionKey;
    }
    // ===== 动态 Agent 路由处理结束 =====

    // 构建上下文
    const fromLabel = isGroup ? `group:${peerId}` : `user:${fromUser}`;
    const storePath = core.channel.session.resolveStorePath(config.session?.store, {
        agentId: route.agentId,
    });
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
        storePath,
        sessionKey: route.sessionKey,
    });
    const body = core.channel.reply.formatAgentEnvelope({
        channel: "WeCom",
        from: fromLabel,
        previousTimestamp,
        envelope: envelopeOptions,
        body: finalContent,
    });

    const authz = await resolveWecomCommandAuthorization({
        core,
        cfg: config,
        // Agent 门禁应读取 channels.wecom.agent.dm（即 agent.config.dm），而不是 channels.wecom.dm（不存在）
        accountConfig: agent.config,
        rawBody: finalContent,
        senderUserId: fromUser,
    });
    log?.(`[wecom-agent] authz: dmPolicy=${authz.dmPolicy} shouldCompute=${authz.shouldComputeAuth} sender=${fromUser.toLowerCase()} senderAllowed=${authz.senderAllowed} authorizerConfigured=${authz.authorizerConfigured} commandAuthorized=${String(authz.commandAuthorized)}`);

    // 命令门禁：未授权时必须明确回复（Agent 侧用私信提示）
    if (authz.shouldComputeAuth && authz.commandAuthorized !== true) {
        const prompt = buildWecomUnauthorizedCommandPrompt({ senderUserId: fromUser, dmPolicy: authz.dmPolicy, scope: "agent" });
        try {
            await sendText({ agent, toUser: fromUser, chatId: undefined, text: prompt });
            log?.(`[wecom-agent] unauthorized command: replied via DM to ${fromUser}`);
        } catch (err: unknown) {
            error?.(`[wecom-agent] unauthorized command reply failed: ${String(err)}`);
        }
        return;
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: body,
        RawBody: finalContent,
        CommandBody: finalContent,
        Attachments: attachments.length > 0 ? attachments : undefined,
        From: isGroup ? `wecom:group:${peerId}` : `wecom:${fromUser}`,
        // 使用 wecom-agent: 前缀标记 Agent 会话，确保 outbound 路由不会混入 Bot WS 发送路径。
        // resolveWecomTarget 已支持剥离 wecom-agent: 前缀（target.ts L41），解析结果不变。
        To: `wecom-agent:${fromUser}`,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: isGroup ? "group" : "direct",
        ConversationLabel: fromLabel,
        SenderName: fromUser,
        SenderId: fromUser,
        Provider: CHANNEL_ID,
        Surface: "webchat",
        OriginatingChannel: CHANNEL_ID,
        // 标记为 Agent 会话的回复路由目标，避免与 Bot 会话混淆：
        // - 用于让 /new /reset 这类命令回执不被 Bot 侧策略拦截
        // - 群聊场景也统一路由为私信触发者（与 deliver 策略一致）
        OriginatingTo: `wecom-agent:${fromUser}`,
        CommandAuthorized: authz.commandAuthorized ?? true,
        MediaPath: mediaPath,
        MediaType: mediaType,
        MediaUrl: mediaPath,
    });

    // 记录会话
    await core.channel.session.recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        ctx: ctxPayload,
        onRecordError: (err: unknown) => {
            error?.(`[wecom-agent] session record failed: ${String(err)}`);
        },
    });

    // 调度回复
    const streamState = createStream();
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: config,
        dispatcherOptions: {
            deliver: async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }, info: { kind: string }) => {
                let text = payload.text ?? "";

                // ── 1. 解析 MEDIA: 指令（兜底处理核心 splitMediaFromOutput 未覆盖的边界情况）──
                const mediaDirectivePaths: string[] = [];
                const mediaDirectiveRe = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;
                let _mdMatch: RegExpExecArray | null;
                while ((_mdMatch = mediaDirectiveRe.exec(text)) !== null) {
                    let p = (_mdMatch[1] ?? "").trim();
                    if (!p) continue;
                    if (p.startsWith("~/") || p === "~") {
                        const home = os.homedir() || "/root";
                        p = p.replace(/^~/, home);
                    }
                    if (!mediaDirectivePaths.includes(p)) mediaDirectivePaths.push(p);
                }
                // 从回复文本中移除 MEDIA: 指令行
                if (mediaDirectivePaths.length > 0) {
                    text = text.replace(/^MEDIA:\s*`?[^\n`]+?`?\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
                }

                // ── 2. 合并所有媒体 URL ──
                const mediaUrls = Array.from(new Set([
                    ...(payload.mediaUrls || []),
                    ...(payload.mediaUrl ? [payload.mediaUrl] : []),
                    ...mediaDirectivePaths,
                ]));

                // ── 3. 发送文本部分 ──
                if (text.trim()) {
                    updateStream(streamState.streamId, { content: text, started: true });
                    try {
                        await sendText({ agent, toUser: fromUser, chatId: undefined, text });
                        updateStream(streamState.streamId, { finished: true });
                        log?.(`[wecom-agent] reply delivered (${info.kind}) to ${fromUser} (textLen=${text.length})`);
                    } catch (err: unknown) {
                        updateStream(streamState.streamId, { finished: true, error: String(err) });
                        const message = err instanceof Error ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}` : String(err);
                        error?.(`[wecom-agent] reply failed: ${message}`);
                    }
                }

                // ── 4. 逐个发送媒体文件（通过 Agent API 上传 + 发送）──
                for (const mediaPath of mediaUrls) {
                    try {
                        const isRemoteUrl = /^https?:\/\//i.test(mediaPath);
                        let buf: Buffer;
                        let contentType: string;
                        let filename: string;

                        if (isRemoteUrl) {
                            const res = await fetch(mediaPath, { signal: AbortSignal.timeout(30_000) });
                            if (!res.ok) throw new Error(`download failed: ${res.status}`);
                            buf = Buffer.from(await res.arrayBuffer());
                            contentType = res.headers.get("content-type") || "application/octet-stream";
                            filename = new URL(mediaPath).pathname.split("/").pop() || "media";
                        } else {
                            const fs = await import("node:fs/promises");
                            const pathModule = await import("node:path");
                            buf = await fs.readFile(mediaPath);
                            filename = pathModule.basename(mediaPath);
                            const ext = pathModule.extname(mediaPath).slice(1).toLowerCase();
                            const MIME_MAP: Record<string, string> = {
                                jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
                                webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav", amr: "audio/amr",
                                mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf",
                                doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                txt: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip",
                            };
                            contentType = MIME_MAP[ext] ?? "application/octet-stream";
                        }

                        // 确定企微媒体类型
                        let mediaType: "image" | "voice" | "video" | "file" = "file";
                        if (contentType.startsWith("image/")) mediaType = "image";
                        else if (contentType.startsWith("audio/")) mediaType = "voice";
                        else if (contentType.startsWith("video/")) mediaType = "video";

                        log?.(`[wecom-agent] uploading media: ${filename} (${mediaType}, ${contentType}, ${buf.length} bytes)`);

                        const mediaId = await uploadMedia({ agent, type: mediaType, buffer: buf, filename });

                        await sendAgentMedia({
                            agent,
                            toUser: fromUser,
                            mediaId,
                            mediaType,
                            ...(mediaType === "video" ? { title: filename, description: "" } : {}),
                        });

                        log?.(`[wecom-agent] media sent (${info.kind}) to ${fromUser}: ${filename} (${mediaType})`);
                    } catch (err: unknown) {
                        const message = err instanceof Error ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}` : String(err);
                        error?.(`[wecom-agent] media send failed: ${mediaPath}: ${message}`);
                        // 降级：发文本通知用户
                        try {
                            await sendText({ agent, toUser: fromUser, chatId: undefined, text: `⚠️ 文件发送失败: ${mediaPath.split("/").pop() || mediaPath}\n${message}` });
                        } catch { /* ignore */ }
                    }
                }

                // 如果既没有文本也没有媒体，不做任何事（防止空回复）
            },
            onError: (err: unknown, info: { kind: string }) => {
                error?.(`[wecom-agent] ${info.kind} reply error: ${String(err)}`);
            },
        }
    });
}

/**
 * **handleAgentWebhook (Agent Webhook 入口)**
 *
 * 统一处理 Agent 模式的 POST 消息回调请求。
 * URL 验证与验签/解密由 monitor 层统一处理后再调用本函数。
 */
export async function handleAgentWebhook(params: AgentWebhookParams): Promise<boolean> {
    const { req } = params;

    if (req.method === "POST") {
        return handleMessageCallback(params);
    }

    return false;
}
