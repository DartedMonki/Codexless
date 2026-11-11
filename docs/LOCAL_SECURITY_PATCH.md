# Local security patch

Prepared on 2026-11-05 from commit `ed0dbc3c1ac259abf1ad1d21325aa88b8094a5ba` for this Mac's installation. This is a locally modified build, not a new upstream release.

## Changes

| Dependency | Previously locked | Patched version |
| --- | --- | --- |
| `@modelcontextprotocol/node` | 2.0.0 | 2.1.2 |
| `@modelcontextprotocol/server` | 2.0.0 | 2.4.0 |
| `@modelcontextprotocol/core` | 2.0.0 | 2.4.0 |
| `@modelcontextprotocol/client` (development only) | 2.0.0 | 2.4.0 |
| `zod` | 4.4.3 | 4.6.7 |
| `hono` | 4.13.1 | 4.13.16 |
| `@hono/node-server` | 1.19.17 | 2.1.6 |

The frozen shrinkwrap records the exact dependency versions and integrity hashes. Installation continues to disable package lifecycle scripts. Third-party notices were updated to reflect these versions and the shipped MCP license notices.

Both HTTP paths now enforce a 2 MiB body limit, a maximum batch length of 100, a nesting limit of 64, and a request collection-element budget of 100,000 before protocol classification. Both server factories set the patched SDK's tool-input element budget to 50,000. Larger Excel operations must be split into smaller calls. The public HTTP server also has a 30-second request-receipt timeout. Oversized bodies return HTTP 413, including chunked bodies; invalid or excessively complex JSON returns HTTP 400.

## Verification before installation

- Production `npm audit`: zero reported vulnerabilities on 2026-11-05, compared with three high and two moderate affected-package findings before the patch.
- `npm test`: passed, including the four new input-limit regression tests. Native Windows installation tests were skipped by the suite on macOS.
- `MCP_TEST_NEGOTIATION=modern node test/public-contract.mjs`: passed in addition to the default protocol check in the full suite.
- Source doctor with the project directory: core health and project authority passed using the existing Codex CLI 0.166.0. Browser capability was unavailable because the current Chrome skill was unavailable.
- The regression tests cover both HTTP protocol modes, rejection before tool dispatch, isolated responses to two clients, ordinary 5,000-entry collections, byte limits with and without Content-Length, malformed JSON, batch length, nesting, and collection floods.

These checks address the identified installation blockers. They do not constitute a complete security certification. A vulnerability scan can only report currently known issues.

## Local installation

Installation completed successfully in `existing` mode, using the current local Codex runtime. It avoids requiring a separate managed-runtime login. The installer did not configure an authenticated tunnel, ChatGPT connection, or automatic startup.

Installation directory:

```text
/Users/dani/Library/Application Support/Codexless/app
```

Build identity is recorded in `config/release-manifest.json` with source revision `ed0dbc3c1ac259abf1ad1d21325aa88b8094a5ba+local-security-cli-jobs`. Exact source file hashes distinguish this local patch from the upstream preview with the same package version.

Installed build ID: `565026444a70d978fb6f240651a257a8fb0e92408c29f2d16a01bfd50097154d`. The installer retains the immediately preceding local build for rollback.

Post-install verification passed:

- All installed release file hashes match the tested source and manifest.
- Installed doctor reports core health `ok`, existing-runtime routing, and successful project authority resolution.
- The installed HTTP server exposes 45 tools in both legacy and modern protocol modes; a real read-only command succeeds in each mode.
- Excessive tool inputs are rejected before execution in each mode. Oversized HTTP bodies return 413, batches over 100 messages return 400, and an untrusted Origin returns 403.
- The temporary smoke-test server was stopped after verification. No persistent service was started.

The installed doctor still reports the built-in browser capability unavailable (`current_chrome_skill_unavailable`). File and terminal access through ChatGPT web was subsequently configured and verified; built-in Codexless Browser capability is not claimed as configured.

## Local connection and diagnostics follow-up

