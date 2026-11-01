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
Admins can enforce settings with `/Library/Application Support/PixyPup/admin.json`. Its keys override user settings:

```json
{ "adminDisableScreenAware": true, "offline": true, "voice": false, "petName": "Pakkun" }
```

Supported keys: `screenAware`, `voice`, `offline`, `adminDisableScreenAware`, `petName`. If `adminDisableScreenAware` is true, `screenAware` is forced to false.
