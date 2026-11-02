# Codex Voice

Talk to a separate Codex voice coordinator inside Paseo desktop. Open Codex Voice from the workspace header, left sidebar, workspace tab menu, an agent’s composer, or the workspace Command Center, then press Start voice. The sidebar lets you choose a workspace before a chat exists; the header uses the workspace already open.

The coordinator can discover providers, inspect tasks, create workspaces and workers, send follow-up prompts, and report worker results. Workers appear as ordinary Paseo agents and retain their normal permissions. Ending voice leaves those workers running.

Requires Paseo 0.14.x, Codex CLI 0.162.1 or a compatible version with native WebRTC voice, a signed-in Codex account with voice access, and microphone permission. This version targets the desktop app and compatible browsers; native mobile audio is not supported.

Audio goes directly from your device to Codex’s voice service using WebRTC. The plugin runs a separate Codex app-server process using the daemon host’s existing Codex sign-in. It passes the selected workspace and agent IDs, requested task messages, and worker results to the coordinator. The voice conversation is separate from the selected agent’s history and ends when the panel closes. Session transcripts are held in memory. Account availability and usage limits follow the Codex service.

The existing Paseo voice button remains available. Use a Codex Voice entry point for this plugin. Changing the workspace in the voice screen ends the current call; workers keep running.

This community plugin uses experimental Codex voice APIs. It inherits the host’s Codex configuration, including configured MCP tools; its coordinator instructions and read-only sandbox do not isolate those external tools. It is not an official OpenAI or Paseo product.
