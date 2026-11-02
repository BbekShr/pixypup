# Recording the demo video, step by step

The video is 25% of the score ("working, impressive, holds up live, quality of the video"), and Impact
(30%) is judged largely from it. Record every beat as its own clip, so a mistake costs one beat, not the
whole take. The staging details behind each beat are in [DEMO.md](DEMO.md).

## Part 1: get the Mac ready (once, about 20 minutes)

1. **Install the fresh build.** Open `release/PixyPup-0.1.0-arm64.dmg` and drag PixyPup onto Applications
   (replace the old copy). Start a QuickTime screen recording first: this is the install clip for beat 2.
   First open: right-click PixyPup in Applications, choose **Open**, then **Open** again.
2. **Grant the permissions on this build** (they reset whenever the app is rebuilt):
   - Right-click the pet, turn on **Notice my screen**, and accept the explainer.
   - System Settings > Privacy & Security > **Accessibility**: add PixyPup (for the Dock badge reaction).
   - System Settings > Privacy & Security > **Screen Recording**: add PixyPup, then quit and reopen it (for the call hide).
   - **Microphone**: macOS asks the first time you hold ⌥ Space. Click Allow.
   - **Terminal Automation**: macOS asks on the first sniff (step 4). Click Allow.
3. **Set up the screen for recording:**
   - Turn on Do Not Disturb, quit Slack, Mail and Messages, and hide desktop icons.
   - Use the built-in display. Terminal must be front-most and tall enough to show the red assertion.
   - Right-click the pet and turn on **Show what Pakkun sees**, so the debug card is in shot.
   - Leave **Hide during screen sharing** off, or the pet won't appear in the recording.
   - Size: Large. Energy: Playful.
4. **Dry run the three reactions** from the repo folder, and check that each one fires before you record:

   ```bash
   scripts/stage-demo.sh fail
   ```
   He runs to the red line, sniffs, and barks a Muse Spark line. Click him for the hint.

   ```bash
   scripts/stage-demo.sh fix
   ```
   He rolls over and cheers.

   ```bash
   scripts/stage-demo.sh badge
   ```
   His ears perk up when the Badge Demo count rises.

   ```bash
   scripts/stage-demo.sh call
   ```
   He hides at the edge. Close the Meet tab and he comes back.

   ```bash
   scripts/stage-demo.sh reset
   ```
   If a reaction doesn't fire, the debug card says why. See "If a reaction does not fire" in DEMO.md.

## Part 2: record the clips (about 1 hour)

Record with QuickTime (File > New Screen Recording), or with Screen Studio for automatic zoom on clicks.
Keep each clip a little long; the edit will trim it.

| # | Clip | What to do | Lands at |
|---|---|---|---|
| 1 | **Hook** (camera) | You with the real Pakkun, 15 s: "I spend my days in dense docs and terminals. He gets me through it. I wanted *him* on my screen, not a stock mascot." | 0:00 |
| 2 | **Install** | The DMG drag from Part 1, then the pet drops onto the desktop | 0:15 |
| 3 | **Photo → pet** | Right-click > **Add another pet…**, drop a photo from `assets/photos/` (HEIC is fine), name it, and let the whole run play (about 90 s). Sped up in the edit. | 0:30 |
| 4 | **The sniff** (never cut) | `fail` → sniff and bark → click for the hint → `fix` → the cheer. Keep the debug card in shot. | 1:05 |
| 5 | **Badge and call** | `badge` (he perks up), then `call` (he hides), then close the tab | 1:30 |
| 6 | **Voice** | Hold ⌥ Space: "Pakkun, sit", then "roll over" | 1:45 |
| 7 | **Little moments** | Pet him (hearts), click for tricks, Pet library, PixyPup Overload! | 2:00 |
| 8 | **Calm and in control** | Snooze; turn Notice my screen off and say "with this off, no network calls at all" | 2:10 |

Record clips 3, 4 and 6 while you're online; they need the Meta API. Each pet you create costs credits,
and the $150 runs out with the 10-day window, so make one or two pets, not ten.

## Part 3: the cards (Claude builds these)

- Intro title: PixyPup, the one-line pitch, "Indie Developer · Build for Your World"
- How it works (2:30): photo → SAM 3.1 → Muse Image → Muse Wonder → Muse Spark → Voice Transcribe, using the real pose sheet
- Outro: repo link, website, "next: Windows, more reactions"

## Part 4: edit and submit

1. Put the clips in order in iMovie, CapCut or Screen Studio. Speed up the waits (pet creation 4 to 8×), and keep the sniff at real speed.
2. Add the voiceover and captions. Keep the whole video at 3:00 or less.
3. Export at 1080p. Watch it once start to finish with the sound on.
4. Submit at https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit by **6:00 PM CT, Wed Nov 4** (hard deadline 8:00 PM CT).
5. Leave this setup alone until the Nov 9 finals, because the product has to "hold up live".
