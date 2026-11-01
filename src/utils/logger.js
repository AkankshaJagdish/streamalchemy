const SECRET_KEYS = /token|secret|authorization|client[-_]?secret/i;

function redact(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey)
      ])
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/OAuth\s+\S+/gi, 'OAuth [REDACTED]');
  }
  return value;
}

export function createLogger(sink = console) {
  const write = (level, message, context) => {
    const safeContext = context === undefined ? undefined : redact(context);
    const method = typeof sink[level] === 'function' ? sink[level] : sink.log;
    if (safeContext === undefined) method.call(sink, message);
    else method.call(sink, message, safeContext);
  };
  return Object.freeze({
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    debug: (message, context) => write('debug', message, context)
  });
}

export const logger = createLogger();
