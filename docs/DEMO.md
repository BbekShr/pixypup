# Demo rehearsal checklist

The three screen reactions for the video, staged with `scripts/stage-demo.sh`. The badge and call
stand-ins are honest: the pet reacts to any app's new Dock badge (Mail, Messages, Slack, ...) and any
window matching the call rule (`zoom.us` owner, or a title like `Meet - ...`).

## One-time setup (do before the first take)
Permissions reset when the app is rebuilt, so do this on the build you will record.
- Turn on "Notice my screen" (right-click the pet) and accept the explainer.
- **Terminal Automation**: the first sniff makes macOS ask "PixyPup wants to control Terminal". Click Allow.
- **Accessibility** (Dock badges): System Settings > Privacy & Security > Accessibility > add PixyPup (in `npm run dev`, add the terminal you launched it from).
- **Screen Recording** (only if the call does not trigger): some hosts redact window titles without it. Same pane, add PixyPup, then relaunch it.
- Chrome and Terminal must be installed; `stage-demo.sh badge` builds Badge Demo on first use (needs `swiftc`).
- Right-click the pet > "Show what Pakkun sees" so the debug card shows each reaction.
- "Hide during screen sharing" stays off (default) so the pet is in the recording.

## Beats (video 1:05 to 1:45)
Record with QuickTime (File > New Screen Recording). Put Terminal front-most before beat 1.
1. **Failing test.** Run `scripts/stage-demo.sh fail`. A Terminal window opens and runs a test that fails (`expected 4 to be 5`). Within a few seconds the pet runs to the red line, sniffs and shows a Spark bubble; the card shows the line and a dashed box.
   - **Hint.** Right after the bark he says "Click me for a hint". Click him (within 2 minutes): a "thinking…" pill, then a Hint card from Muse Spark naming the cause and the file and line. Needs the key.
   - **Fixed.** Run `scripts/stage-demo.sh fix`. A second Terminal window reruns the same test, now green. Within a few seconds he rolls over, hops, hearts burst and he cheers ("You fixed it!").
2. **Dock badge.** Run `scripts/stage-demo.sh badge`. "Badge Demo" appears in the Dock and its badge goes 1, 2, 3 every 6 s (quits after 60 s). The pet perks up on the first increase; the card's Badge row shows the number.
3. **Call.** Run `scripts/stage-demo.sh call`. Chrome opens a page titled "Meet - pix-ypup-dem"; the pet hides at the screen edge. Close the tab and he comes back.
4. Run `scripts/stage-demo.sh reset` between takes (quits Badge Demo), then close the Meet tab and the Terminal window yourself (no AppleScript, so no extra prompts).

## If a reaction does not fire
- Check the debug card: Terminal "nothing failing" = Terminal is not front-most or Automation was denied; Badge "—" = Accessibility missing; Call "no" = grant Screen Recording.
- Rehearse the pet side without any permission: `PIXY_FAKE_SCREEN=1 npm run dev`, then in the overlay devtools `__pixyDebug.pref('screen:yes')` and `__pixyDebug.behave(...)` (dev builds only; see README).
- Last resort: record the reaction from the fake-screen run and cut it in. Never cut the failing-test sniff.

## If the Wi-Fi dies
Everything the pet does on its own is local; only the model calls need a network. In the packaged dmg, with no connection:
- **Works offline:** Pakkun, the Pet library (Mochi, Kuma), walk, turn, drag, tricks, size, energy, snooze; the failing-test sniff (the failure is detected locally from Terminal, and only the Spark wording of the bubble needs the network: it gives up after 6 s, `src/screen/decide.ts:50,73-78`, and the decider uses its own line, `:86`, `FALLBACKS` at `:49`); the fix celebrate; the badge perk; the call hide.
- **Needs the network:** create-a-pet from a photo, the hint (aborted after 15 s, `src/main/main.ts:341`, then he says "Hmm, I'm not sure this time", `src/overlay/overlay.ts:1015`), voice, and Talk.
- **Fallback kit (dev checkout only):** the fake modes are deliberately gated on `!app.isPackaged` (`src/main/main.ts:246,307,351`, `src/main/onboarding.ts:20`), so a packaged dmg can never run them. Do not change that to make a demo easier.
  - Create-a-pet: `PIXY_FAKE_PIPELINE=1 PIXY_FAKE_FAST=1 npm run dev` replays the built-in Pakkun as if just generated.
  - Screen reactions and the hint: `PIXY_FAKE_SCREEN=1 npm run dev`, then in the overlay devtools `__pixyDebug.pref('screen:yes')`, and `__pixyDebug.pref('screen:fake:fail')` or `screen:fake:pass` to flip the scripted terminal (the hint is a canned line with no key, `src/main/main.ts:339`).
  - Voice: `PIXY_FAKE_MIC=<wav>` streams a recording instead of the microphone (the transcript still comes from the model, so voice itself needs the network).
- **Pre-record each beat** while you have a connection, so a dead network costs you a re-take of nothing. Never cut the failing-test sniff.

| Beat | Works offline? | Fallback |
|---|---|---|
| Failing-test sniff | Yes (Spark bubble waits up to 6 s, then his own line) | None needed; never cut it |
| Hint | No | Pre-recorded clip, or `PIXY_FAKE_SCREEN=1` canned hint |
| Fixed celebrate, Dock badge, Call hide | Yes | None needed |
| Create-a-pet | No | `PIXY_FAKE_PIPELINE=1 PIXY_FAKE_FAST=1` run, or a pre-recorded clip |
| Voice, Talk | No | Pre-recorded clip (`PIXY_FAKE_MIC=<wav>` for the mic side) |
| Pet library, walk, tricks, size, energy, snooze | Yes | None needed |
