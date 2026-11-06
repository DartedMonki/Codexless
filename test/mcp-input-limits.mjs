import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MCP_INPUT_LIMITS, validateMcpRequestBody } from "../src/mcp-input-limits.mjs";
import { createMcpHttpSessionRouter } from "../src/mcp-http-session-router.mjs";
import { createCodexToolboxServerFactory } from "../src/mcp-server-factory.mjs";
import { localCallDiagnosticsFromEnv, installLocalHttpDiagnostics } from "../src/recent-call-diagnostics.mjs";

const require = createRequire(import.meta.url);
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");
const { createMcpHandler } = require("@modelcontextprotocol/server");
const { toNodeHandler } = require("@modelcontextprotocol/node");
const z = require("zod/v4");

test("request budgets accept boundaries and reject excessive batches, elements, and depth", () => {
  assert.equal(validateMcpRequestBody(Array(100).fill(null)), null);
  assert.match(validateMcpRequestBody(Array(101).fill(null)), /batch/);
  assert.equal(validateMcpRequestBody({ items: Array(MCP_INPUT_LIMITS.maxRequestElements - 1).fill(0) }), null);
  assert.match(validateMcpRequestBody({ items: Array(MCP_INPUT_LIMITS.maxRequestElements).fill(0) }), /element/);
  let nested = {};
  for (let depth = 0; depth < MCP_INPUT_LIMITS.maxJsonDepth; depth++) nested = { child: nested };
  assert.equal(validateMcpRequestBody(nested), null);
  assert.match(validateMcpRequestBody({ child: nested }), /nesting/);
});

