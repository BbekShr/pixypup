# PixyPup

PixyPup is a desktop pet for macOS. A little 3D-style dog walks along the bottom of your screen on a transparent, click-through overlay, reacts to what you are doing (when you opt in), and obeys voice commands. Screen awareness and voice are off by default, and nothing leaves your machine unless you turn them on.

## Develop

```
nvm use          # Node 22
npm install
npm run dev      # launch the app
npm run typecheck
npm run lint
npm test
npm run build
npm run pose-test
npm run build-native   # compile native/pixyhelper.swift
npm run dist           # mac dmg (ad-hoc signed)
```

## Install

1. Download `PixyPup-0.1.0-arm64.dmg` and open it.
2. Drag Pakkun onto the Applications folder ("Drag me home").
3. First open only: right-click PixyPup in Applications, choose **Open**, then **Open** again. PixyPup is an indie app signed ad hoc, not notarised by Apple yet, so a plain double-click is refused once. After that it opens normally.

PixyPup has no Dock icon; look for your pet on the desktop floor and the menu bar icon.

**Permissions.** None at install. macOS asks later, once each, and only when you turn the feature on: Automation (to read your front Terminal) when you enable "Notice my screen", and the microphone when you enable "Listen for my voice".

**Uninstall.** Drag PixyPup to the Trash, then delete `~/Library/Application Support/PixyPup` (your pets and settings).

Build it yourself: `npm run dist` writes the DMG to `release/`. `npm run make-art` regenerates the app icon and DMG background.

All code written from Oct 31 2026 for the Meta Global AI Developer Hackathon.

## Make your own pet
On first launch a small welcome window offers to turn a photo of your dog or cat into a pet (right-click the pet, "Make a new pet…", any time). While the pet is drawn the photo melts into the cutout and poses pop in; at the end the window shrinks to the floor, the old pet trots off, and the new one drops in and says hi. Rehearse without a key: `PIXY_FAKE_PIPELINE=1 PIXY_FAKE_FAST=1 npm run dev` (dev builds only).

## Little moments

Hover over your pet and it turns to look at you. Move the cursor back and forth over it to pet it: a happy wiggle and a few hearts. It yawns before a nap and stretches when it wakes. All of this is off when macOS "Reduce motion" is on.

## Calm and control
Right-click the pet (or use the menu bar icon) to Snooze it (1 hour, or until 8:00 tomorrow), change its Size (110/140/180 px) and Energy (sleepy/normal/playful), keep it in place, hide it from screen sharing (off by default), or open it at login (off by default). Choices persist in settings.json; a snoozed pet does no animation work at all.

## Notice my screen
Off by default; turn it on from the pet's right-click menu ("Notice my screen"), after a short explainer. Then he can notice a failing test in your front Terminal (he runs to it, sniffs and barks a line), a Slack Dock badge (he perks up), or a Zoom/Meet window (he hides at the screen edge until the call ends). He reads only the front Terminal's text and the list of open windows; nothing is saved, and the one failing line is sent to Meta's model only to word his speech bubble (no key means he uses his own lines). macOS asks once to let PixyPup control Terminal. Turn it off by unchecking the menu item; it also pauses while snoozed, and an organisation's admin file can lock it off. Rehearse without any permission: `PIXY_FAKE_SCREEN=1 npm run dev`, then `__pixyDebug.pref('screen:yes')` in the overlay's devtools (dev builds only).

## Listen for my voice
Off by default; turn it on from the right-click menu ("Listen for my voice"), after a short explainer. Then press ⌥ Space and say "Pakkun, sit" (also roll over, go to bed, come here, bark). He listens for up to 4 seconds, or until you stop talking, or until you press again; the microphone is on only during that window. The audio goes to Meta's speech model just for that moment and nothing is saved. macOS asks once for the microphone. It stops while snoozed, and an organisation's admin file can lock it off. Rehearse without a mic or key (dev builds): `PIXY_FAKE_MIC=<24 kHz 16-bit mono WAV> npm run dev`, then `__pixyDebug.pref('voice:fake:Pakkun, sit')` and `__pixyDebug.pref('voice:listen')`.


"Show what Pakkun sees" (right-click menu, off at every launch) pops a small card in the top-right corner: whether he is looking and why not, the failing line he found (80 characters, shown only on that card, never saved), Slack, call, his decision and bubble, and a dashed box around the line for 3 seconds.
