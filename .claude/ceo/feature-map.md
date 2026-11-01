# PixyPup feature map

How to reach and drive every feature, so an agent handed a vague report ("the share button does
nothing", a screenshot) goes straight to the right screen, element and file. Maintained by
the CEO; corrections from any agent are folded in at Records time. Verify an entry
on screen before trusting it: entries decay like backlog items.

How to run: `npx electron-vite dev --remoteDebuggingPort 9222`; renderer pages are at `http://localhost:5173/<page>/index.html` and listed at `http://127.0.0.1:9222/json` (see `/pixypup-verify`).

| Feature | Route / entry | Key elements (selector or test id) | Source files | Shortcuts / gestures |
|---|---|---|---|---|
| Overlay (the pet) | `/overlay/index.html` | `#pup` (img, transform = position + facing) | `src/overlay/overlay.ts`, `src/overlay/state.ts` | drag the pup; hover disables click-through |
| Tray menu | macOS menu bar | "Quit PixyPup" | `src/main/main.ts` | click the pup icon in the menu bar |
| Onboarding | `/onboarding/index.html` | stub | `src/onboarding/onboarding.ts` | none yet |
