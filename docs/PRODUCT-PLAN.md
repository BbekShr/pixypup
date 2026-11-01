# PixyPup product plan (Fable, 2026-10-31; adopted by the CEO with one correction)

Bar from the maintainer: cuteness overload, calm, easy, never bothering, complete user control, an adorable and seamless install, everything works, win the Meta hackathon.

## First two minutes
1. **DMG**: cream window (#FFF6EC), soft paw prints, 3D Pakkun sitting on the left, Applications on the right, hand-lettered "Drag me home". One small line: "First open: right-click → Open (indie app, not yet notarised)".
2. **First launch**: nothing modal. Built-in demo Pakkun drops onto the desktop floor (gravity bounce), barks "Woof!", starts wandering. A small rounded welcome window: "This is Pakkun. He'll keep you company. Want your own pet?" → **Make my pet** / **Keep Pakkun for now**. No key, no permissions, zero network.
3. **Photo drop**: dashed cream drop zone with a paw cursor, name field ("What's their name?"), dog/cat toggle.
4. **Key, only now**: masked field, "stored in your Mac's Keychain, never in a file", link to dev.meta.ai, "Why?" disclosure. A bad key comes back in the pet's voice, not an error code. `MODEL_API_KEY` in the shell skips the step.
5. **Birth (~50 s)**: the photo fades, the SAM cutout glows in, labelled blobs ("standing", "stepping", "sitting", "napping", "barking", "rolling", "blinking") pop into real frames as pose events arrive; rotating copy ("Learning her ears…"). No spinner.
6. **Reveal**: window shrinks to the floor, Pakkun trots off, the new pet drops in, bounces, "Hi, I'm Milo!", wanders. Last line: "Right-click your pet any time."

## Calm and control
- Never steals focus; never covers work (floor line, 140 px, click-through except the sprite). Already true; keep tests.
- No audio at all.
- Right-click menu submenus (persisted in settings.json): **Snooze** (1 h / until tomorrow; tray shows "Wake up"), **Size** (Small 110 / Medium 140 / Large 180), **Energy** (Sleepy / Normal / Playful scales dwell, speed, sleep-after), **Launch at login** (default off), **Hide from screen shares** (opt-in; `setContentProtection`). CEO correction: default is VISIBLE, because hidden-by-default would make the pet invisible in the maintainer's own demo recording.
- Not building: macOS Focus sync (no public API; Snooze covers it), caret avoidance.

## Cuteness system
- Tokens in one `src/ui/tokens.css`: cream #FFF6EC, ink #3B2F2A, blush #F4A6A0, honey #F6C76B, sky #BFE3F2; radius 20 px windows / pills; `ui-rounded, "SF Pro Rounded", system-ui` 15/13 px; pop `cubic-bezier(.34,1.56,.64,1)`, settle `cubic-bezier(.2,.8,.2,1)`, 180/320 ms. Speech bubbles: cream pill, blush border, soft shadow, tail toward the pet. Native menu stays native.
- Micro-interactions: hover → face the cursor + 6° tilt + 1.04 pulse; click → ±5° wiggle + two hearts, then the trick cycle; yawn before nap ("~" bubble); blink (`idle_blink` frame, 120 ms every 3-6 s). Reduced motion disables them.
- Skills: app engineer loads `frontend-design` for onboarding and self-reviews with `taste-skill`; `ponytail` everywhere else.

## Hackathon
- Weights (reported): Impact 30, Meta tooling 25, Demo 25, Depth 20.
- Meta tools by depth: Muse Image (8+ consistent 3D poses from one photo) → SAM 3.1 (cutout + cleanup) → Muse Spark 1.3 with a visible job (reads the red test line as quoted data, returns `{action, reason, bubble}`; the pet's bubble says "Found it: …", debug panel shows the JSON) → Muse Voice Transcribe (last in, first cut).
- Video: 0:00 real Pakkun · 0:15 DMG + first launch drop · 0:30 photo → birth time-lapse → reveal · 1:05 failing test sniff + Spark bubble, Slack perk, Zoom hide, debug panel · 1:45 voice (or menu + petting) · 2:10 calm & control in 15 s (Snooze, zero network with `lsof`) · 2:30 architecture, "one photo, 50 seconds, no 3D artist", roadmap, repo.
- Rehearse on the packaged dmg, not `npm run dev` (permissions bind to the bundle). Keep a cached pack and record the birth early as backup footage.

## Build order
Sun: F13 (3D, 4-frame walk, idle_blink, leaf validator) → F15 built-in demo pet (+ electron-builder files fix) → F5a onboarding shell (window, photo, name, key, create-pet IPC) → F5b birth + reveal → F16 calm & control menu (absorbs F14 and F9 toggles).
Mon: P2 network gate (+ lsof proof) → F6a Swift helper → F6b readers → F7 loop + sniff + Spark bubble, with F7-ui (overlay sniff/hide/walk_to) → F17 micro-interactions → F12 debug panel.
Tue: F8 voice (hard cut Tue 10 PM) → F10 dmg art + README → F11 stage-demo → P1 CI.
Wed: rehearse on the dmg 9-1, record, edit, submit by 6 PM CT.

Cut order: F8 → F12 → F17 blink/yawn (keep hover + wiggle) → F10 custom dmg art → Slack reaction → Zoom reaction. Never the sniff, never F5/F15.

Backlog changes: close F1 (F4 evidence); dissolve F9 into F5a/F16/P2/F10; merge F14 into F16; defer P3 and P4 until after the hackathon.

## Top risks
1. 4-frame walk legs drift → keep walk_0 as reference; fall back to 2 frames + stride bob.
2. TCC permissions reset on every ad-hoc rebuild → freeze the dmg Tue night, rehearse on that build.
3. Live pipeline failure while recording → retries + per-pose fallback; cached pack; record the birth early.
4. Retina mapping misplaces the sniff → divide by scale factor; debug box shows it.
5. Onboarding eats the schedule → one HTML file, tokens.css, no framework, 7 h cap.
6. Shipping personal photos → fixed in F15.
7. Spark prompt injection via terminal text → quoted data, enum-only actions, ≤40-char bubble rendered with textContent; hostile-line test.

## Full use of the Meta models (maintainer: "use the full capability of meta models")
Every capability earns a visible moment, not hidden plumbing.

| Model capability | Feature | Item |
|---|---|---|
| SAM 3.1 image segmentation | pet cutout from the photo; pose cleanup fallback | done (F3) |
| Muse Image generation + editing | 3D poses, one-request walk sheet, blink as an edit of idle | done (F3, F13) |
| Muse Spark 1.3 image understanding + structured output | "Meet your pet": breed, coat, 3 personality traits, default energy, 6 catchphrases in the pet's voice; bubbles use them | F18 |
| Muse Spark search grounding | 3 sourced breed facts shown during the ~50 s birth | F18 |
| Muse Spark image understanding (screen) | the sniff sends the in-memory terminal crop image + quoted text; returns `{action, reason, bubble}` | F7 |
| SAM 3.1 video tracking | "drop a photo or a short video": track the pet, pick the sharpest distinct frames as extra references | F19 (stretch) |
| Muse Voice Transcribe keyword biasing + VAD | name and trick words boosted; endpointing for natural commands | F8 |
| Muse Glimmer (open weights, on-device) | roadmap: private on-device decisions (30B dense needs ~18 GB; this demo Mac is an M1 with 16 GB) | roadmap |
| Muse Wonder computer use | not used: conflicts with the privacy promise | no |
