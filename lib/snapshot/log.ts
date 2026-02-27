type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

export function log(level: LogLevel, message: string, payload: LogPayload = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...payload,
  };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, payload?: LogPayload) => log("info", message, payload),
  warn: (message: string, payload?: LogPayload) => log("warn", message, payload),
  error: (message: string, payload?: LogPayload) => log("error", message, payload),
};
