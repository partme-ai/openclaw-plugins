/**
 * @module mqtt/runtime/mqtt-plugin
 *
 * OpenClaw MQTT 渠道插件定义（ChannelPlugin）。
 */

import { mqttChannel } from "../channel.js";

/**
 * OpenClaw 加载的 MQTT ChannelPlugin 实例。
 *
 * 该别名保持 setup 入口与完整运行入口引用同一个渠道定义，避免注册信息和运行行为漂移。
 */
export const mqttPlugin = mqttChannel;
