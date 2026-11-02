# Repository instructions

## Scope and structure

This is a trusted local Paseo plugin, not Paseo core. Prefer the smallest complete change and reuse the existing VoiceView and SDK operations.

- `index.client.tsx`: client registrations and observation cleanup.
- `client/`: React Native panels, sidebar picker, and browser audio adapter.
- `index.server.ts`: RPC handlers and lifecycle hooks.
- `server/`: owned Codex process, voice sessions, Paseo tools, and tests.
- `shared/`: Zod RPC contracts shared by both runtimes.

## Conventions

- Use TypeScript and absolute `@/` imports for project code.
- Use npm with the committed lockfile; do not add dependencies for a few lines of code.
- Check installed SDK types and official documentation before using APIs. Use Context7 when available; if unavailable, verify against pinned source instead of inventing APIs.
- Keep React Native UI themed and accessible. Browser APIs belong only in `client/web.ts`; gate unsupported platforms. Never import server code or Node runtime modules into client code.
- Keep API validation, bounded histories, error handling, call identity checks, and resource cleanup. Stop only processes owned by this plugin.
- Preserve the distinction between voice coordinator and worker agents. Do not silently grant approvals or expand tool permissions.
- Never commit credentials, account configuration, transcripts, personal paths, local screenshots, or dependency directories.
- Use `trash` for manual deletions when available; otherwise ask before deleting files.
- Use Conventional Commit messages, for example `fix: release microphone when connection fails`.

## Verification

Run `npm ci --ignore-scripts`, `npm run typecheck`, and `npm test` from the repository root. Add a small meaningful regression test for non-trivial behavior.

For UI changes, inspect wide and narrow desktop layouts and theme colors. For audio changes, distinguish mocked checks, synthetic speech tests, and physical microphone/speaker checks. Never claim one proves another.

A plugin reload can end active voice calls. Reload only a development installation that the user has authorized. Never restart a user's Paseo daemon as a shortcut. Publishing, installing on other machines, or changing global plugin trust requires authorization.

Keep README.md, OVERVIEW.md, and VALIDATION.md accurate. Do not claim compatibility beyond what was checked.
