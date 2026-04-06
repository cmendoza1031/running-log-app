#!/bin/sh
set -e

# ── 1. Install Node dependencies ──────────────────────────────────────────────
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

# ── 2. Build the web app ──────────────────────────────────────────────────────
npm run build

# ── 3. Sync Capacitor assets into the iOS project ─────────────────────────────
npx cap sync ios --no-open

# ── 4. Install CocoaPods dependencies ─────────────────────────────────────────
cd "$CI_PRIMARY_REPOSITORY_PATH/ios/App"
pod install
