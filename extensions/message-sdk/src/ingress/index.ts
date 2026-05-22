/**
 * ingress 模块 barrel export。
 */

export {
  normalizeIngress,
  normalizeGotifyIngress,
  type NormalizeGotifyIngressParams,
  type NormalizeIngressParams,
} from "./normalize.js";

export {
  parseTransportPayload,
  parseInboundText,
  type ParsedTransportPayload,
  type PayloadParseMode,
} from "../pipeline/parse-payload.js";

export {
  normalizeWireIngress,
  type WireIngressParams,
  type WireIngressResult,
} from "./wire-ingress.js";

export {
  runIngressPolicyChain,
  createAllowlistIngressHook,
  type IngressPolicyContext,
  type IngressPolicyDecision,
  type IngressPolicyHook,
} from "./policy.js";
