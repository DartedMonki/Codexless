# Third-party notices

Codexless depends on third-party open-source packages. This file is a release-oriented summary of the production dependency set resolved by the current release lockfile, plus the development-only MCP client used by the public contract test. The Codexless npm tarball does not vendor `node_modules`; the Windows installer resolves production dependencies from the release lockfile with `npm ci --omit=dev`, and those installed dependency packages retain their own upstream LICENSE files.

## Production dependencies resolved by the release lockfile

| Package | Version | License / shipped notice | Upstream |
|---|---:|---|---|
| `@modelcontextprotocol/node` | `2.1.2` | package metadata: Apache-2.0; shipped LICENSE contains MCP MIT→Apache-2.0 transition text, full Apache-2.0 and MIT terms, plus CC-BY-4.0 documentation notice | Model Context Protocol TypeScript SDK |
| `@modelcontextprotocol/server` | `2.4.0` | same MCP transition LICENSE described above | Model Context Protocol TypeScript SDK |
| `@modelcontextprotocol/core` | `2.4.0` | same MCP transition LICENSE described above | Model Context Protocol TypeScript SDK |
| `@hono/node-server` | `2.1.6` | MIT | Hono Node.js adapter |
| `hono` | `4.13.16` | MIT | Hono |
| `zod` | `4.6.7` | MIT | Zod |

## Development-only dependency

| Package | Version | License / shipped notice | Upstream |
|---|---:|---|---|
| `@modelcontextprotocol/client` | `2.4.0` | package metadata: Apache-2.0; shipped LICENSE contains the same MCP transition text and license terms | Model Context Protocol TypeScript SDK |

The listed MCP package manifests identify the package license as Apache-2.0, while their shipped LICENSE files document an ongoing MIT-to-Apache-2.0 transition and include the applicable Apache-2.0, MIT, and documentation CC-BY-4.0 notices. The exact dependency LICENSE files remain authoritative for the code/content they cover.

Codexless does not claim ownership of third-party names, trademarks, or code. Each dependency remains subject to its own license terms and notices.

## Release checklist for notices

Before publishing a release:

1. freeze the release lockfile;
2. re-enumerate the production dependency closure and compare it with the table above;
3. recheck the exact shipped LICENSE/NOTICE files for those resolved versions;
4. if a future release vendors or redistributes third-party code rather than resolving it separately, include any license/notice text required by that distribution shape;
5. verify that the packed artifact does not accidentally contain private/internal source or local configuration.

This summary is not a substitute for the license text shipped by each dependency.
