#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$PROJECT_ROOT/.build/macos"
STAGED_APP="$BUILD_ROOT/AI Council.app"
OUTPUT_APP="$PROJECT_ROOT/dist/AI Council.app"
CONTENTS="$STAGED_APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"
NODE_BINARY="$(command -v node)"
SWIFT_TARGET="$(uname -m)-apple-macos13.0"

# Resolve the model CLIs the same way the chatroom does, so the app's PATH
# includes tools that are installed but absent from this shell's PATH (Codex
# ships inside ChatGPT.app). A missing CLI must not abort the build: the app
# still runs and reports that one agent is unavailable.
AGENT_DIRS="$("$NODE_BINARY" --input-type=module -e "
import { agentBinaryDirectories, resolveAgentBinaries } from '$PROJECT_ROOT/scripts/agent-binaries.mjs';
for (const [name, binary] of Object.entries(resolveAgentBinaries())) {
  if (!binary) console.error(\`Warning: '\${name}' was not found; that agent will be unavailable in the app.\`);
}
console.log(agentBinaryDirectories().join(':'));
")"
TOOL_PATH="$(dirname "$NODE_BINARY")"
[[ -n "$AGENT_DIRS" ]] && TOOL_PATH="$TOOL_PATH:$AGENT_DIRS"
TOOL_PATH="$TOOL_PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ "$OUTPUT_APP" != "$PROJECT_ROOT/dist/AI Council.app" ]]; then
  echo "Unexpected app output path." >&2
  exit 2
fi

rm -rf "$BUILD_ROOT"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$PROJECT_ROOT/dist"

xcrun swiftc \
  -swift-version 5 \
  -module-cache-path "$BUILD_ROOT/ModuleCache" \
  -parse-as-library \
  -target "$SWIFT_TARGET" \
  -O \
  -framework AppKit \
  -framework Security \
  -framework WebKit \
  "$PROJECT_ROOT/macos/AICouncilApp/AppDelegate.swift" \
  -o "$MACOS_DIR/AICouncil"

cp "$NODE_BINARY" "$MACOS_DIR/node"
NODE_LIBRARY_DIR="$(cd "$(dirname "$(realpath "$NODE_BINARY")")/../lib" && pwd)"
install_name_tool -add_rpath "$NODE_LIBRARY_DIR" "$MACOS_DIR/node"

cp "$PROJECT_ROOT/macos/Info.plist" "$CONTENTS/Info.plist"

CONFIG_PLIST="$RESOURCES_DIR/AppConfig.plist"
plutil -create xml1 "$CONFIG_PLIST"
plutil -insert WorkspacePath -string "$PROJECT_ROOT" "$CONFIG_PLIST"
plutil -insert NodePath -string "$NODE_BINARY" "$CONFIG_PLIST"
plutil -insert ToolPath -string "$TOOL_PATH" "$CONFIG_PLIST"

ICON_GENERATOR="$BUILD_ROOT/IconGenerator"
ICON_BASE="$BUILD_ROOT/AppIcon-1024.png"
ICONSET="$BUILD_ROOT/AppIcon.iconset"
xcrun swiftc \
  -swift-version 5 \
  -module-cache-path "$BUILD_ROOT/ModuleCache" \
  -target "$SWIFT_TARGET" \
  -O \
  -framework AppKit \
  "$PROJECT_ROOT/macos/AICouncilApp/IconGenerator.swift" \
  -o "$ICON_GENERATOR"
"$ICON_GENERATOR" \
  "$PROJECT_ROOT/public/logos/claude.svg" \
  "$PROJECT_ROOT/public/logos/codex.svg" \
  "$PROJECT_ROOT/public/logos/gemini.svg" \
  "$ICON_BASE"

mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_BASE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_BASE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
if ! iconutil -c icns "$ICONSET" -o "$RESOURCES_DIR/AppIcon.icns"; then
  EXISTING_ICON="$OUTPUT_APP/Contents/Resources/AppIcon.icns"
  if [[ ! -f "$EXISTING_ICON" ]]; then
    echo "Unable to build AppIcon.icns and no existing icon is available." >&2
    exit 1
  fi
  cp "$EXISTING_ICON" "$RESOURCES_DIR/AppIcon.icns"
fi

codesign --force --deep --sign - "$STAGED_APP" >/dev/null
rm -rf "$OUTPUT_APP"
mv "$STAGED_APP" "$OUTPUT_APP"
touch "$OUTPUT_APP"

echo "Built: $OUTPUT_APP"
