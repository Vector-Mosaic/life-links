export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogEvent = {
  ts: string;
  level: LogLevel;
  system: "life_links";
  component: string;
  env: string;
  event: string;
  msg: string;
  [field: string]: unknown;
};

export type LogSink = (event: LogEvent) => void;

export type Logger = {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
  fatal: (event: string, fields?: Record<string, unknown>) => void;
};

export type LoggerOptions = {
  env?: string;
  now?: () => Date;
  sink?: LogSink;
};

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|cookie|authorization|databaseurl|connectionstring|command[-_]?id|idempotency(?:[-_]?key)?)/i;

export function createLogger(component: string, options: LoggerOptions = {}): Logger {
  const env = options.env ?? resolveLogEnv(process.env);
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? consoleLogSink;

  function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    const safeFields = redactFields(fields) as Record<string, unknown>;
    const payload: LogEvent = {
      ...safeFields,
      ts: now().toISOString(),
      level,
      system: "life_links",
      component,
      env,
      event,
      msg: typeof safeFields.msg === "string" ? safeFields.msg : messageFromEvent(event)
    };
    sink(payload);
  }

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    fatal: (event, fields) => write("fatal", event, fields)
  };
}

function consoleLogSink(event: LogEvent) {
  const line = JSON.stringify(event);
  if (event.level === "error" || event.level === "fatal") {
    console.error(line);
    return;
  }
  if (event.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function redactFields(value: unknown, key = ""): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactFields(item));
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactFields(entryValue, entryKey)
      ])
    );
  }
  return value;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-postgres-url]")
    .replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

function messageFromEvent(event: string): string {
  return event
    .replace(/^life_links\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveLogEnv(env: NodeJS.ProcessEnv): string {
  const value = env.APP_ENV ?? env.LIFE_LINKS_ENV ?? env.NODE_ENV ?? (env.CI ? "ci" : "local");
  if (value === "production") {
    return "prod";
  }
  if (value === "test") {
    return "ci";
  }
  return value;
}
