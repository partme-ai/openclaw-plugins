declare module "openclaw/plugin-sdk/diagnostic-runtime" {
  export type DiagnosticEventMetadata = Readonly<{
    trusted: boolean;
  }>;

  export type DiagnosticEventPayload = {
    type: string;
    seq: number;
    ts: number;
    [key: string]: unknown;
  };

  export function onInternalDiagnosticEvent(
    listener: (event: DiagnosticEventPayload, metadata: DiagnosticEventMetadata) => void,
  ): () => void;

  export function emitTrustedDiagnosticEvent(event: Record<string, unknown>): void;
}

declare module "openclaw/plugin-sdk/security-runtime" {
  export function redactSensitiveText(text: string): string;
}
