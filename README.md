# Pharos Docs Search CLI

> **Pharos Agent Arena · Easy · Developer Docs MCP · DOC-SEARCH CLI (50 points)**
>
> A dependency-free Node.js terminal app that asks the **official Pharos Developer Docs MCP** a natural-language question and prints an answer excerpt **with the actual source URLs returned by MCP**. It does not use web search, a generic LLM, an API key, or fabricated documentation answers.

## Features / task requirements

| Requirement | Implementation |
|---|---|
| Natural-language question | `node bin/pharos-docs.mjs "How do I deploy a contract?"` |
| Concise sourced answer | Truncated MCP text excerpt, tool name, actual URLs extracted from returned MCP data |
| Handles unknown questions | Explicit `No good answer found` if tool output is empty, says not found, is an error or has no verifiable URL |
| README, installation, 3 queries, outputs | This README and `examples/expected-test-cases.md` |

This tool **never invents citations**: when the MCP response doesn't contain a URL, it refuses to treat the text as verified. The CLI prefers `askQuestion` and will try `searchDocumentation` if needed and actually exposed by the server. `sendFeedback` is a write operation and is **never invoked**.

## 1. Installation (Windows 10/11 PowerShell)

**Prerequisite:** Node.js >= 20. (Node.js 24 installed on the original testing Windows laptop also qualifies.)

1. Download this repository ZIP from GitHub, then unzip it, or use `git clone`.
2. Open PowerShell in the extracted project directory.
3. Verify Node.js:

```powershell
node -v
```

4. No `npm install` is required (there are **zero external dependencies**). Run:

```powershell
node .\bin\pharos-docs.mjs --help
node .\bin\pharos-docs.mjs --tools
node .\bin\pharos-docs.mjs "How do I deploy a contract on Pharos?"
```

To install a command that works inside the cloned project, you can run `npm link` (optional) and then use `pharos-docs "question"`. If Windows PowerShell blocks `npm.ps1`, use `npm.cmd link` instead. You can always use `node .\bin\pharos-docs.mjs` without changing PowerShell security settings.

## 2. Usage

```powershell
node .\bin\pharos-docs.mjs --tools
node .\bin\pharos-docs.mjs "How do I deploy a contract on Pharos?"
node .\bin\pharos-docs.mjs "What is Pharos Atlantic Testnet?"
node .\bin\pharos-docs.mjs "Where is the official guide for a nonexistent feature called Quantum Banana X999?"
node .\bin\pharos-docs.mjs --json "How do I deploy a contract?"
```

The server endpoint defaults to **`https://docs.pharos.xyz/~gitbook/mcp`**, as exposed in the AI.PHAROS Developer Docs MCP session. Override via `PHAROS_DOCS_MCP_URL` or `--endpoint`, for example when connecting to a local test server.

## 3. Three example questions and expected outputs

These are **expected patterns**, not fabricated claims of live Pharos responses. To record real outputs for the reviewer, execute the commands on a machine that can reach Docs MCP; the returned text, tools and URLs can change with the documentation server.

### Example A — Deploy a contract

**Command:**
```powershell
node .\bin\pharos-docs.mjs "How do I deploy a contract on Pharos?"
```

**Expected terminal output shape when docs are found:**
```text
Question: How do I deploy a contract on Pharos?
Tool: askQuestion

Answer (Docs MCP excerpt):
[Exact excerpt from the live MCP result; content varies]

Sources (returned by MCP):
  1. [Actual documentation URL from the live MCP result]
```

