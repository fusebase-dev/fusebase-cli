import { type ChildProcess } from "child_process";
import {
  createJsonlAppender,
  redactSensitiveText,
  type JsonlAppender,
} from "./dev-debug-logs";

type ProcessOutputStream = "stdout" | "stderr";


export interface ManagedBackendDevProcess {
  child: ChildProcess;
  logs: JsonlAppender;
}

export interface ManagedFeatureDevProcess {
  child: ChildProcess;
  logs: JsonlAppender;
}

export interface AttachedFeatureDevLogging {
  appendErrorLine: (line: string) => void;
  flush: () => Promise<void>;
}

interface FeatureDevCapture {
  handleChunk: (stream: ProcessOutputStream, text: string) => void;
}

interface BufferedLineStreamOptions {
  onWrite?: (text: string, stream: ProcessOutputStream) => void;
  onLine: (line: string, stream: ProcessOutputStream) => void;
}

interface BufferedLineStream {
  handleChunk: (stream: ProcessOutputStream, data: string | Buffer) => void;
  flushStream: (stream: ProcessOutputStream) => void;
}


function createBufferedLineStream(
  options: BufferedLineStreamOptions,
): BufferedLineStream {
  const buffers: Record<ProcessOutputStream, string> = {
    stdout: "",
    stderr: "",
  };
  const flushTimers: Partial<
    Record<ProcessOutputStream, ReturnType<typeof setTimeout>>
  > = {};

  const clearFlushTimer = (stream: ProcessOutputStream): void => {
    const timer = flushTimers[stream];
    if (timer) {
      clearTimeout(timer);
      delete flushTimers[stream];
    }
  };

  const flushStream = (stream: ProcessOutputStream): void => {
    clearFlushTimer(stream);

    const pendingLine = buffers[stream];
    buffers[stream] = "";
    if (pendingLine.length > 0) {
      options.onLine(pendingLine, stream);
    }
  };

  const scheduleFlush = (stream: ProcessOutputStream): void => {
    clearFlushTimer(stream);
    flushTimers[stream] = setTimeout(() => {
      flushStream(stream);
    }, 250);
  };

  const handleChunk = (
    stream: ProcessOutputStream,
    data: string | Buffer,
  ): void => {
    const text = typeof data === "string" ? data : data.toString("utf8");

    options.onWrite?.(text, stream);

    buffers[stream] += text;
    const lines = buffers[stream].split(/\r\n|[\r\n]/);
    buffers[stream] = lines.pop() ?? "";

    for (const line of lines) {
      options.onLine(line, stream);
    }

    if (buffers[stream].length > 0) {
      scheduleFlush(stream);
    } else {
      clearFlushTimer(stream);
    }
  };

  return {
    handleChunk,
    flushStream,
  };
}

/**
 * Reads child process stdout/stderr and appends the output to serverOutputPath line by line
 * @param child
 * @param featureId
 * @param serverOutputPath
 * @returns
 */
export function attachBackendOutputLogging(
  child: ChildProcess,
  featureId: string,
  serverOutputPath: string,
): JsonlAppender {
  const appendBackendOutputRecord = attachProcessOutputLogging(
    child,
    featureId,
    serverOutputPath,
    "backend-output",
  );

  return appendBackendOutputRecord;
}

/**
 *
 * @param child
 * @param featureId
 * @param outputPath
 * @param context
 * @param printOutput - if true, the output will also be printed to the console in real time, otherwise it will only be saved to the log file
 * @returns
 */
function attachProcessOutputLogging(
  child: ChildProcess,
  featureId: string,
  outputPath: string,
  context: string,
  printOutput = false,
): JsonlAppender {
  const appendOutputRecord = createJsonlAppender(outputPath, context);
  const appendLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) {
      return;
    }

    appendOutputRecord.append({
      timestamp: new Date().toISOString(),
      featureId,
      line: redactSensitiveText(line),
    });
  };
  const bufferedLineStream = createBufferedLineStream({
    onWrite(text, stream) {
      if (!printOutput) {
        return;
      }
      if (stream === "stderr") {
        process.stderr.write(text);
        return;
      }

      process.stdout.write(text);
    },
    onLine(line) {
      appendLine(line);
    },
  });

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string | Buffer) =>
      bufferedLineStream.handleChunk("stdout", data),
    );
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string | Buffer) =>
      bufferedLineStream.handleChunk("stderr", data),
    );
  }

  child.on("close", () => {
    bufferedLineStream.flushStream("stdout");
    bufferedLineStream.flushStream("stderr");
  });

  return appendOutputRecord;
}

export function attachFrontendDevServerOutputLogging(
  child: ChildProcess,
  featureId: string,
  frontendDevServerPath: string,
  options?: {
    onData?: (text: string, stream: ProcessOutputStream) => void;
    /**
     * Whether to print the output to the console in real time.
     * If false, the output will only be saved to the log file. Default is false.
     */
    printOutput?: boolean;
  },
): JsonlAppender {
  const logs = createJsonlAppender(
    frontendDevServerPath,
    "frontend-dev-server",
  );

  const appendLogLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) return;
    logs.append({
      timestamp: new Date().toISOString(),
      featureId,
      line: redactSensitiveText(line),
    });
  };

  const bufferedLineStream = createBufferedLineStream({
    onWrite(text, stream) {
      if (!options?.printOutput) {
        return;
      }
      if (stream === "stderr") {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
      }
      options?.onData?.(text, stream);
    },
    onLine(line) {
      appendLogLine(line);
    },
  });

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string | Buffer) =>
      bufferedLineStream.handleChunk("stdout", data),
    );
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string | Buffer) =>
      bufferedLineStream.handleChunk("stderr", data),
    );
  }

  child.on("error", (error) => {
    appendLogLine(error.message);
    console.error(`\nFeature dev server error: ${error.message}`);
  });

  child.on("close", async () => {
    bufferedLineStream.flushStream("stdout");
    bufferedLineStream.flushStream("stderr");
  });

  return logs;
}

export async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    child.once("close", finish);
    child.once("error", finish);
    child.kill();

    setTimeout(finish, 2_000);
  });
}
