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

The build is ad-hoc signed (no Apple Developer ID). After copying PixyPup.app to Applications, right-click it and choose Open the first time.

All code written from Oct 31 2026 for the Meta Global AI Developer Hackathon.

## Make your own pet
On first launch a small welcome window offers to turn a photo of your dog or cat into a pet (right-click the pet, "Make a new pet…", any time). While the pet is drawn the photo melts into the cutout and poses pop in; at the end the window shrinks to the floor, the old pet trots off, and the new one drops in and says hi. Rehearse without a key: `PIXY_FAKE_PIPELINE=1 PIXY_FAKE_FAST=1 npm run dev` (dev builds only).

## Calm and control
Right-click the pet (or use the menu bar icon) to Snooze it (1 hour, or until 8:00 tomorrow), change its Size (110/140/180 px) and Energy (sleepy/normal/playful), keep it in place, hide it from screen sharing (off by default), or open it at login (off by default). Choices persist in settings.json; a snoozed pet does no animation work at all.
