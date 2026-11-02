# Contributing

Small, focused issues and pull requests are welcome. For a larger change, open an issue describing the user problem before implementing it. Follow the [code of conduct](CODE_OF_CONDUCT.md).

## Local development

Fork and clone the repository, then use Node.js 22:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

The tests use fake Codex and browser connections; they do not need a Codex account, microphone, or running Paseo daemon. Host SDK packages are development dependencies because Paseo supplies the runtime modules. `private: true` prevents accidental npm publication; distribution is currently through Git.

For manual testing on a trusted development daemon:

```sh
paseo plugin install "$PWD" --id codex-voice-dev --json
paseo plugin reload codex-voice-dev --json
paseo plugin logs codex-voice-dev --json
```

Avoid running two voice plugin installations simultaneously unless you intend to see duplicate UI entries. Reloading ends that installation's active calls. Do not restart the daemon.

## Before submitting

- Run typecheck and tests. Add regression coverage for behavioral changes.
- Explain the problem, the changed behavior, and how you verified it.
- For UI changes, include screenshots with private task names, paths, and conversations removed.
- For voice changes, identify whether testing used mocks, synthetic speech, or real microphone/speaker hardware. Account access can affect results.
- Update public docs and the manifest's Paseo compatibility range when behavior or API requirements change.
- Keep runtime boundaries and `@/` imports described in [AGENTS.md](AGENTS.md).
- Use Conventional Commit titles such as `feat: add workspace search` or `fix: close abandoned voice sessions`.

Do not include credentials, local account files, or private task output. Report security problems privately as described in [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution is licensed under the repository's MIT License. No separate contributor agreement is required.

## Optional GitHub Actions setup

The repository includes a ready-to-use CI template at [docs/ci.yml.example](docs/ci.yml.example). It is not active: the publishing account's GitHub CLI token does not currently have the `workflow` scope. Local checks above remain the verification path.

A maintainer who wants automated checks can authorize that scope using `gh auth refresh -h github.com -s workflow`, then copy the template to `.github/workflows/ci.yml`, commit, and push it. The template runs the same lockfile installation, typecheck, and tests on Node.js 22 with read-only repository permissions.
