# Paseo Codex Voice

Talk to a separate Codex voice coordinator inside Paseo desktop, and ask it to create and coordinate ordinary Paseo agents.

This is a community plugin, not an official OpenAI or Paseo product. It uses Codex's experimental realtime protocol; compatibility and account access can change.

## What it does

- Opens from the workspace header, sidebar, workspace tab menu, existing-chat composer pill, or **⌘K → Open Codex Voice**.
- Starts a separate voice session without needing an existing chat. The sidebar lets you choose an existing workspace first.
- Lists providers and workspaces, inspects agents, creates workers, and sends follow-up prompts when requested.
- Shows voice transcripts and accepts typed instructions during a call.
- Leaves worker agents running when the call ends. Worker permission requests must be handled in Paseo.

The plugin does not replace Paseo's built-in microphone button or turn the current chat into a voice session.

## Requirements

| Component | Compatibility |
| --- | --- |
| Paseo app and daemon | 0.14.x; SDK pinned to 0.14.0 |
| Codex CLI on the daemon host | Tested with 0.162.1; must support realtime v3 over WebRTC |
| Codex account | Signed in on the daemon host, with voice access available |
| Client | Tested on macOS Paseo desktop; compatible browser APIs required |
| Development | Node.js 22 and npm; lockfile included |

The daemon must find `codex` on its PATH. Native mobile audio is not implemented. Windows/Linux desktop and physical microphone/speaker output have not been fully validated; see [validation](VALIDATION.md).

## Install

Paseo plugins are trusted, unsandboxed code. Review the source before enabling plugins in **Settings → Plugins**. Only enable them on a daemon you trust.

```sh
git clone https://github.com/maneeshv/paseo-codex-voice.git
cd paseo-codex-voice
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install "$PWD" --id codex-voice --json
```

Run the installation command on the daemon host. Keep the cloned directory in place: this installs from that local path. If Codex is not signed in, use its normal sign-in flow on that host; do not put credentials in this repository.

## Use

1. Open **Codex Voice** from the header or sidebar. From the sidebar, choose a workspace.
2. Press **Start voice** and allow microphone access.
3. Try: “List my available providers,” or “Create a Codex worker in this workspace to inspect the README and suggest improvements.”
4. Use **Mute**, **End voice**, or the text input as needed.

Closing the voice view or choosing **Change workspace** ends that call. Each call starts a new coordinator conversation; worker agents remain ordinary Paseo tasks. On narrow layouts Paseo may move the header action into its workspace menu.

After pulling updates, install dependencies if needed, run the checks, and reload:

```sh
paseo plugin reload codex-voice --json
```

No Paseo source build or daemon restart is required. To stop using the plugin:

```sh
paseo plugin disable codex-voice --json
```

## Data and permissions

Audio travels from the client to Codex's voice service over WebRTC. The plugin starts its own `codex app-server` process on the daemon host using that host's existing Codex sign-in and configuration. Workspace context, typed instructions, requested agent messages, and worker results can be sent to the model provider. Service usage limits apply.

The coordinator requests a read-only sandbox, disallows approval prompts, disables shell tools, and is instructed to use only its Paseo coordination tools. **This is not a security isolation boundary:** it inherits normal Codex configuration, including configured MCP tools. Prompt instructions cannot enforce restrictions on those external tools. Paseo plugin code itself is trusted and unsandboxed.

Plugin session transcripts and event history are kept in memory. This is not a claim that Codex or its providers retain no diagnostics or data. Do not speak or paste secrets into the coordinator. The plugin does not approve worker permissions automatically.

## Troubleshooting

- **No entry points:** confirm both app and daemon are on supported versions, plugins are enabled, and `paseo plugin ls codex-voice --json` reports running. Sidebar visibility can also be controlled in Paseo settings.
- **Codex cannot start:** check the daemon host's Codex installation, PATH, and sign-in.
- **Voice fails to connect:** confirm account access and network availability. The realtime API is experimental.
- **Microphone denied:** allow Paseo in your operating system's microphone privacy settings, then retry.
- **Playback blocked:** end the call and press Start voice again.
- **Worker requests permission:** open that worker in Paseo and approve or deny there.

For diagnostics use `paseo plugin logs codex-voice --json`. Redact private paths, prompts, and credentials before sharing logs.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Licensed under the [MIT License](LICENSE).
