# PixyPup for Enterprise

## Privacy
- Screen awareness is off by default. When it is off, PixyPup makes zero network calls.
- No telemetry, analytics, or crash reporting.
- API keys are encrypted with Electron `safeStorage`, whose key is held in the macOS Keychain. They are never written in plaintext.
- The full screen is never captured. Only a crop of a terminal window is grabbed, held in memory, and discarded.
- Model access uses the Standard paid tier only. The `-contributor` models are never used because they allow training on your data.
- Offline mode (`offline: true`, set by an admin) blocks all background model calls (screen awareness and voice) and Talk to <pet>. By default it is off, but with screen awareness and voice off (their defaults) PixyPup makes no background network calls anyway.
- macOS permissions (Screen Recording, Accessibility, Microphone) are requested only when the matching feature is turned on.

## Admin configuration
Admins can restrict PixyPup with `/Library/Application Support/PixyPup/admin.json`. Admins can only restrict, never force the pet onto the user: everything about how the pet looks and behaves stays the user's choice.

```json
{ "adminDisableScreenAware": true, "offline": true, "voice": false, "hideInShares": true }
```

Admin keys (the full list; every other key in the file is ignored):

| Key | Effect |
|---|---|
| `screenAware` | overrides the user's screen-aware setting |
| `voice` | overrides the user's voice setting |
| `offline` | `true` blocks all background model calls (screen awareness, voice) and Talk |
| `adminDisableScreenAware` | when true, `screenAware` is forced to false |
| `hideInShares` | only `true` is honoured: the pet is hidden from screen sharing and recordings, and the menu item shows "(set by your organisation)" and is disabled |

Not admin-controllable (the user's own, set from the pet's menu): `petName`, `onboarded`, `size`, `energy`, `openAtLogin`, `snoozeUntil`. If the admin file is unreadable, not a JSON object, or has a wrongly typed known key, PixyPup fails closed: screen awareness and voice off, offline on.

## How it's enforced
The zero-network promise is enforced in code, not just policy. Every Meta API client is created by `openClient(purpose, settings, key)` in `src/api/gate.ts`, which throws `NetworkBlockedError` unless the purpose is allowed: `screen` needs screen awareness on and not admin-disabled, `voice` needs voice on, and `offline: true` blocks both. `talk` ("Talk to <pet>") is allowed unless `offline: true`; it sends the typed text (last 4 turns, held in memory) to Meta only when the user presses Send (a spoken sentence is only typed into the chat for them), saves nothing, and common phrasings about self-harm are recognised locally and those messages are not sent. `create-pet`, which the user starts explicitly, is always allowed. The architecture test `src/api/__tests__/network-gate.test.ts` fails the build if any other source file calls `fetch(`, opens a `WebSocket`, or constructs a `MetaClient`, or if `src/screen` or `src/voice` import the client directly.
