import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { MCP_INPUT_LIMITS, validateMcpRequestBody } from "./mcp-input-limits.mjs";

const require = createRequire(import.meta.url);
const { isLegacyRequest } = require("@modelcontextprotocol/server");
const { NodeStreamableHTTPServerTransport, toWebRequest } = require("@modelcontextprotocol/node");

async function readJsonBody(req) {
  if ((req.method ?? "GET").toUpperCase() !== "POST") return undefined;
  const chunks = [];
  let total = 0;
  // Preserve the socket on rejection so the caller receives a 413 response.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MCP_INPUT_LIMITS.maxRequestBodySize) {
      const error = new Error("MCP request body exceeds the 2 MiB transport limit");
      error.code = "MCP_HTTP_BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }
  if (total === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}

function jsonError(res, statusCode, message) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...(statusCode === 413 ? { connection: "close" } : {}),
  });
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  }));
}

export function createMcpHttpSessionRouter({ createServer, modernNodeHandler, onerror = () => {} } = {}) {
  if (typeof createServer !== "function") throw new TypeError("createServer is required");
  if (typeof modernNodeHandler !== "function") throw new TypeError("modernNodeHandler is required");

  const legacySessions = new Map();
  const pendingLegacyEntries = new Set();
  let closed = false;

  async function closeEntry(entry) {
    if (entry.transport) {
      try {
        await entry.transport.close();
      } catch (error) {
        onerror(error);
      }
    }
    try {
      await entry.server.close?.();
    } catch (error) {
      onerror(error);
    }
  }

  async function createLegacyEntry() {
    const entry = { server: null, transport: null };
    pendingLegacyEntries.add(entry);
    const transport = new NodeStreamableHTTPServerTransport({
      maxRequestBodySize: MCP_INPUT_LIMITS.maxRequestBodySize,
      sessionIdGenerator: randomUUID,
      keepAliveMs: 0,
      onsessioninitialized: (sessionId) => {
        pendingLegacyEntries.delete(entry);
        legacySessions.set(sessionId, entry);
      },
      onsessionclosed: (sessionId) => {
        legacySessions.delete(sessionId);
      },
    });
    try {
      const server = await createServer();
      entry.server = server;
      entry.transport = transport;
      await server.connect(transport);
      return entry;
    } catch (error) {
      pendingLegacyEntries.delete(entry);
      if (entry.transport || entry.server) await closeEntry(entry);
      throw error;
    }
  }

  async function handleLegacy(req, res, parsedBody) {
    const sessionId = typeof req.headers["mcp-session-id"] === "string"
      ? req.headers["mcp-session-id"]
      : Array.isArray(req.headers["mcp-session-id"])
        ? req.headers["mcp-session-id"][0]
        : null;

    let entry = sessionId ? legacySessions.get(sessionId) : null;
    if (sessionId && !entry) {
      jsonError(res, 404, "Unknown or expired MCP session");
      return;
    }

    if (!entry) {
      if (parsedBody?.method !== "initialize") {
        jsonError(res, 400, "MCP session id required after initialize");
        return;
      }
      entry = await createLegacyEntry();
    }

    try {
      await entry.transport.handleRequest(req, res, parsedBody);
    } finally {
      if (!entry.transport.sessionId) {
        pendingLegacyEntries.delete(entry);
        await closeEntry(entry);
      }
    }
  }

  async function handle(req, res) {
    if (closed) {
      jsonError(res, 503, "MCP transport is closing");
      return;
    }
    let parsedBody;
    try {
      parsedBody = await readJsonBody(req);
    } catch (error) {
      if (error?.code === "MCP_HTTP_BODY_TOO_LARGE") {
        req.resume();
        jsonError(res, 413, "MCP request body exceeds the 2 MiB transport limit");
        return;
      }
      if (error instanceof SyntaxError) {
        jsonError(res, 400, "Invalid MCP JSON request body");
        return;
      }
      throw error;
    }
    const inputError = validateMcpRequestBody(parsedBody);
    if (inputError) {
      jsonError(res, 400, inputError);
      return;
    }
    const webRequest = await toWebRequest(req, parsedBody, { maxRequestBodySize: MCP_INPUT_LIMITS.maxRequestBodySize });
    if (await isLegacyRequest(webRequest, parsedBody, { maxRequestBodySize: MCP_INPUT_LIMITS.maxRequestBodySize })) {
      await handleLegacy(req, res, parsedBody);
      return;
    }
    await modernNodeHandler(req, res, parsedBody);
  }

  async function close() {
    if (closed) return;
    closed = true;
    const entries = [...new Set([...legacySessions.values(), ...pendingLegacyEntries.values()])];
    legacySessions.clear();
    pendingLegacyEntries.clear();
    await Promise.all(entries.map((entry) => closeEntry(entry)));
  }

  return {
    handle,
    close,
    legacySessionCount: () => legacySessions.size,
    pendingLegacySessionCount: () => pendingLegacyEntries.size,
  };
}