A relevant known documentation page is [Write Your First dApp](https://docs.pharos.xyz/developer-guide/hardhat/write-your-first-dapp); **the CLI will show this URL only if the MCP actually returns it**.

### Example B — Testnet

**Command:**
```powershell
node .\bin\pharos-docs.mjs "What is Pharos Atlantic Testnet?"
```

**Expected output shape:**
```text
Question: What is Pharos Atlantic Testnet?
Tool: askQuestion

Answer (Docs MCP excerpt):
[Exact excerpt from the live MCP result; content varies]

Sources (returned by MCP):
  1. [Actual MCP source URL]
```

A relevant existing page is [Atlantic Testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet), not hard-coded into the program as an answer.

### Example C — Unknown feature / no answer

**Command:**
```powershell
node .\bin\pharos-docs.mjs "Where is the official guide for a nonexistent feature called Quantum Banana X999?"
```

**Expected output if Docs MCP has no sourced answer:**
```text
Question: Where is the official guide for a nonexistent feature called Quantum Banana X999?
Tool: searchDocumentation

No good answer found. No relevant answer was found in the returned documentation.
```

The CLI may display a different explicit refusal reason, or a sourced answer, depending on the server's actual output. **No claim of finding or not finding this content is made without a real MCP response.**

## 4. Proof of function / testing

Run:

```powershell
npm.cmd test
npm.cmd run check
```

The automated test suite uses a **local fake MCP server** and checks:

1. Real MCP-shaped initialization and `tools/list` handling.
2. Successful `tools/call` with a genuine URL coming from the **mock tool result**.
3. JSON and Streamable HTTP SSE response parsing.
4. Missing answer -> explicit refusal.
5. Uncited text -> explicit refusal, not a fabricated link.
6. HTTP failures -> diagnostic error.
7. Runtime validation of tool names and argument schemas.

These tests are *not* a live Developer Docs MCP test. **To meet the Agent Arena evidence requirement**, also run `--tools`, the 3 example questions above, and capture terminal output while connected to the real endpoint. A repository link or static HTML alone does not prove the remote endpoint was reached.

## 5. How it works

```text
Terminal input
    |
    v
MCP Streamable HTTP initialize --> notifications/initialized
    |
    v
tools/list (discover real server tool names and input schema)
    |
    v
askQuestion or searchDocumentation (read-only)
    |
    v
Return MCP answer and *only* URLs found in the MCP response
    |
    +--> sourced text -> print concise excerpt + source URLs
    +--> no answer / missing citations / tool error -> explain, never invent
```

The implementation uses Node.js built-ins (`fetch`, `node:url`) and the MCP Streamable HTTP protocol. It supports JSON responses, SSE event frames, `Mcp-Session-Id`, `MCP-Protocol-Version`, timeouts and MCP JSON-RPC errors. For maximum interoperability, the official MCP SDK is recommended for production and for more complex server behaviors; this project is intentionally small and zero-dependency for easy task evaluation.

## 6. Limitations / reviewer notes

- **Live Pharos MCP connectivity was not tested in the artifact-generation environment** because DNS/network access to `docs.pharos.xyz` is unavailable there. The local tests passed against a mock MCP endpoint. A live Windows verification is still required before claiming full completion.
- Developer Docs MCP may be intermittently inaccessible (previous AI.PHAROS sessions demonstrated both no tools and four tools). Error messages are surfaced instead of masked.
- If the server returns a hallucinated link, this simple client cannot independently verify a webpage's contents. It guarantees only that the displayed source was returned by MCP, never invented by the CLI.
- No secrets or private keys are needed. No blockchain transactions or feedback submissions are sent.
- This is a CLI, not a continuously hosted API or website. To verify it, run the documented commands locally.

## Sources

- [Pharos Developer Docs](https://docs.pharos.xyz/)
- [Pharos MCP documentation](https://docs.pharos.xyz/tooling-and-infrastructure/mcp) (Chain MCP, **different from Docs MCP**)
- [Model Context Protocol transport specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)

## License

MIT — see `LICENSE`.

## 7. Capture *live* evidence for your Agent Arena submission (Windows)

After a successful live connection, run these in PowerShell **inside the extracted CLI project**. Keep the original terminal screenshot as independent proof.

```powershell
New-Item -ItemType Directory -Force .\proof | Out-Null
node .\bin\pharos-docs.mjs --tools 2>&1 | Tee-Object .\proof\tools-live.txt
node .\bin\pharos-docs.mjs "How do I deploy a contract on Pharos?" 2>&1 | Tee-Object .\proof\example-1-live.txt
node .\bin\pharos-docs.mjs "What is Pharos Atlantic Testnet?" 2>&1 | Tee-Object .\proof\example-2-live.txt
node .\bin\pharos-docs.mjs "Where is the official guide for a nonexistent feature called Quantum Banana X999?" 2>&1 | Tee-Object .\proof\example-3-live.txt
```

**Only upload these files after checking that the commands actually reached the live endpoint.** Do not submit errors, localhost mock output, placeholders or empty logs as proof of live Pharos MCP results. Add a screenshot of the successful terminal session if you can.

For an AI.PHAROS platform-side record, ask its Docs MCP agent to run the same questions with `askQuestion` and show the tool call/source links. Link or screenshot that session if the chat link is not visible to reviewers in an incognito browser.

## 8. Offline reproducibility

```powershell
npm.cmd run demo
```

This runs **exactly three queries** against a self-contained local mock MCP server and saves their **actual mock outputs** to [`examples/mock-demo-output.txt`](examples/mock-demo-output.txt). The first two are deliberately labelled `MOCK answer` and use example documentation URLs; the third tests the no-answer behavior. These are regression-test examples **not evidence of a Pharos live call**.

## 9. GitHub Actions (optional live proof)

This repository includes [`.github/workflows/verify.yml`](.github/workflows/verify.yml). Every push runs local unit tests automatically. After you publish the code to GitHub, open **Actions → Verify Pharos Docs Search CLI → Run workflow** to run a **manual, real remote MCP smoke test** from GitHub's runner. Download the `real-pharos-docs-mcp-results` artifact to inspect the actual tool list and the three query results; it clearly distinguishes transport errors from successful sourced answers.

A failed remote MCP test should be reported honestly, not presented as successful evidence. The ordinary unit tests use a mock server; the manually launched live job does not.