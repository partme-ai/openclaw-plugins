import { describe, expect, it } from "vitest";
import {
  isWecomFailedConfigKey,
  isWecomFailedTemplateKey,
  isWecomTypingConfigKey,
  isWecomTypingTemplateKey,
  WECOM_FAILED_CONFIG_KEYS,
  WECOM_TEMPLATE_STAGES,
  WECOM_TEXT_STAGES,
  WECOM_TYPING_CONFIG_KEYS,
  WECOM_TYPING_TEXT_MAX_RECOMMENDED_LENGTH,
} from "./text-stages.js";
import { WECOM_DEFAULT_TEMPLATES } from "./templates.js";
import { WECOM_TEXT_KEY_MAPPING } from "./text-config.js";

describe("WECOM_TEXT_STAGES", () => {
  it("classifies every *Text config key", () => {
    const configKeys = Object.keys(WECOM_TEXT_KEY_MAPPING).length + 1; // + streamPlaceholderText
    expect(Object.keys(WECOM_TEXT_STAGES)).toHaveLength(configKeys);
  });

  it("maps internal keys consistently via WECOM_TEXT_KEY_MAPPING", () => {
    for (const [internal, flat] of Object.entries(WECOM_TEXT_KEY_MAPPING)) {
      expect(WECOM_TEMPLATE_STAGES[internal as keyof typeof WECOM_TEMPLATE_STAGES]).toBe(
        WECOM_TEXT_STAGES[flat],
      );
    }
  });

  it("emptyReplyText is failed, not typing", () => {
    expect(WECOM_TEXT_STAGES.emptyReplyText).toBe("failed");
    expect(isWecomFailedConfigKey("emptyReplyText")).toBe(true);
    expect(isWecomTypingConfigKey("emptyReplyText")).toBe(false);
    expect(isWecomFailedTemplateKey("emptyReply")).toBe(true);
    expect(isWecomTypingTemplateKey("emptyReply")).toBe(false);
  });

  it("typing keys exclude failed and finalSuccess", () => {
    for (const key of WECOM_TYPING_CONFIG_KEYS) {
      expect(WECOM_TEXT_STAGES[key]).toBe("typing");
    }
    for (const key of WECOM_FAILED_CONFIG_KEYS) {
      expect(WECOM_TEXT_STAGES[key]).toBe("failed");
    }
    expect(WECOM_TYPING_CONFIG_KEYS).not.toContain("emptyReplyText");
    expect(WECOM_FAILED_CONFIG_KEYS).toContain("emptyReplyText");
  });
});

describe("default typing template length", () => {
  const typingInternalKeys = (
    Object.entries(WECOM_TEMPLATE_STAGES) as Array<
      [keyof typeof WECOM_TEMPLATE_STAGES, string]
    >
  )
    .filter(([, stage]) => stage === "typing")
    .map(([key]) => key);

  it("keeps built-in typing defaults within recommended length", () => {
    for (const key of typingInternalKeys) {
      const text = WECOM_DEFAULT_TEMPLATES[key];
      expect(text.length).toBeLessThanOrEqual(WECOM_TYPING_TEXT_MAX_RECOMMENDED_LENGTH);
    }
  });
});
