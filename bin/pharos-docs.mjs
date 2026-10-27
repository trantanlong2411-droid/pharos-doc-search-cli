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
      u = u.replace(/[.,;:]+$/, '').split(String.fromCharCode(96))[0];
      try { const parsedUrl = new URL(u); if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') matches.add(parsedUrl.toString()); } catch {}
    }
  } else if (Array.isArray(value)) value.forEach(x => findUrls(x, matches, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach(x => findUrls(x, matches, depth + 1));
  return matches;
}

/*
 * Conservative relevance check. A Docs MCP response can include valid documentation
 * links while answering a DIFFERENT question (observed for "Quantum Banana X999").
 * URLs alone do not prove relevance. Keep the check independent of any specific
 * test phrase, and prefer a polite refusal over showing unrelated documentation.
 */
const STOP = new Set(('a an and are as at be by can could do does for from guide guides how i in information is it me my of official on or our please question regarding search show some tell the there these this to using what where which who why with would you your pharos docs documentation document developer developers find found help link links source sources about').split(' '));
const RELATED = {
  deploy: ['deploy','deployment','deploying','dapp','hardhat'],
  contract: ['contract','contracts','solidity','dapp'],
  rpc: ['rpc','endpoint','node'],
  testnet: ['testnet','testing'],
  wallet: ['wallet','metamask']
};
function stem(term) {
  if (term.endsWith('ments') && term.length > 7) return term.slice(0,-5);
  if (term.endsWith('ment') && term.length > 6) return term.slice(0,-4);
  if (term.endsWith('ing') && term.length > 6) return term.slice(0,-3);
  if (term.endsWith('ed') && term.length > 5) return term.slice(0,-2);
  if (term.endsWith('s') && term.length > 4) return term.slice(0,-1);
  return term;
}
function terms(s) {
  return (String(s).toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => w.length >= 3 && !STOP.has(w)).map(stem);
}
function relevantToQuestion(q, answer, sources) {
  // Include the actually cited documentation paths, but never treat any random URL
  // or the fact that "Pharos" appears as evidence of a relevant answer.
  const qTerms = [...new Set(terms(q))];
  if (!qTerms.length) return false; // insufficient context: do not make a claim
  const paths = sources.map(u => { try { return decodeURIComponent(new URL(u).pathname).replace(/[-_/]/g, ' '); } catch { return ''; } }).join(' ');
  const evidence = new Set(terms(answer + ' ' + paths));
  const matched = qTerms.filter(w => evidence.has(w) || (RELATED[w] || []).some(x => evidence.has(stem(x)))).length;
  return matched >= (qTerms.length >= 3 ? 2 : 1);
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
  const sources = Array.from(findUrls(result)).filter(u => { try { return new URL(u).hostname === 'docs.pharos.xyz'; } catch { return false; } }).slice(0, 8);
  if (!answer || answer === '[]' || /^(sorry|not found|no relevant|no documentation|nothing found|i (?:cannot|can't|could not|couldn't|was unable to) (?:find|locate)|there (?:is no|are no))/i.test(answer)) {
    return { ok: false, answer: '', sources: [], reason: 'No relevant documentation found.', notFound: true };
  }
  if (!sources.length) return { ok: false, answer: '', sources: [], reason: 'No verifiable documentation URL in the MCP response.' };
  if (!relevantToQuestion(question, answer, sources))
    return { ok: false, answer: '', sources: [], reason: 'The MCP response contains documentation links, but no sufficiently relevant answer to your question.', notFound: true };
  // Avoid presenting a long list of off-topic references when more specific ones exist.
  const topic = new Set(terms(question));
  const matchingSources = sources.filter(u => {
    try { return terms(decodeURIComponent(new URL(u).pathname).replace(/[-_/]/g, ' ')).some(w => topic.has(w)); }
    catch { return false; }
  });
  const citedSources = matchingSources.length ? matchingSources : sources;
  return { ok: true, answer: answer.length > 1200 ? answer.slice(0, 1200) + '…' : answer, sources: citedSources, reason: null };
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
  if (!response.ok && !response.notFound && ask && search && selected.name === 'askQuestion') {
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