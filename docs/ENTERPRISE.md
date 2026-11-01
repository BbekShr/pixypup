# PixyPup for Enterprise

## Privacy
- Screen awareness is off by default. When it is off, PixyPup makes zero network calls.
- No telemetry, analytics, or crash reporting.
- API keys are stored in the macOS Keychain via Electron `safeStorage`. They are never written in plaintext.
- The full screen is never captured. Only a crop of a terminal window is grabbed, held in memory, and discarded.
- Model access uses the Standard paid tier only. The `-contributor` models are never used because they allow training on your data.
- Offline mode (`offline: true`, the default) disables all model calls.
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
| `offline` | overrides offline mode |
| `adminDisableScreenAware` | when true, `screenAware` is forced to false |
| `hideInShares` | only `true` is honoured: the pet is hidden from screen sharing and recordings, and the menu item shows "(set by your organisation)" and is disabled |

Not admin-controllable (the user's own, set from the pet's menu): `petName`, `onboarded`, `size`, `energy`, `openAtLogin`, `snoozeUntil`. If the admin file is unreadable, not a JSON object, or has a wrongly typed known key, PixyPup fails closed: screen awareness and voice off, offline on.