The personal ChatGPT connection is named **Codexless Mac M4 Air** and uses the official OpenAI Secure MCP Tunnel client. A fresh ChatGPT web conversation successfully called `codex.command_exec` in read-only mode and returned an independently generated local verification value. The matching local receipt records successful completion. No Codex agent/model turn was started for this check.

Local diagnostic metadata is enabled explicitly for this installation. Six security/input/logging regressions, the full existing suite, and two operator-export privacy tests passed. Logs were checked after the real ChatGPT call: the verification file contents and raw API-key patterns were absent.

Operator commands installed under `~/.local/bin`:

```sh
rtk proxy codexless-status
rtk proxy codexless-logs
rtk proxy codexless-status --export
```

The local log directory is `~/Library/Logs/Codexless`. Tool metadata is bounded to 2,000 receipts and seven days. Hourly maintenance rotates log files above 10 MiB and retains five compressed archives per file. Diagnostic exports include only allowlisted logs and metadata, redact key/bearer patterns, and exclude credential files. Logs and exports are user-private.

User LaunchAgents start the bridge and reconnect the managed tunnel at login. The private operator guide and connection verification receipt live beside the local installation and under `~/.config/codexless`, respectively; account identifiers and credential contents are not added to the repository.

## Local CLI access and long-command follow-up (2026-11-06)

The local installation now opts into a workspace-derived Codex permission profile with network access and explicit browser/Go/npm cache writes. These overrides apply only to the Codexless service; global Codex configuration is unchanged. A separate loopback-only isolated Chromium service supports task-specific Playwright CLI attachments; the existing Helium login remains accessible through OpenCLI. User-private browser logs participate in the existing rotation/export diagnostics.

Long command jobs and bounded concurrency are disabled by default. This Mac explicitly enables `CODEXLESS_COMMAND_JOBS=1`, `CODEXLESS_COMMAND_MAX_CONCURRENT=2`, and `CODEXLESS_COMMAND_MAX_TIMEOUT_MS=600000`. Commands taking over five seconds return a job reference; `codex.command_status` reads the same command's result without redispatch. A bounded queue handles contention. Up to 32 long-job results are retained in memory for one hour after completion; service restarts lose those results, and unknown references never automatically replay work. Metadata logs include job transitions and exit codes, without command arguments or output. The default 45-tool public surface is unchanged; this explicit local extension adds the read-only status tool as the 46th tool.

The full existing suite and seven command timeout/job/concurrency regressions passed, including reconnects, polling while a command is running, preservation of exact exit/output, no replay, bounded queue/capacity/retention, and formal Codex routing through RTK. Live MCP verification completed a four-minute dashboard typecheck and returned its final result through polling. A separate real ChatGPT web test successfully called the new job-status tool after refreshing its tool catalog. GitHub authentication/API, OpenCLI connectivity, the existing Go toolchain/vulnerability scanner, npm audit, and Playwright local-page navigation were verified through the actual connector. Repository-specific vulnerability/migration findings were recorded separately in the private operator guide; they are not reported as connector failures or as passing checks.

Verification receipts are saved locally at `/private/tmp/codexless-doctor-installed.json` and `/private/tmp/codexless-installed-smoke.json`.

To run a fresh diagnostic:

```sh
rtk proxy "/Users/dani/Library/Application Support/Codexless/app/bin/codexless-doctor.sh" --cwd "/Users/dani/Documents/Projects/Codexless"
```

To start HTTP manually for this project:

```sh
rtk proxy env CODEXLESS_DEFAULT_CWD="/Users/dani/Documents/Projects/Codexless" "/Users/dani/Library/Application Support/Codexless/app/bin/codexless-http.sh"
```

The HTTP listener is local-only. Remote use requires a separately authenticated connection.

An upstream upgrade can replace these local changes. Recheck dependencies and confirm the input-limit protections remain in place before installing another version.

## Upstream security references

- [MCP validation resource-exhaustion advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453)
- [MCP HTTP body and batch limits advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-f897-62hf-6gxq)
- [Zod constrained-collection validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
