import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/pharos-docs.mjs');
async function server(mode = 'answer') {
  const s = http.createServer(async (req,res) => {
    let payload = '';
    for await (const part of req) payload += part;
    const x = JSON.parse(payload);
    res.setHeader('content-type','application/json');
    if (x.id === undefined) { res.writeHead(202).end(); return; }
    let output;
    if (x.method === 'initialize') output = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'local-test', version: '1' } };
    else if (x.method === 'tools/list') output = { tools: [{ name:'askQuestion', inputSchema: { type:'object', required:['question'], properties: { question: { type: 'string' } } } }] };
    else if (x.method === 'tools/call') {
      const answer = mode === 'empty' ? 'No relevant documentation found.' : mode === 'uncited' ? 'A guide exists' : mode === 'negative' ? 'I cannot find an official guide for Quantum Banana X999. See https://docs.pharos.xyz/node-and-validator-guide/validator-requirements' : 'Use https://docs.pharos.xyz/developer-guide/hardhat/write-your-first-dapp';
      output = { content: [{ type: 'text', text: answer }] };
    } else { res.writeHead(404).end(); return; }
    res.end(JSON.stringify({ jsonrpc:'2.0', id:x.id, result: output }));
  });
  s.listen(0,'127.0.0.1');
  await once(s,'listening');
  return { url: 'http://127.0.0.1:' + s.address().port + '/mcp', close:()=>new Promise(r=>s.close(r)) };
}
async function run(flags) {
  const p = spawn(process.execPath,[cli,...flags],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  p.stdout.on('data',d=>stdout+=d);
  p.stderr.on('data',d=>stderr+=d);
  const [code]=await once(p,'close');
  return {code,stdout,stderr};
}
test('help returns usage',async()=>{
  const r=await run(['--help']);
  assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/Usage:/);
});
test('tools/list returns discovered MCP tools',async()=>{
  const m=await server();
  try { const r=await run(['--endpoint',m.url,'--tools']); assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/askQuestion/); }
  finally {await m.close();}
});
test('natural language query includes MCP source URL',async()=>{
  const m=await server();
  try { const r=await run(['--endpoint',m.url,'--json','How to deploy?']); assert.equal(r.code,0,r.stderr); const d=JSON.parse(r.stdout); assert.equal(d.ok,true); assert.equal(d.sources.length,1); }
  finally {await m.close();}
});
test('unknown topic does not invent an answer',async()=>{
  const m=await server('empty');
  try { const r=await run(['--endpoint',m.url,'Unknown banana feature']); assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/No good answer found/); }
  finally {await m.close();}
});
test('uncited answer gets withheld',async()=>{
  const m=await server('uncited');
  try { const r=await run(['--endpoint',m.url,'How to connect?']); assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/No verifiable documentation URL/); }
  finally {await m.close();}
});
test('unreachable MCP endpoint reports a useful error',async()=>{
  const r=await run(['--endpoint','http://127.0.0.1:1/mcp','--timeout','1500','Q']);
  assert.notEqual(r.code,0); assert.match(r.stderr,/Pharos Docs CLI error/i);
});
test('negative MCP response with unrelated links is still not found',async()=>{
  const m=await server('negative');
  try { const r=await run(['--endpoint',m.url,'Quantum Banana X999']); assert.equal(r.code,0,r.stderr); assert.match(r.stdout,/No good answer found/); assert.doesNotMatch(r.stdout,/Sources \(returned by MCP\)/); }
  finally {await m.close();}
});
