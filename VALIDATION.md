# Validation

Tested locally on 2026-11-02 with Paseo 0.14.0 and Codex CLI 0.162.1.

- `npm run typecheck`: passed.
- `npm test`: 15 passing checks covering coordinator lifecycle, startup/close races, validated tool dispatch, typed-request queuing, worker updates, transcript assembly, microphone cleanup, WebRTC failure handling, and placement registration/cleanup.
- Plugin installed from this directory; reload reported enabled/running and logs reported Plugin ready without errors.
- Live WebRTC connection inside Paseo's embedded browser reached connected state using the signed-in Codex account.
- Synthetic spoken request was transcribed and invoked the actual Paseo provider-list tool. Codex returned the correct provider names in its voice transcript.
- Typed request created an ordinary Codex worker titled Codex Voice validation worker in the current workspace. The worker returned VOICE_WORKER_OK. The coordinator reported that result in its voice transcript.
- The integration harness exercised the production VoiceSessions backend directly. It simulated the turn-ended callback after observing worker completion; the installed plugin's lifecycle registration is typechecked but was not exercised through the actual panel.
- Microphone acquisition, mute, stop, cancellation, and playback cleanup were checked with browser mocks. Physical microphone capture and audible speaker output still need a manual desktop check.
- Initial main-window visual verification was unavailable. During the placement follow-up, native screenshots and clicks succeeded: both the workspace header button and sidebar row are visible; header click opens the workspace voice panel; sidebar click opens the workspace picker; selecting a workspace opens the ready voice view; Change workspace returns to the picker. A narrow desktop layout was checked and the original window size restored. Light theme and native mobile were not manually checked. The temporary browser harness and probe controls were removed after initial testing.

Try in Paseo: open Codex Voice from the workspace header, sidebar, composer, or workspace Command Center, press Start voice, and ask it to list providers. Then ask it to create a worker in the current workspace with a small task. Ending the call should leave that worker available in Paseo.
