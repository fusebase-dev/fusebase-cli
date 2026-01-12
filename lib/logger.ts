import pino from "pino";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, createWriteStream } from "fs";
import EventEmitter from "events";
import { Duplex } from "stream";

interface LoggerEvents {
  "log-error": [
    logEntry: { message: {
      key: string,
      level: number,
      msg: string,
      [key: string]: unknown
    }; stack?: string },
  ];
}

export const loggerEvents = new EventEmitter<LoggerEvents>();

const LOG_DIR = join(homedir(), ".fusebase");
const LOG_FILE = join(LOG_DIR, "error.log");

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore if already exists
}

// Use synchronous destination to avoid thread-stream issues with Bun compilation
const fileDestination = pino.destination({ dest: LOG_FILE, sync: true });

const eventsDestination = new Duplex();

function cleanStackTrace(stack: string): string {
  const lines = stack.split("\n");
  const filtered = lines.filter(
    (line) =>
      !line.includes("(internal:") &&
      !line.includes("lib/logger.ts") &&
      !line.includes("/node_modules/pino/"),
  );
  return filtered.join("\n");
}

eventsDestination._write = (
  data: Buffer,
  encoding: BufferEncoding,
  callback: (error?: Error | null) => void,
) => {
  const parsed = JSON.parse(data.toString("utf8"));
  if (parsed.level >= 50) {
    const raw = new Error(parsed.msg);
    const stack = raw.stack ? cleanStackTrace(raw.stack) : undefined;
    loggerEvents.emit("log-error", {
      message: parsed,
      stack,
    });
  }
  callback();
};

export const logger = pino(
  {
    level: "debug",
  },
  pino.multistream([eventsDestination, fileDestination]),
);
