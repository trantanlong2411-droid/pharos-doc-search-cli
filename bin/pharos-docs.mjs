#!/usr/bin/env node
// Pharos Developer Docs MCP CLI. Read-only: uses askQuestion/searchDocumentation.
const endpointDefault = 'https://docs.pharos.xyz/~gitbook/mcp';
const args = process.argv.slice(2);
let endpoint = process.env.PHAROS_DOCS_MCP_URL || endpointDefault;
let showTools = false, json = false, help = false, timeout = 20000;
const words = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--tools') showTools = true;
  else if (a === '--json') json = true;
  else if (a === '--help' || a === '-h') help = true;
  else if (a === '--endpoint') { if (!args[++i]) throw new Error('Missing --endpoint value'); endpoint = args[i]; }
  else if (a === '--timeout') { if (!args[++i]) throw new Error('Missing --timeout value'); timeout = Number(args[i]); }
  else if (a.startsWith('--')) throw new Error('Unknown option ' + a);
  else words.push(a);
}
const question = words.join(' ').trim();
if (help) {
  console.log('Pharos Docs Search CLI\n\nUsage:\n  node bin/pharos-docs.mjs --tools\n  node bin/pharos-docs.mjs "How do I deploy on Pharos?"\n  node bin/pharos-docs.mjs --json "What is Atlantic Testnet?"\n\nOptions: --tools, --json, --endpoint URL, --timeout milliseconds, --help');
  process.exit(0);
}
if (!question && !showTools) { console.error('Please supply a question or --tools.'); process.exit(2); }
if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) { console.error('Invalid timeout'); process.exit(2); }
const parsed = new URL(endpoint);
if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)))) {
  console.error('Remote MCP endpoint must use HTTPS.'); process.exit(2);
}
let seq = 0, session = null, protocol = '2025-03-26';
async function mcp(method, params = {}, notification = false) {
  const payload = { jsonrpc: '2.0', method, ...(notification ? {} : { id: ++seq }), ...(notification ? {} : { params }) };
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
    'mcp-protocol-version': protocol
  };
  if (session) headers['mcp-session-id'] = session;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new Error('MCP HTTP ' + response.status + (response.status === 404 ? ': endpoint not found' : ''));
    if (response.headers.get('mcp-session-id')) session = response.headers.get('mcp-session-id');
    if (notification) return null;
    const body = await response.text();
    if (body.length > 2000000) throw new Error('MCP response too large');
    let data = null;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      for (const event of body.replace(/\r\n/g, '\n').split(/\n\n+/)) {
        const text = event.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n');
        if (!text || text === '[DONE]') continue;
        try { const candidate = JSON.parse(text); if (candidate.id === payload.id) { data = candidate; break; } }
        catch { /* ignore progress events */ }
      }
    } else data = JSON.parse(body);
    if (!data) throw new Error('MCP returned no matching response');
    if (data.error) throw new Error(data.error.message || 'Remote MCP error');
    if (!data.result) throw new Error('MCP response has no result');
    return data.result;
  } finally { clearTimeout(timer); }
}
function findUrls(value, matches = new Set(), depth = 0) {
  if (depth > 7 || value == null) return matches;
  if (typeof value === 'string') {
    const urls = value.match(/https?:\/\/[^\s<>"'\])}]+/g) || [];
    for (let u of urls) {
      u = u.replace(/[.,;:]+$/, '');
      try { const parsedUrl = new URL(u); if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') matches.add(parsedUrl.toString()); } catch {}
    }
  } else if (Array.isArray(value)) value.forEach(x => findUrls(x, matches, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach(x => findUrls(x, matches, depth + 1));
  return matches;
}
function outputFrom(result) {
  if (result.isError) return { ok: false, answer: '', sources: [], reason: 'Documentation MCP returned an error.' };
  let sections = [];
  if (result.structuredContent) {
    const x = result.structuredContent;
    sections.push(typeof x === 'string' ? x : x.answer || x.response || x.summary || x.text || JSON.stringify(x));
  }
  for (const item of result.content || []) {
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    try { const x = JSON.parse(item.text); sections.push(typeof x === 'string' ? x : x.answer || x.response || x.text || JSON.stringify(x)); }
    catch { sections.push(item.text); }
  }
  const answer = sections.join('\n\n').trim();
  const sources = Array.from(findUrls(result)).slice(0, 8);
  if (!answer || answer === '[]' || /^(sorry|not found|no relevant|no documentation|nothing found)/i.test(answer)) {
    return { ok: false, answer: '', sources: [], reason: 'No relevant documentation found.' };
  }
  if (!sources.length) return { ok: false, answer: '', sources: [], reason: 'No verifiable documentation URL in the MCP response.' };
  return { ok: true, answer: answer.length > 1200 ? answer.slice(0, 1200) + '…' : answer, sources, reason: null };
}
function toolArgs(tool) {
  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  const chosen = ['question', 'query', 'searchQuery', 'search_query', 'input', 'text', 'prompt'].find(x => props[x]?.type === 'string');
  if (!chosen) throw new Error('Unknown input schema for ' + tool.name);
  const p = { [chosen]: question };
  for (const key of required) {
    if (key in p) continue;
    if (key === 'goal' || key === 'context') p[key] = 'Find official documentation and cite source URLs';
    else if (props[key]?.type === 'string') p[key] = question;
    else throw new Error('Unsupported required parameter ' + key);
  }
  if (props.goal?.type === 'string' && !p.goal) p.goal = 'Answer concisely with source URLs';
  return p;
}
try {
  const initialized = await mcp('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'pharos-doc-search-cli', version: '1.0.0' } });
  if (initialized.protocolVersion) protocol = initialized.protocolVersion;
  await mcp('notifications/initialized', {}, true);
  const discovered = (await mcp('tools/list')).tools || [];
  if (showTools) {
    if (json) console.log(JSON.stringify(discovered.map(x => ({ name: x.name, description: x.description })), null, 2));
    else { console.log('Developer Docs MCP tools:'); discovered.forEach(x => console.log('- ' + x.name + ': ' + (x.description || ''))); }
    process.exit(0);
  }
  const ask = discovered.find(x => x.name === 'askQuestion');
  const search = discovered.find(x => x.name === 'searchDocumentation');
  if (!ask && !search) throw new Error('No read-only Q&A/search tool found on the Docs MCP server');
  let selected = ask || search;
  let response = outputFrom(await mcp('tools/call', { name: selected.name, arguments: toolArgs(selected) }));
  if (!response.ok && ask && search && selected.name === 'askQuestion') {
    selected = search;
    response = outputFrom(await mcp('tools/call', { name: selected.name, arguments: toolArgs(selected) }));
  }
  const result = { question, tool: selected.name, ...response };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Question: ' + question + '\nTool: ' + selected.name);
    if (response.ok) {
      console.log('\nAnswer (Docs MCP excerpt):\n' + response.answer + '\n\nSources (returned by MCP):');
      response.sources.forEach((u, i) => console.log('  ' + (i + 1) + '. ' + u));
    } else console.log('\nNo good answer found: ' + response.reason);
  }
} catch (err) {
  console.error('Pharos Docs CLI error: ' + (err.name === 'AbortError' ? 'request timed out' : err.message));
  process.exitCode = 1;
}