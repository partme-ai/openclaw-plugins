/**
 * Welcome Messages - Agent Mode Capability
 *
 * Sends welcome messages on enter_chat and subscribe events
 *
 * Source: wecom-app welcome message handling
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import { sendText } from "./api-client.js";

/**
 * Send welcome message to user
 * @param account - Agent account configuration
 * @param userId - User ID to send welcome message to
 * @param welcomeText - Welcome message text (optional, falls back to account config)
 */
export async function sendWelcomeMessage(
  account: ResolvedAgentAccount,
  userId: string,
  welcomeText?: string
): Promise<void> {
  const text = welcomeText?.trim() || account.config.welcomeText?.trim();
  if (!text) {
    return; // No welcome text configured
  }

  try {
    await sendText({
      agent: account,
      toUser: userId,
      text,
    });
  } catch (error) {
    console.error(`[wecom-agent] Failed to send welcome message to ${userId}:`, error);
    throw error;
  }
}

/**
 * Check if event type should trigger welcome message
 * @param eventType - Event type from WeCom webhook
 * @returns true if welcome message should be sent
 */
export function shouldSendWelcome(eventType: string): boolean {
  return eventType === "enter_chat" || eventType === "subscribe";
}
