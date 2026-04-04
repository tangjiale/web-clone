#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  exec "$ROOT_DIR/node_modules/.bin/electron" "$ROOT_DIR" "$@"
fi

APP_NAME="网站分身管理器"
APP_ID="com.webclone.manager.dev"
SHELL_VERSION="1"
ELECTRON_DIST_DIR="$ROOT_DIR/node_modules/electron/dist"
TEMPLATE_APP="$ELECTRON_DIST_DIR/Electron.app"
ICON_SOURCE="$ROOT_DIR/build-resources/icons/icon.icns"
DEV_SHELL_DIR="$ROOT_DIR/.dev-shell"
DEV_APP="$DEV_SHELL_DIR/$APP_NAME.app"
DEV_APP_PLIST="$DEV_APP/Contents/Info.plist"
DEV_APP_EXECUTABLE="$DEV_APP/Contents/MacOS/$APP_NAME"
DEV_SHELL_STAMP="$DEV_SHELL_DIR/.bundle-stamp"

if [[ ! -d "$TEMPLATE_APP" ]]; then
  echo "Electron.app template not found: $TEMPLATE_APP" >&2
  exit 1
fi

mkdir -p "$DEV_SHELL_DIR"

ICON_HASH="$(shasum -a 256 "$ICON_SOURCE" | awk '{print $1}')"
ELECTRON_VERSION="$(cat "$ELECTRON_DIST_DIR/version")"
DESIRED_STAMP="$SHELL_VERSION:$ELECTRON_VERSION:$ICON_HASH"
CURRENT_STAMP="$(cat "$DEV_SHELL_STAMP" 2>/dev/null || true)"

if [[ ! -d "$DEV_APP" || "$CURRENT_STAMP" != "$DESIRED_STAMP" ]]; then
  rm -rf "$DEV_APP"
  cp -R "$TEMPLATE_APP" "$DEV_APP"

  rm -f "$DEV_APP_EXECUTABLE"
  mv "$DEV_APP/Contents/MacOS/Electron" "$DEV_APP_EXECUTABLE"
  cp "$ICON_SOURCE" "$DEV_APP/Contents/Resources/icon.icns"

  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$DEV_APP_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$DEV_APP_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP_NAME" "$DEV_APP_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_ID" "$DEV_APP_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$DEV_APP_PLIST"

  printf '%s' "$DESIRED_STAMP" > "$DEV_SHELL_STAMP"
fi

WEB_CLONE_DEV=1 \
WEB_CLONE_DEV_SERVER_URL="http://127.0.0.1:1420" \
exec "$DEV_APP_EXECUTABLE" "$ROOT_DIR" "$@"
