import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createLocalCommandJobs,createCommandSlots} from '../src/local-command-jobs.mjs';
import {localCommandConcurrencyFromEnv,localCommandJobsFromEnv} from '../src/local-command-settings.mjs';
import {createCodexToolboxServerFactory} from '../src/mcp-server-factory.mjs';
const {Client,InMemoryTransport}=createRequire(import.meta.url)('@modelcontextprotocol/client');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const result=(stdout,exitCode=0)=>({content:[{type:'text',text:stdout}],structuredContent:{exitCode,stdout,stderr:'diagnostic'},isError:exitCode!==0});

test('job/concurrency settings remain opt-in and reject invalid limits',()=>{
 assert.equal(localCommandJobsFromEnv({}),false);
 assert.equal(localCommandConcurrencyFromEnv({}),1);
 assert.equal(localCommandJobsFromEnv({CODEXLESS_COMMAND_JOBS:'1'}),true);
 assert.equal(localCommandConcurrencyFromEnv({CODEXLESS_COMMAND_MAX_CONCURRENT:'2'}),2);
 for(const value of ['0','5','2.0','Infinity'])assert.throws(()=>localCommandConcurrencyFromEnv({CODEXLESS_COMMAND_MAX_CONCURRENT:value}));
 assert.throws(()=>localCommandJobsFromEnv({CODEXLESS_COMMAND_JOBS:'true'}));
});

test('long jobs retain exact exit/output, poll without redispatch, and expire without replay',async()=>{
 let clock=0,calls=0;const gate=deferred();
 const jobs=createLocalCommandJobs({yieldMs:1,ttlMs:100,now:()=>clock});
 const pending=await jobs.start(async mark=>{calls++;mark();await gate.promise;return result('private output',17);},{cwd:'/authorized',access:'inherit'});
 const ref=pending.structuredContent.jobRef;
 assert.equal(pending.structuredContent.status,'running');
 assert.equal(JSON.stringify(pending).includes('private output'),false);
 assert.equal(jobs.poll(ref).structuredContent.status,'running');
 clock=25;gate.resolve();await new Promise(r=>setImmediate(r));
 const finished=jobs.poll(ref);
 assert.equal(finished.structuredContent.exitCode,17);
 assert.equal(finished.structuredContent.stdout,'private output');
 assert.equal(finished.structuredContent.stderr,'diagnostic');
 assert.equal(finished.structuredContent.elapsedMs,25);
 assert.equal(finished.isError,true);
 assert.deepEqual(jobs.poll(ref),finished);assert.equal(calls,1);
 clock=200;assert.equal(jobs.poll(ref).structuredContent.status,'unknown');assert.equal(calls,1);
});

test('job capacity rejects before dispatch and fast commands preserve the existing result shape',async()=>{
 const gate=deferred();const jobs=createLocalCommandJobs({yieldMs:1,maxJobs:1});let calls=0;
 await jobs.start(async()=>{await gate.promise;return result('done');});
 assert.equal((await jobs.start(async()=>{calls++;return result('no');})).isError,true);
 assert.equal(calls,0);gate.resolve();
 const fresh=createLocalCommandJobs();assert.deepEqual(await fresh.start(async()=>result('fast')),result('fast'));
});

test('two command slots preserve FIFO, bounded queue waits and release after completion',async()=>{
 const slots=createCommandSlots({maxConcurrent:2,maxQueued:1,queueWaitMs:10});
 await slots.acquire();await slots.acquire();
 const queued=slots.acquire();await assert.rejects(slots.acquire(),/queue is full/);
 slots.release();await queued;
 const timedOut=slots.acquire();await assert.rejects(timedOut,/not dispatched/);
 slots.release();slots.release();await slots.acquire();slots.release();
});

test('job status survives an MCP client reconnect while another command can execute',async()=>{
 const gate=deferred();let calls=0;
 const factory=createCodexToolboxServerFactory({maxConcurrent:2,commandJobs:{yieldMs:2},
   guardDirectFormalCodex:true,publicPreview:true,
   executor:{exec:async({command})=>{calls++;if(command[0]==='slow')await gate.promise;return {exitCode:0,stdout:command[0],stderr:''};}}});
 async function connect(){const s=factory(),c=new Client({name:'job-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await Promise.all([s.connect(a),c.connect(b)]);return{s,c};}
 const a=await connect(),b=await connect();
 try {
  const pending=await a.c.callTool({name:'codex.command_exec',arguments:{command:['slow']}});
  const ref=pending.structuredContent.jobRef;
  await a.c.close();await a.s.close();
  const fast=await b.c.callTool({name:'codex.command_exec',arguments:{command:['git-status']}});
  assert.equal(fast.structuredContent.stdout,'git-status');
  const status=await b.c.callTool({name:'codex.command_status',arguments:{jobRef:ref}});
  assert.equal(status.structuredContent.status,'running');
  const blocked=await b.c.callTool({name:'codex.command_exec',arguments:{command:['rtk','proxy','codex','exec','task']}});
  assert.equal(blocked.isError,true);assert.equal(calls,2);
  gate.resolve();await new Promise(r=>setImmediate(r));
  const done=await b.c.callTool({name:'codex.command_status',arguments:{jobRef:ref}});
  assert.equal(done.structuredContent.exitCode,0);assert.equal(done.structuredContent.stdout,'slow');
  assert.equal(calls,2);
 }finally{gate.resolve();await b.c.close();await b.s.close();}
});
