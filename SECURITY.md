# Security

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/maneeshv/paseo-codex-voice/security/advisories/new). Do not publish credentials, exploit details, or private conversation content in a public issue. If private reporting is unavailable, open an issue asking for a private contact without disclosing the vulnerability.

Include the affected commit, Paseo/Codex versions, operating system, reproduction steps using non-sensitive data, and expected versus actual behavior. This is a community project; there is no guaranteed response time. Fixes are targeted at the latest main branch, not older snapshots.

## Trust model

Paseo plugins are trusted, unsandboxed programs. This plugin starts a local Codex app-server process and sends user-authorized workspace and agent context to model services. Do not install it on an untrusted daemon or use it with information you cannot send to those providers.

The coordinator's read-only sandbox, disabled shell tools, and tool-use instructions do not isolate configured MCP servers. It inherits the daemon host's normal Codex configuration. Do not assume prompt restrictions are enforced access controls.

Worker agents retain their normal Paseo permissions. The coordinator does not approve their requests. Anyone who can use a trusted plugin and its daemon may have broad access; this plugin is not a separate multi-tenant authorization layer.

Never attach raw account configuration, unredacted logs, access tokens, or private transcripts to reports. Diagnostic redaction is best effort, not a guarantee that arbitrary secrets are removed.

## Dependency status

On 2026-11-02, `npm audit` reported 12 moderate findings in the pinned React Native development dependency chain, originating from a minimatch denial-of-service advisory. There were no high or critical findings in that audit. npm's suggested direct-package update changes the React Native version supplied by Paseo; do not apply `npm audit fix --force` without checking host compatibility. These packages support local typechecking and tests; Paseo supplies its own runtime modules. Audit results for this lockfile do not assess Paseo's runtime dependencies.
