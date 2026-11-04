# Paseo Codex Voice

**[Listed in the Paseo plugin directory](https://paseo.sh/plugins/maneeshv/codex-voice)**

Talk to a separate Codex voice coordinator inside Paseo desktop, and ask it to create and coordinate ordinary Paseo agents.

This is a community plugin, not an official OpenAI or Paseo product. It uses Codex's experimental realtime protocol; compatibility and account access can change.

## What it does

- Starts calls from the workspace header, sidebar, workspace tab menu, or **⌘K → Open Codex Voice**.
- Shows a composer pill only for existing calls associated with that chat or its workspace.
- Starts a separate voice session without needing an existing chat. The sidebar lets you choose an existing workspace first.
- Lists providers and workspaces, inspects agents, creates workers, and sends follow-up prompts when requested.
- Shows voice transcripts and accepts typed instructions during a call.
- Lets you choose a supported Codex voice and remembers the preference on the daemon host.
- Shows a host-wide active-call count in the sidebar, with workspace/thread navigation and individual Stop controls on the voice page.
- Leaves worker agents running when the call ends. Worker permission requests must be handled in Paseo.

The plugin does not replace Paseo's built-in microphone button or turn the current chat into a voice session.

## Requirements

| Component | Compatibility |
| --- | --- |
| Paseo app and daemon | 0.14.x or 0.15.x; SDK pinned to 0.15.0 |
| Codex CLI on the daemon host | Tested with 0.162.1; must support realtime v3 over WebRTC |
| Codex account | Signed in on the daemon host, with voice access available |
| Client | Tested on macOS Paseo desktop; compatible browser APIs required |
| Development | Node.js 22 and npm; lockfile included |

The daemon must find `codex` on its PATH. Native mobile audio is not implemented. Windows/Linux desktop and physical microphone/speaker output have not been fully validated; see [validation](VALIDATION.md).

## Install

Paseo plugins are trusted, unsandboxed code. Review the source before enabling plugins in **Settings → Plugins**. Only enable them on a daemon you trust.

Install the reviewed version from the [Paseo plugin directory](https://paseo.sh/plugins/maneeshv/codex-voice) on your daemon host:

```sh
paseo plugin add maneeshv/codex-voice
```

You can also enter `maneeshv/codex-voice` in **Settings → Plugins → Plugin source** and select **Install plugin**.

### Install from source

For local development or to use a repository checkout:

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

1. Open **Codex Voice** from the header or sidebar. From the sidebar, choose a workspace to open its voice panel.
2. Choose a **Voice**, then press **Start voice** and allow microphone access.
3. Try: “List my available providers,” or “Create a Codex worker in this workspace to inspect the README and suggest improvements.”
4. Use **Mute**, **End voice**, or the text input as needed.

Closing the owning voice panel ends that call. Paseo can also unmount inactive panels after its workspace retention limit is reached. Each call starts a new coordinator conversation; worker agents remain ordinary Paseo tasks. On narrow layouts Paseo may move the header action into its workspace menu.

### Voice choice

The selector reads `thread/realtime/listVoices` from the installed Codex CLI. With Codex 0.162.1, this plugin's V3 integration supports **Juniper, Maple, Spruce, Ember, Vale, Breeze, Arbor, Sol, and Cove**. V3 uses the returned V1 list in that release; newer versions can return a separate V3 list. General Realtime API voices are not interchangeable with this list.

The selection is a speaking voice, not a model. It applies to the next call through `thread/realtime/start.voice`, without changing the coordinator or worker model. **Codex default** inherits the host's `[realtime].voice` configuration; the built-in default is Cove. Preferences are shared across this plugin's clients on the same daemon and survive reloads/restarts. Uninstalling removes them. A saved voice no longer supported after a CLI change must be reselected; reload the plugin after upgrading Codex to refresh its cached list.

Verified against the official [voice definitions](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/protocol.rs#L233), [voice resolution](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/realtime_conversation.rs#L1509), and [start API](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/v2.rs).

### Finding and stopping active calls

The **Codex Voice** sidebar entry shows a green dot and **Live** while calls are live on its host, including other workspaces/projects and clients. Connecting calls use amber; multiple calls show counts. Open it to see each call's workspace, associated Paseo thread when present, and a **Stop** control. Up to four sessions can run per host. Stopping a call leaves its worker agents running.

The chat composer pill is a shortcut to existing calls, never a new-call launcher. It is hidden when no matching calls exist. A workspace-level call appears in that workspace's chats; an agent-specific call appears only in its associated chat. One call shows its state; multiple calls open a chooser. Clicking rechecks that the session still exists, then reveals its original local voice panel. Calls owned by another client, or whose original panel cannot be found, open a management-only page with status and Stop; they do not open a new microphone connection. Ended calls show an ended message.

Sidebar workspace selection opens the canonical workspace voice panel, so later shortcuts can focus that same panel. The voice preference remains available on the sidebar page and in the panel.

The list refreshes approximately every 1.5 seconds; a connection error displays unknown status instead of claiming no calls. Inventory checks do not renew call heartbeats. Closed/disconnected sessions disappear; an abandoned call expires after about 30 seconds, and plugin reload/unload closes all owned sessions. Calls still end when their owning voice view unmounts; navigation does not transfer microphone ownership between devices or attach a second audio connection. The coordinator's private, ephemeral Codex thread is not a navigable Paseo thread.

This uses Paseo's supported sidebar and screen surfaces. The indicator is host-wide, not an aggregate across hosts, and is hidden if the sidebar/plugin item is hidden. No Paseo rebuild is needed.

For source installations, after pulling updates, install dependencies if needed, run the checks, and reload:

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