async function fixture(t, { diagnostics = null } = {}) {
  let dispatched = 0;
  const executor = { exec: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }) };
  const factory = createCodexToolboxServerFactory({ executor, localCallDiagnostics: diagnostics });
  const createServer = () => {
    const server = factory();
    server.registerTool("test.collection", {
      inputSchema: z.object({ items: z.array(z.unknown()), marker: z.string() }),
    }, async ({ items, marker }) => {
      dispatched++;
      return { content: [{ type: "text", text: marker }], structuredContent: { marker, count: items.length } };
    });
    server.registerTool("test.failure", { inputSchema: z.object({ payload: z.string() }) }, async ({ payload }) => {
      throw new Error(payload);
    });
    return server;
  };
  const handler = createMcpHandler(createServer, {
    maxRequestBodySize: MCP_INPUT_LIMITS.maxRequestBodySize,
    keepAliveMs: 0,
  });
  const router = createMcpHttpSessionRouter({
    createServer,
    modernNodeHandler: toNodeHandler(handler, { maxRequestBodySize: MCP_INPUT_LIMITS.maxRequestBodySize }),
  });
  const server = http.createServer((req, res) => {
    router.handle(req, res).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  t.after(async () => {
    await router.close();
    await handler.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url, dispatched: () => dispatched };
}

async function connect(t, url, mode) {
  const client = new Client({ name: `input-limits-${mode}`, version: "1.0.0" });
  if (mode === "modern") client.setVersionNegotiation({ mode: "auto" });
  const transport = new StreamableHTTPClientTransport(url);
  t.after(async () => {
    await transport.terminateSession().catch(() => {});
    await client.close();
  });
  await client.connect(transport);
  return client;
}

for (const mode of ["legacy", "modern"]) {
  test(`production factory / ${mode}: rejects excessive tool inputs before dispatch and isolates clients`, async (t) => {
    const app = await fixture(t);
    const first = await connect(t, app.url, mode);
    const second = await connect(t, app.url, mode);
    const oversized = await first.callTool({
      name: "test.collection",
      arguments: { items: Array(MCP_INPUT_LIMITS.maxToolInputElements).fill(null), marker: "oversized" },
    });
    assert.equal(oversized.isError, true);
    assert.match(JSON.stringify(oversized.content), /maximum.*50000.*elements/);
    assert.equal(app.dispatched(), 0, "oversized input must never reach the tool");

    const results = await Promise.all([
      first.callTool({ name: "test.collection", arguments: { items: Array.from({ length: 5000 }, () => ({ cell: "A1", value: 1 })), marker: "first" } }),
      second.callTool({ name: "test.collection", arguments: { items: [], marker: "second" } }),
    ]);
    assert.equal(results[0].structuredContent.marker, "first");
    assert.equal(results[0].structuredContent.count, 5000, "ordinary 5000-cell collections must remain usable");
    assert.equal(results[1].structuredContent.marker, "second");
    assert.equal(app.dispatched(), 2);
  });
}

test("HTTP rejects bad JSON, oversized bodies, batches, deep inputs and collection floods, then remains usable", async (t) => {
  const app = await fixture(t);
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const call = (args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test.collection", arguments: args } });
  let nested = {};
  for (let i = 0; i < 70; i++) nested = { child: nested };
  for (const [body, status, message] of [
    ["{invalid", 400, /Invalid MCP JSON/],
    [JSON.stringify(Array(101).fill({ jsonrpc: "2.0", id: 1, method: "ping" })), 400, /batch/],
    [JSON.stringify(call({ items: [nested], marker: "deep" })), 400, /nesting/],
    [JSON.stringify(call({ items: Array(MCP_INPUT_LIMITS.maxRequestElements).fill(0), marker: "many" })), 400, /element/],
    [JSON.stringify("x".repeat(MCP_INPUT_LIMITS.maxRequestBodySize)), 413, /2 MiB/],
  ]) {
    const response = await fetch(app.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, status);
    assert.match(await response.text(), message);
  }
  const chunked = Readable.toWeb(Readable.from([
    Buffer.alloc(MCP_INPUT_LIMITS.maxRequestBodySize, 32), Buffer.from("{}"),
  ]));
  const response = await fetch(app.url, {
    method: "POST", headers, body: chunked, duplex: "half", signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 413, "chunked uploads must obey the same byte limit");
  await response.text();
  assert.equal(app.dispatched(), 0);
  const client = await connect(t, app.url, "legacy");
  const result = await client.callTool({ name: "test.collection", arguments: { items: [], marker: "healthy" } });
  assert.equal(result.structuredContent.marker, "healthy");
});

test("local tool diagnostics are opt-in, preserve results and never persist arguments or error messages", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexless-local-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "receipts.json");
  assert.equal(localCallDiagnosticsFromEnv({ CODEXLESS_RECENT_CALLS_STATE_FILE: stateFile }), null);
  assert.equal(localCallDiagnosticsFromEnv({ CODEXLESS_LOCAL_DIAGNOSTICS: "0" }), null);
  assert.throws(() => localCallDiagnosticsFromEnv({ CODEXLESS_LOCAL_DIAGNOSTICS: "invalid" }), /must be 0 or 1/);
  const diagnostics = localCallDiagnosticsFromEnv({
    CODEXLESS_LOCAL_DIAGNOSTICS: "1", CODEXLESS_RECENT_CALLS_STATE_FILE: stateFile,
  });
  const app = await fixture(t, { diagnostics });
  const client = await connect(t, app.url, "legacy");
  const secret = "PRIVATE_PAYLOAD_do_not_log_sk-example123456789";
  const result = await client.callTool({ name: "test.collection", arguments: { items: [secret], marker: secret } });
  assert.equal(result.structuredContent.marker, secret, "diagnostics must not modify the business result");
  const failed = await client.callTool({ name: "test.failure", arguments: { payload: secret } });
  assert.equal(failed.isError, true);
  const receipts = diagnostics.query().receipts;
  assert.equal(receipts.find(r => r.tool_name === "test.collection").result_class, "success");
  assert.equal(receipts.find(r => r.tool_name === "test.failure").status, "handler_error");
  assert.equal(receipts.find(r => r.tool_name === "test.failure").error_class, "Error");
  const disk = await readFile(stateFile, "utf8");
  assert.equal(disk.includes(secret), false);
  assert.equal(disk.includes("payload"), false);
});

test("HTTP diagnostics record failures and aborted requests without URLs, credentials, bodies or duplicate events", () => {
  const events = [];
  const response = () => {
    const res = new EventEmitter();
    res.statusCode = 400;
    res.headers = {};
    res.setHeader = (name, value) => { res.headers[name] = value; };
    return res;
  };
  const req = { method: "POST", url: "/private-secret?token=PRIVATE_SECRET", body: "PRIVATE_BODY" };
  const disabled = response();
  installLocalHttpDiagnostics(req, disabled, { emit: event => events.push(event) });
  disabled.emit("finish");
  assert.equal(events.length, 0);
  const res = response();
  installLocalHttpDiagnostics(req, res, { enabled: true, emit: event => events.push(event) });
  res.emit("finish");
  res.emit("close");
  assert.equal(events.length, 1);
  assert.equal(events[0].route, "other");
  assert.equal(events[0].status, 400);
  assert.ok(res.headers["x-codexless-request-id"]);
  assert.doesNotMatch(JSON.stringify(events), /private-secret|PRIVATE_SECRET|PRIVATE_BODY|token=/);
  const aborted = response();
  installLocalHttpDiagnostics({ method: "POST", url: "/mcp" }, aborted, { enabled: true, emit: event => events.push(event) });
  aborted.emit("close");
  assert.equal(events[1].event, "http_aborted");
  const healthy = response();
  healthy.statusCode = 200;
  installLocalHttpDiagnostics({ method: "GET", url: "/healthz" }, healthy, { enabled: true, emit: event => events.push(event) });
  healthy.emit("finish");
  assert.equal(events.length, 2, "routine health polling should not flood the logs");
});
