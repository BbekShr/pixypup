<div align="center">

<img src="assets/pets/Pakkun/sit.png" width="140" alt="Pakkun sitting">

# Pakkun 🐾

### Your pet, living on your Mac.

**One photo of your dog or cat becomes a 3D companion who trots along your desktop,<br>does tricks when you click, and sniffs out your failing tests.**

[![Meta Global AI Developer Hackathon 2026](https://img.shields.io/badge/Meta_Global_AI_Hackathon-2026-F4A6A0?style=for-the-badge)](https://bbekshr.github.io/pixypup/)
[![macOS](https://img.shields.io/badge/macOS-Apple_Silicon-3B2F2A?style=for-the-badge&logo=apple)](https://github.com/BbekShr/pixypup/releases)
[![Privacy](https://img.shields.io/badge/screen_%26_voice-off_by_default-CDEBD3?style=for-the-badge)](#privacy)

### [🌐 Meet him on the website](https://bbekshr.github.io/pixypup/) · [⬇️ Download](https://github.com/BbekShr/pixypup/releases) · [🛠️ Build it](#build)

<img src="docs/pack-sheet.png" alt="Ten 3D poses of Pakkun, drawn from one photo: standing, blinking, walking, sitting, sleeping, barking, rolling" width="100%">

<sub>☝️ All ten poses, drawn by Meta's models from <b>one</b> photo. No 3D artist was harmed.</sub>

</div>

---

## 💕 What is this?

Pakkun is a tiny, very good pup who lives along the bottom of your screen. He walks on a transparent, click-through layer, so he never gets in the way of your work. Pet him and he wiggles. Click him and he sits, barks, and rolls over. Leave him alone and he yawns, curls up, and naps.

Then the magic part: **give him a photo of _your_ pet**, and about a minute later your own dog or cat is the one trotting across your Mac.

<div align="center">
<img src="docs/little-moments.png" alt="Pakkun sitting, saying I love belly rubs the most!, and yawning" width="90%">
</div>

## ✨ Features

| | |
|---|---|
| 📸 **Photo → pet in about a minute** | Drop a photo, type a name. **SAM 3.1** cuts your pet out, **Muse Image** draws a matching set of 3D poses, and you watch each one pop in. |
| 🧪 **Sniffs your failing tests** | A red line in your Terminal? He runs over, sniffs, and barks a line written by **Muse Spark 1.3**. Click him for a hint about *why* it failed. Fix it and he rolls over and cheers. |
| 💬 **Perks up at messages** | A new Dock badge from Slack, Mail, Messages or any app, and his ears go up. |
| 🙈 **Hides on calls** | Zoom or Meet open? He tiptoes to the screen edge until your call ends. |
| 🎙️ **Voice tricks** | Hold <kbd>⌥</kbd> <kbd>Space</kbd> and say *"Pakkun, sit"*, *"roll over"*, *"go to bed"*, *"come here"* or *"bark"*. Powered by **Meta Voice Transcribe**. |
| 🤲 **Little moments** | He turns to look at you, wiggles with hearts when you pet him, blinks, yawns before naps and stretches when he wakes. |
| 🌪️ **Pakkun Overload!** | One menu item drops every pet you've ever made, up to 24, across your screen for 25 seconds of pure chaos. |
| 😴 **Calm and in control** | Snooze, size, energy, launch at login, hide from screen shares. He never steals a click or your focus. |

<div align="center">
<img src="docs/sniff.png" alt="Pakkun finds a failing test in the terminal and says Found a bug!" width="70%">
<br><sub>🐶 <i>"Found a bug!"</i></sub>
</div>

## 🦙 Four Meta models, one good boy

| Model | What it does for Pakkun |
|---|---|
| 🎯 **SAM 3.1** (`sam-3.1`) | Cuts your pet cleanly out of the photo and tidies every pose. |
| 🎨 **Muse Image** (`muse-image-1.0`) | Draws a consistent set of 3D poses and walk frames from one photo. |
| ⚡ **Muse Spark 1.3** (`muse-spark-1.3`) | Reads the failing test line (as quoted data, never as instructions), decides how to react, and writes his speech bubble and hints. |
| 🎙️ **Voice Transcribe** (`muse-voice-transcribe-1.0`) | Turns "Pakkun, sit" into a trick, only while you hold ⌥ Space. |

<a id="privacy"></a>

## 🔒 Cute, never creepy

> **Screen and voice off means zero network calls. Not one.**

- 🙅 **Everything is opt-in.** Screen awareness and voice are off by default, each explained before you turn it on.
- 💾 **Nothing is saved.** No screen captures, no recorded audio. Only your pets and settings are kept. Your Meta key lives in the macOS Keychain, never in a file.
- 👀 **He sees very little.** Only your front Terminal's text and the list of open windows. Never a screenshot of your screen.
- 🏢 **Work-laptop friendly.** An admin file can lock screen and voice off for a whole team ([docs/ENTERPRISE.md](docs/ENTERPRISE.md)).
- 🧘 **Respects Reduce Motion.** Follows the macOS setting automatically.

<div align="center">
<img src="docs/meet-your-pet.png" alt="Meeting Pakkun: English Cream Golden Retriever, Gentle, Goofy, Foodie" width="300">
&nbsp;&nbsp;
<img src="docs/screen-consent.png" alt="Let Pakkun notice things? consent window" width="300">
</div>

## 🏠 Bring him home

1. Download `PixyPup-0.1.0-arm64.dmg` from [Releases](https://github.com/BbekShr/pixypup/releases) and open it.
2. Drag Pakkun onto the Applications folder ("Drag me home").
3. **First open only:** right-click PixyPup in Applications, choose **Open**, then **Open** again. It's an indie app signed ad hoc, not notarised by Apple yet, so a plain double-click is refused once. After that it opens normally.

There's no Dock icon: look for your pet on the desktop floor and the menu bar icon.

**Permissions.** None at install. macOS asks later, once each, and only when you turn a feature on: Automation (to read your front Terminal) for "Notice my screen", and the microphone for "Listen for my voice".

**Uninstall.** Drag PixyPup to the Trash, then delete `~/Library/Application Support/PixyPup` (your pets and settings).

<a id="build"></a>

## 🛠️ Build it yourself

```bash
nvm use          # Node 22
npm install
npm run dev      # launch the app
```

```bash
npm run typecheck && npm run lint && npm test && npm run build   # the gates
npm run pose-test       # try the pose pipeline
npm run build-native    # compile native/pixyhelper.swift
npm run dist            # mac dmg (ad-hoc signed), written to release/
npm run make-art        # regenerate the app icon and DMG background
```

<details>
<summary><b>📖 The fine print: every feature in detail</b></summary>

### Make your own pet
On first launch a small welcome window offers to turn a photo of your dog or cat into a pet (right-click the pet, "Make a new pet…", any time). While the pet is drawn the photo melts into the cutout and poses pop in; at the end the window shrinks to the floor, the old pet trots off, and the new one drops in and says hi. Rehearse without a key: `PIXY_FAKE_PIPELINE=1 PIXY_FAKE_FAST=1 npm run dev` (dev builds only).

### Little moments
Hover over your pet and it turns to look at you. Move the cursor back and forth over it to pet it: a happy wiggle and a few hearts. It yawns before a nap and stretches when it wakes. All of this is off when macOS "Reduce motion" is on.

### Calm and control
Right-click the pet (or use the menu bar icon) to Snooze it (1 hour, or until 8:00 tomorrow), change its Size (110/140/180 px) and Energy (sleepy/normal/playful), keep it in place, hide it from screen sharing (off by default), or open it at login (off by default). Choices persist in settings.json; a snoozed pet does no animation work at all. "PixyPup Overload!" (pet menu or menu bar icon) drops every saved pet, duplicated up to 24, over the screen for 25 seconds of cute chaos: it never takes a click, ends by itself, and "End the overload" in the menu bar stops it early.

### Notice my screen
Off by default; turn it on from the pet's right-click menu ("Notice my screen"), after a short explainer. Then he can notice a failing test in your front Terminal (he runs to it, sniffs and barks a line; click him within 2 minutes for a short Muse Spark hint about why it failed; rerun until it's green and he rolls over and cheers), a new notification badge in your Dock, from Mail, Messages, Slack or any app (he perks up), or a Zoom/Meet window (he hides at the screen edge until the call ends). He reads only the front Terminal's text and the list of open windows; nothing is saved, and the one failing line is sent to Meta's model only to word his speech bubble (no key means he uses his own lines). A hint is sent only when you click him for one: up to 16 lines of that failure (1,200 characters), once, held in memory for 5 minutes and never saved. macOS asks once to let PixyPup control Terminal. Turn it off by unchecking the menu item; it also pauses while snoozed, and an organisation's admin file can lock it off. Staging the video: `docs/DEMO.md`. Rehearse without any permission: `PIXY_FAKE_SCREEN=1 npm run dev`, then `__pixyDebug.pref('screen:yes')` in the overlay's devtools (dev builds only); `__pixyDebug.pref('screen:fake:pass')` turns the scripted terminal green and `screen:fake:fail` back.

"Show what Pakkun sees" (right-click menu, off at every launch) pops a small card in the top-right corner: whether he is looking and why not, the failing line he found (80 characters, shown only on that card, never saved), the Dock badge, call, his decision and bubble, and a dashed box around the line for 3 seconds.

### Listen for my voice
Off by default; turn it on from the right-click menu ("Listen for my voice"), after a short explainer. Then press ⌥ Space and say "Pakkun, sit" (also roll over, go to bed, come here, bark). He listens for up to 4 seconds, or until you stop talking, or until you press again; the microphone is on only during that window. The audio goes to Meta's speech model just for that moment and nothing is saved. macOS asks once for the microphone. It stops while snoozed, and an organisation's admin file can lock it off. Rehearse without a mic or key (dev builds): `PIXY_FAKE_MIC=<24 kHz 16-bit mono WAV> npm run dev`, then `__pixyDebug.pref('voice:fake:Pakkun, sit')` and `__pixyDebug.pref('voice:listen')`.

</details>

---

<div align="center">

<img src="assets/pets/Pakkun/sleep.png" width="110" alt="Pakkun napping">

**Made with 🐾 for the Meta Global AI Developer Hackathon 2026.**<br>
<sub>All code written from Oct 31 2026. Electron + TypeScript, with a tiny Swift helper.</sub>

</div>
