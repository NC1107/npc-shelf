export interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

function pushEntry(level: LogEntry['level'], args: any[]) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  for (const listener of listeners) {
    try { listener(entry); } catch { /* ignore */ }
  }
}

export function getRecentLogs(count = MAX_ENTRIES): LogEntry[] {
  return buffer.slice(-count);
}

export function subscribe(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Monkey-patch console.log/warn/error to capture output into the ring buffer.
 * Call once at startup.
 */
export function installLogCapture(): void {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: any[]) => {
    origLog(...args);
    pushEntry('log', args);
  };
  console.warn = (...args: any[]) => {
    origWarn(...args);
    pushEntry('warn', args);
  };
  console.error = (...args: any[]) => {
    origError(...args);
    pushEntry('error', args);
  };
}
