# PixyPup

PixyPup is a desktop pet for macOS. A little dog walks along the bottom of your screen on a transparent, click-through overlay, reacts to what you are doing (when you opt in), and obeys voice commands. Screen awareness and voice are off by default, and nothing leaves your machine unless you turn them on.

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
