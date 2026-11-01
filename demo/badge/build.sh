#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="bin/Badge Demo.app"
rm -rf "$app" && mkdir -p "$app/Contents/MacOS"
swiftc -O badge/BadgeDemo.swift -o "$app/Contents/MacOS/Badge Demo"
cat > "$app/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Badge Demo</string>
<key>CFBundleExecutable</key><string>Badge Demo</string>
<key>CFBundleIdentifier</key><string>dev.pixypup.badgedemo</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
P
codesign --force --sign - "$app" >/dev/null 2>&1 || true
echo "built demo/$app"
