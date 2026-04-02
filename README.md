# Running Log Tracker

My 12 yr old brother wanted to make an app to track his running process - felt like Strava was so socially oriented.

So I helped him build this.

## Getting the app running

### One dev server (not two)

`npm run dev` starts a **single** Node process: Express serves the API and, in development, runs Vite inside the same server. Default URL is **http://localhost:3003** (override with `PORT` in `.env`).

You do **not** need a separate `vite` terminal unless you change the project to split them.

### Environment

1. Copy `.env.example` to `.env`.
2. Fill in Supabase, optional Anthropic/Strava keys as needed (see comments in `.env.example`).

### Web / API (browser)

```bash
npm install
npm run dev
```

Open http://localhost:3003 in the browser.

### iOS (Xcode + Simulator / device)

Capacitor is configured to load the app from the dev server (`server.url` → `http://localhost:3003` in `capacitor.config.ts`), so the simulator/device WebView talks to whatever is running from `npm run dev`.

1. **Terminal 1:** `npm run dev` (keep it running).
2. **First time or after native/plugin changes:** sync the native project, then open Xcode:

   ```bash
   npx cap sync ios
   npx cap open ios
   ```

   `npx cap open ios` opens the iOS workspace in Xcode. After that you can open the project from Xcode directly if you prefer.

3. In Xcode, pick a simulator or your device and run (▶).

If you only changed **web** code, you usually just refresh or re-run the app; `cap sync` is mainly for native dependencies, `capacitor.config.ts` changes, or new plugins.

### Quick reference

| Goal | Command |
|------|---------|
| Dev (API + React) | `npm run dev` |
| Sync web build + native deps to iOS | `npx cap sync ios` |
| Open iOS project in Xcode | `npx cap open ios` |
| Production build | `npm run build` then `npx cap sync ios` before archiving |
