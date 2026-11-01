#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p native/bin
swiftc -O native/pixyhelper.swift -o native/bin/pixyhelper
echo "built native/bin/pixyhelper"
