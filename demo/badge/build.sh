#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="bin/Pack Chat.app"
rm -rf "$app" && mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O badge/BadgeDemo.swift -o "$app/Contents/MacOS/Pack Chat"
set="$(mktemp -d)/chat.iconset"; mkdir -p "$set"
for s in 16 32 128 256 512; do
  sips -z $s $s stage/chat-icon.png --out "$set/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d stage/chat-icon.png --out "$set/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o "$app/Contents/Resources/chat.icns"
cat > "$app/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Pack Chat</string>
<key>CFBundleExecutable</key><string>Pack Chat</string>
<key>CFBundleIdentifier</key><string>dev.pixypup.packchat</string>
<key>CFBundleIconFile</key><string>chat</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
P
codesign --force --sign - "$app" >/dev/null 2>&1 || true
echo "built demo/$app"
