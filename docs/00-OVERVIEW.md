# T3 Code Custom Fork — Master Plan

## What We're Building

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with three customizations:

1. **Rebrand** — Custom app name, icon, and accent colors
2. **Read Aloud** — Piper TTS speaker button under each AI response (offline, free, natural voice)
3. **Auto-Update Pipeline** — GitHub Actions builds releases from your fork; your installed app auto-updates

## Task Files (Execute In Order)

| File                         | Task                                                      | Touches Upstream Files?       |
| ---------------------------- | --------------------------------------------------------- | ----------------------------- |
| `01-FORK-AND-SETUP.md`       | Fork repo, set up upstream remote, verify build           | No                            |
| `02-REBRAND.md`              | Change app name, replace icons, adjust theme colors       | Yes (minimal)                 |
| `03-TTS-FEATURE.md`          | Add Piper TTS read-aloud button to AI responses           | 1 existing file + 4 new files |
| `04-AUTO-UPDATE-PIPELINE.md` | Configure electron-updater + GitHub Actions for your fork | Yes (config only)             |
| `05-MAINTENANCE.md`          | Routine for syncing upstream releases into your fork      | Reference doc                 |

## Architecture Principle

**Isolation.** All custom code lives in new files/directories that upstream will never create. Only ~5 existing files get small, surgical edits. This minimizes merge conflicts when syncing upstream updates.

## Repo Structure Reference

```
t3code/
├── apps/
│   ├── desktop/               ← Electron shell
│   │   ├── resources/         ← App icons (icon.png, icon.ico, icon.icns)
│   │   ├── src/main.ts        ← Electron main process
│   │   ├── src/preload.ts     ← IPC bridge
│   │   └── package.json       ← electron-builder config (productName, appId, publish)
│   ├── web/                   ← Frontend (Vite + React)
│   │   ├── src/
│   │   │   ├── branding.ts    ← App name/branding constants
│   │   │   ├── components/    ← UI components (ChatView.tsx + sub-components)
│   │   │   ├── hooks/
│   │   │   ├── lib/           ← Utility libraries ← YOUR TTS CODE GOES HERE
│   │   │   └── routes/
│   │   ├── public/            ← Static assets (favicons, etc.)
│   │   ├── index.html
│   │   └── package.json
│   ├── server/                ← Backend (provider adapters, orchestration)
│   └── marketing/             ← Marketing site (ignore)
├── packages/                  ← Shared packages (contracts, types)
├── .github/workflows/         ← CI/CD pipelines
├── package.json               ← Root workspace config (Bun)
└── bun.lock
```

## Tech Stack

- **Monorepo**: Turborepo + Bun
- **Desktop**: Electron + electron-builder + electron-updater
- **Frontend**: Vite + React + TypeScript + Tailwind + ShadCN/ui + Lucide icons
- **TTS**: `@mintplex-labs/piper-tts-web` (Piper via WASM, runs in browser/Electron, offline)
