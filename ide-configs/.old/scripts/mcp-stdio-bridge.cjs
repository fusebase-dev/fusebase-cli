#!/usr/bin/env node
/**
 * MCP stdio Bridge
 *
 * Transparent JSON-RPC proxy that forwards all MCP protocol messages
 * from stdio (for Claude Desktop) to the HTTP MCP server.
 *
 * Supports all MCP protocol methods:
 * - Tools: tools/list, tools/describe, tools/call, etc.
 * - Resources: resources/list, resources/read
 * - Prompts: prompts/list, prompts/get
 * - Other: initialize, ping, etc.
 *
 * The bridge is protocol-agnostic and forwards all JSON-RPC 2.0 messages
 * transparently, so resources and prompts are automatically supported.
 *
 * Uses .cjs so Node always runs it as CommonJS (works with or without "type": "module").
 */

const http = require("http");
const https = require("https");
const readline = require("readline");
const path = require("path");

// NOTE: Never use console.log() for debugging - it breaks the JSON-RPC protocol!
// console.log() = stdout = JSON-RPC responses (REQUIRED for protocol)
// console.error() = stderr = debug logs (safe for debugging)

// Load environment variables from .env file synchronously before anything else
const fs = require("fs");
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

const MCP_TOKEN = process.env.DASHBOARDS_MCP_TOKEN;
const MCP_SERVER_URL = process.env.DASHBOARDS_MCP_URL;

if (!MCP_SERVER_URL || !MCP_TOKEN) {
  console.error("[mcp-bridge] ERROR: Missing required env vars (DASHBOARDS_MCP_URL, DASHBOARDS_MCP_TOKEN)");
  process.exit(1);
}

// Session ID for MCP HTTP transport - required after initialize
let mcpSessionId = null;

const REQUEST_TIMEOUT_MS = 90 * 1000; // 90s - avoid hanging on idle/dead connections

function sendJsonRpcError(id, code, message) {
  console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
}

function doRequest(message, postData, isRetry) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Content-Length": Buffer.byteLength(postData),
    Authorization: `Bearer ${MCP_TOKEN}`,
  };
  if (mcpSessionId && !isRetry) {
    headers["Mcp-Session-Id"] = mcpSessionId;
  }

  const options = { method: "POST", headers };
  const httpModule = MCP_SERVER_URL.startsWith("https") ? https : http;
  const req = httpModule.request(MCP_SERVER_URL, options, (res) => {
    // Session expired or unauthorized - drop session and retry once without it
    if (res.statusCode === 401 || res.statusCode === 410) {
      if (!isRetry) {
        mcpSessionId = null;
        console.error("[mcp-bridge] Session expired (HTTP " + res.statusCode + "), reconnecting...");
        doRequest(message, postData, true);
        return;
      }
    }

    const sessionId = res.headers["mcp-session-id"];
    if (sessionId && !mcpSessionId) {
      mcpSessionId = sessionId;
    }

    let buffer = "";

    const onResponseData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventType = null;
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim();
          if (data) {
            try {
              const response = JSON.parse(data);
              console.log(JSON.stringify(response));
            } catch (e) {
              console.error("[mcp-bridge] Parse error:", e.message);
            }
          }
          eventType = null;
          data = "";
        }
      }
    };

    res.on("data", onResponseData);
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      mcpSessionId = null;
      console.error("[mcp-bridge] Response timeout");
      sendJsonRpcError(message.id || null, -32603, "Response timeout");
    });

    res.on("end", () => {
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const response = JSON.parse(data);
                console.log(JSON.stringify(response));
              } catch (e) {
                console.error("[mcp-bridge] Parse error:", e.message);
              }
            }
          }
        }
      }
    });
  });

  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    req.destroy();
    mcpSessionId = null;
    console.error("[mcp-bridge] Request timeout");
    if (!isRetry) {
      console.error("[mcp-bridge] Retrying...");
      doRequest(message, postData, true);
    } else {
      sendJsonRpcError(message.id || null, -32603, "Request timeout");
    }
  });

  req.on("error", (err) => {
    console.error("[mcp-bridge] HTTP error:", err.message);
    mcpSessionId = null;
    if (!isRetry) {
      console.error("[mcp-bridge] Retrying...");
      doRequest(message, postData, true);
    } else {
      sendJsonRpcError(message.id || null, -32603, `Connection error: ${err.message}`);
    }
  });

  req.write(postData);
  req.end();
}

// Ensure stdin is in the correct mode and prevent Node.js from executing it as a script
process.stdin.setEncoding('utf8');
process.stdin.resume();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (!line || !line.trim()) {
    return;
  }
  
  try {
    const message = JSON.parse(line);
    const postData = JSON.stringify(message);
    doRequest(message, postData, false);
  } catch (err) {
    // Send error response for JSON-RPC protocol compliance
    try {
      const parsed = JSON.parse(line);
      const errorResponse = {
        jsonrpc: "2.0",
        id: parsed.id || null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      };
      console.log(JSON.stringify(errorResponse));
    } catch (parseErr) {
      // If we can't even parse the line, log to stderr only
      console.error("[mcp-bridge] Input parse error:", err.message);
    }
  }
});

process.on("uncaughtException", (err) => {
  console.error("[mcp-bridge] Fatal:", err.message);
  process.exit(1);
});
