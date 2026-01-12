export const BROWSER_DEBUG_SCRIPT_TEMPLATE = `(() => {
  if (window.__fusebaseDebugInstalled) {
    return;
  }

  Object.defineProperty(window, "__fusebaseDebugInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
  });

  const endpoint = "__DEBUG_LOG_PATH__";
  const maxDepth = 4;
  const maxArrayLength = 20;
  const maxObjectKeys = 20;
  const maxStringLength = 2000;
  const maxEventBytes = 24000;
  const sessionId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "session-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  let sequence = 0;

  const redactText = (value) =>
    String(value)
      .replace(/(bearer\\s+)[^\\s]+/gi, "$1[REDACTED]")
      .replace(/((?:token|secret|authorization|cookie)[^:=\\n]{0,20}[:=]\\s*)([^\\s,;]+)/gi, "$1[REDACTED]")
      .replace(/eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9._-]+\\.[a-zA-Z0-9._-]+/g, "[REDACTED_JWT]");

  const truncate = (value, max = maxStringLength) =>
    value.length <= max ? value : value.slice(0, max) + "...[truncated]";

  const toSummary = (value) => {
    if (typeof value === "string") {
      return truncate(redactText(value));
    }
    try {
      return truncate(redactText(JSON.stringify(value)));
    } catch {
      return "[unserializable]";
    }
  };

  const serialize = (value, seen, depth) => {
    if (value === null) {
      return null;
    }

    if (depth >= maxDepth) {
      return "[Truncated]";
    }

    const type = typeof value;

    if (type === "string") {
      return truncate(redactText(value));
    }

    if (type === "number") {
      return Number.isFinite(value) ? value : String(value);
    }

    if (type === "boolean") {
      return value;
    }

    if (type === "bigint") {
      return truncate(value.toString());
    }

    if (type === "undefined") {
      return "[undefined]";
    }

    if (type === "function") {
      return "[Function " + (value.name || "anonymous") + "]";
    }

    if (type === "symbol") {
      return value.toString();
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: truncate(redactText(value.message || "")),
        stack: typeof value.stack === "string" ? truncate(redactText(value.stack), 6000) : null,
      };
    }

    if (Array.isArray(value)) {
      return value.slice(0, maxArrayLength).map((entry) => serialize(entry, seen, depth + 1));
    }

    if (typeof Node !== "undefined" && value instanceof Node) {
      return "[" + (value.constructor && value.constructor.name ? value.constructor.name : "DOMNode") + "]";
    }

    if (typeof Window !== "undefined" && value instanceof Window) {
      return "[Window]";
    }

    if (typeof Document !== "undefined" && value instanceof Document) {
      return "[Document]";
    }

    if (typeof Request !== "undefined" && value instanceof Request) {
      return {
        method: value.method,
        url: value.url,
      };
    }

    if (typeof Response !== "undefined" && value instanceof Response) {
      return {
        status: value.status,
        statusText: value.statusText,
        url: value.url,
      };
    }

    if (typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }

      seen.add(value);
      const entries = Object.entries(value).slice(0, maxObjectKeys);
      const output = {};

      for (const [key, entryValue] of entries) {
        const loweredKey = key.toLowerCase();
        if (
          loweredKey.includes("token") ||
          loweredKey.includes("secret") ||
          loweredKey.includes("authorization") ||
          loweredKey.includes("cookie")
        ) {
          output[key] = "[REDACTED]";
          continue;
        }
        output[key] = serialize(entryValue, seen, depth + 1);
      }

      if (Object.keys(value).length > maxObjectKeys) {
        output.__truncated__ = true;
      }

      return output;
    }

    return truncate(redactText(String(value)));
  };

  const send = (payload) => {
    try {
      let body = JSON.stringify(payload);
      if (body.length > maxEventBytes) {
        body = JSON.stringify({
          ...payload,
          args: ["[payload truncated]"],
          error: payload.error ? { summary: toSummary(payload.error) } : undefined,
          message: truncate(payload.message || "", 1000),
        });
      }

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(
          endpoint,
          new Blob([body], { type: "application/json" })
        );
        if (sent) {
          return;
        }
      }

      void fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {
      // Ignore transport failures to avoid breaking the page.
    }
  };

  const emit = (event) => {
    send({
      sessionId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      pathname: window.location.pathname,
      userAgent: navigator.userAgent,
      ...event,
    });
  };

  const wrapConsole = (level) => {
    const original = console[level];
    if (typeof original !== "function") {
      return;
    }

    console[level] = function (...args) {
      try {
        const serializedArgs = args.map((arg) => serialize(arg, new WeakSet(), 0));
        emit({
          type: "console",
          level,
          args: serializedArgs,
          message: serializedArgs.map((arg) => toSummary(arg)).join(" "),
        });
      } catch {
        // Ignore logging failures and keep original console behavior.
      }

      return Reflect.apply(original, console, args);
    };
  };

  ["log", "info", "warn", "error", "debug"].forEach(wrapConsole);

  window.addEventListener(
    "error",
    (event) => {
      emit({
        type: "error",
        level: "error",
        message: event.message || "Uncaught error",
        error: serialize(
          event.error || {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
          new WeakSet(),
          0
        ),
      });
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    emit({
      type: "unhandledrejection",
      level: "error",
      message: "Unhandled promise rejection",
      error: serialize(event.reason, new WeakSet(), 0),
    });
  });

  const wrapHistory = (methodName) => {
    const original = history[methodName];
    if (typeof original !== "function") {
      return;
    }

    history[methodName] = function (...args) {
      const result = Reflect.apply(original, history, args);
      emit({
        type: "navigation",
        level: "debug",
        message: methodName + ": " + window.location.pathname,
        pathname: window.location.pathname,
      });
      return result;
    };
  };

  wrapHistory("pushState");
  wrapHistory("replaceState");

  window.addEventListener("popstate", () => {
    emit({
      type: "navigation",
      level: "debug",
      message: "popstate: " + window.location.pathname,
      pathname: window.location.pathname,
    });
  });

  window.addEventListener("hashchange", () => {
    emit({
      type: "navigation",
      level: "debug",
      message: "hashchange: " + window.location.pathname + window.location.hash,
      pathname: window.location.pathname,
    });
  });

  window.addEventListener("pagehide", () => {
    emit({
      type: "lifecycle",
      level: "debug",
      message: "pagehide",
    });
  });

  emit({
    type: "lifecycle",
    level: "debug",
    message: "debug-client-initialized",
  });
})();`;
