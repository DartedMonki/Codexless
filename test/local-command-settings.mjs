import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localCommandTimeoutFromEnv, localMcpGuidanceFromEnv } from '../src/local-command-settings.mjs';
import { createCodexToolboxServerFactory } from '../src/mcp-server-factory.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');

test('long command timeouts are opt-in and bounded locally', () => {
  assert.equal(localCommandTimeoutFromEnv({}), 30000);
  assert.equal(localCommandTimeoutFromEnv({CODEXLESS_COMMAND_MAX_TIMEOUT_MS:'600000'}), 600000);
  for (const value of ['0','29999','600001','Infinity','30_000',' 600000','1e5']) {
    assert.throws(() => localCommandTimeoutFromEnv({CODEXLESS_COMMAND_MAX_TIMEOUT_MS:value}));
  }
});

test('local MCP guidance is opt-in and rejects multiline or oversized content', () => {
  assert.equal(localMcpGuidanceFromEnv({}), '');
  assert.equal(localMcpGuidanceFromEnv({CODEXLESS_LOCAL_MCP_GUIDANCE:'  Use the local project cwd.  '}), 'Use the local project cwd.');
  for (const value of ['line one\nline two', 'x'.repeat(2049), 'bad\u0000value']) {
    assert.throws(() => localMcpGuidanceFromEnv({CODEXLESS_LOCAL_MCP_GUIDANCE:value}));
  }
});

test('configured tool schema and execution accept a long timeout and reject above the cap', async () => {
  const calls = [];
  const createServer = createCodexToolboxServerFactory({
    executor:{async exec(args) {calls.push(args);return {exitCode:0,stdout:'done',stderr:''};}},
    maxTimeoutMs:600000, accessModes:['readOnly','inherit'],defaultAccess:'readOnly',
  });
  const server=createServer();
  const client=new Client({name:'timeout-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const listing=await client.listTools();
    assert.equal(listing.tools[0].inputSchema.properties.timeoutMs.maximum,600000);
    const ok=await client.callTool({name:'codex.command_exec',arguments:{command:['check'],timeoutMs:180000}});
    assert.equal(ok.isError,false);
    assert.equal(calls[0].timeoutMs,180000);
    const bad=await client.callTool({name:'codex.command_exec',arguments:{command:['check'],timeoutMs:600001}});
    assert.equal(bad.isError,true);
    assert.equal(calls.length,1);
  } finally {await client.close();await server.close();}
});
