# Kuumba Code — Phase 2 Feature Planning

> This document is a thinking guide, not an implementation spec. Use it as context to help plan architecture, discover the right patterns in the codebase, and make decisions before writing code.

> **Context:** Kuumba Code is our custom fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Phase 1 (rebrand to "Kuumba Code", Piper TTS read-aloud, auto-update pipeline) is complete. This doc covers Phase 2 features.

---

## What We're Building (Big Picture)

We're extending Kuumba Code with four connected features:

1. **Project Notes** — A scratch pad per project (notes, to-dos, checklists) saved in the repo
2. **Remote Sessions** — Access sessions running on one machine from another machine
3. **Auth** — Simple email code login so devices can identify each other securely
4. **Mobile Companion App** — Lightweight Android app to interact with sessions on the go

---

## Feature 1: Project Notes

### The Idea

Each project in the sidebar gets a notes button (alongside the existing "new thread" button) that appears on hover. Clicking it opens a floating popover anchored to the sidebar — not a full page, just a nice panel that floats over the main content.

Inside the popover:
- **Free-form text notes** — just type and it saves. Markdown or plain text, whichever is simpler.
- **Checklist to-dos** — add items, check them off, reorder them. Think quick task list, not a project management tool.
- **It's a scratch pad** — dump ideas, track what needs doing, jot down decisions. Nothing fancy.

### Where It Saves

The notes save as a file inside the project repo itself — something like `.kuumbacode/notes.json` or `.kuumbacode/notes.md` in the project root. This means:
- Notes travel with the project (git tracked if the user wants)
- Opening the same project on another machine pulls the notes through
- No external database needed
- Adding `.kuumbacode/` to `.gitignore` is the user's choice

### Things to Figure Out

- What UI component library does Kuumba Code use for popovers? (ShadCN has a Popover component — check if it's already in the project)
- How does the app currently read/write to the project directory? (The server has file system access — the notes would save through the same mechanism)
- What's the sidebar component structure? Where does the project hover state and "new thread" button live?
- Should notes auto-save on every keystroke (debounced) or have a save button?
- For the checklist: simple array of `{ id, text, done }` objects is probably enough

### Conflict Risk

Very low. We're adding a new button to the sidebar project hover state and a new component. The notes file lives in the user's repo, not in the app's codebase.

---

## Feature 2: Remote Sessions

### The Idea

Kuumba Code's sidebar gets a structural change: sessions are organized under **Local** and **Remote** tabs/sections.

**Local** — exactly what exists today. Sessions running on this machine.

**Remote** — sessions from your other machines (desktop, MacBook, etc.) that have been marked as remotely accessible.

### How Remote Access Works

- **Tailscale** creates a private encrypted network between all your devices. Each device gets a stable IP (like `100.64.x.x`). No port forwarding, no public URLs. Free for personal use.
- **Convex** acts as a lightweight registry/phonebook. Each machine running Kuumba Code pings Convex every ~30 seconds with "I'm alive at this Tailscale IP, here are my remote-enabled sessions." Other devices query Convex to discover what's available.
- When you click a remote session on your MacBook, Kuumba Code connects directly to your desktop's server over Tailscale and loads that session. Your MacBook becomes a thin client — the agent, files, and terminal still run on the desktop.

### The Green/Red Dot System

- Right-click a local session → "Enable Remote Access" → green dot appears
- Session metadata gets pushed to Convex (session name, project, device, status)
- Other devices see it appear in their Remote section
- Click again or right-click → "Disable Remote Access" → red dot, removed from Convex
- Default is local-only (no dot or red dot). Opt-in to remote.

### Things to Figure Out

- How does the Kuumba Code server expose its API? (HTTP? WebSocket? Both?) What port?
- Can we connect a second frontend instance to an already-running server session?
- What data does Convex need to store? Minimal: `{ deviceId, deviceName, tailscaleIp, serverPort, lastSeen, sessions: [{ id, name, project, status }] }`
- How does the sidebar currently render? Is it a single flat list or already grouped?
- Does the existing session/thread model support being "observed" by a remote client, or would messages need to be relayed?

### Tailscale Setup

- Install Tailscale on each machine (desktop, MacBook, phone)
- All join the same Tailnet (your personal account)
- Each machine gets a stable hostname like `desktop.tailnet-name.ts.net`
- The Kuumba Code server listens on its normal port, Tailscale handles the secure routing
- No code changes needed for Tailscale itself — it's a system-level VPN

---

## Feature 3: Auth (Lucia + Resend)

### The Idea

Simple email-based auth. You open Kuumba Code, enter your email, get a 6-digit code via Resend, enter it, you're logged in. A session token gets stored locally and used for all connections.

### Why We Need It

- So remote connections are authenticated (only you can access your sessions)
- So the mobile app can prove it's you
- So Convex knows which devices belong to you

### Architecture

- **Lucia** handles session management (create session, validate session, expire session)
- **Resend** sends the magic code email
- **Convex** stores the user record and active sessions (just your email + device tokens)
- The auth flow: enter email → Convex function generates code + sends via Resend → enter code → Convex validates → returns session token → stored locally

### Things to Figure Out

- Does Convex have built-in auth helpers, or do we wire Lucia manually?
- Where does the login screen live? A gate before the main app loads?
- How does the desktop app store the session token? (Electron's `safeStorage` or just a local file)
- Should the token be long-lived (days/weeks) or require re-auth frequently?
- For single-user: do we even need a users table, or just a single allowed email in an env var?

### Simplification for Single User

Since it's just Ruan (single user), the auth can be dead simple:
- Hardcode the email as the only allowed user (env var: `ALLOWED_EMAIL=...`)
- Convex stores active device sessions, not a full user system
- No signup flow, no password, no OAuth — just email code

---

## Feature 4: Mobile Companion App

### The Idea

A lightweight Android app built with the existing React components from Kuumba Code's `apps/web/`, first tested as a **web app in the browser**, then wrapped with Capacitor and distributed through Google Play (internal testing) via Codemagic.

### What It Does

- **Sessions list** — shows all devices and their sessions (from Convex registry). Grouped by device. Tap to open.
- **New session** — pick a device + project, start a fresh session. The command goes to that device's server.
- **Chat view** — full message thread for a session. Send messages, see AI responses, TTS read-aloud button, model switcher. Approve/reject agent actions.
- **No dev tools** — no file explorer, no diff viewer, no inline terminal, no code editor panels. Just the conversation and controls.
- **Auth** — same Lucia + Resend login as desktop.

### Build Sequence (Important)

1. **Build as a web app first** — create `apps/mobile/` as a standard Vite + React app
2. **Test in the browser** — use mobile viewport sizes, verify all components render correctly, test the full flow (login → sessions → chat → TTS)
3. **Only then add Capacitor** — wrap the working web app for Android
4. **Deploy via Codemagic** → Google Play internal testing

Do NOT wrap with Capacitor until the web app is fully working in the browser.

### Tech Stack

- `apps/mobile/` — new app in the monorepo
- Vite + React + TypeScript (same as `apps/web/`)
- Reuses: ShadCN components, Tailwind theme, Lucide icons, markdown renderer, ReadAloudButton + TTS engine from Kuumba Code
- Capacitor wraps it for Android (added after browser testing is complete)
- Connects to device servers over Tailscale

### Component Reuse Strategy

Don't import from `apps/web/` directly (that creates coupling and build complexity). Instead:
- Copy the shared components you need into `apps/mobile/src/components/`
- Or better: extract truly shared components into a new `packages/ui/` shared package that both web and mobile import from
- The TTS code (`lib/tts/`) can be shared directly — it's browser-based and Capacitor runs a real browser

### Build & Distribution

- **Codemagic** — connects to GitHub, builds the Capacitor Android project, signs the APK/AAB
- **Google Play Internal Testing** — upload via Codemagic, install on your phone immediately, no review needed
- Trigger: push to `custom/my-build` with changes in `apps/mobile/`

### Things to Figure Out

- Which components from `apps/web/` are the ones we actually need? (Message bubble, markdown renderer, composer input, model selector, approval bar)
- How does the existing chat/messaging work? What's the WebSocket/API contract for subscribing to a session's messages?
- Does Capacitor's WebView support the Web Speech API and WASM (for Piper TTS)?
- What's the responsive breakpoint situation — do existing components handle narrow widths at all, or do we need mobile-specific layouts?

---

## Implementation Sequence

```
Phase 1 (DONE):
  Fork → Rebrand to "Kuumba Code" → Piper TTS → Auto-Update Pipeline

Phase 2A — Project Notes:
  Standalone feature, no external dependencies.
  Can be built immediately. Good warmup for understanding the sidebar.

Phase 2B — Auth + Convex Setup:
  Set up Convex project, define schema, implement Lucia auth flow.
  Required before remote sessions or mobile app.

Phase 2C — Remote Sessions:
  Install Tailscale on devices.
  Add device heartbeat to Convex.
  Add Local/Remote sidebar sections.
  Add green/red dot remote toggle.
  Add remote session viewer (thin client connecting over Tailscale).

Phase 2D — Mobile App:
  Scaffold apps/mobile/ with Vite + React.
  Build login, sessions list, chat view.
  TEST AS WEB APP IN BROWSER FIRST.
  Then add Capacitor wrapper.
  Set up Codemagic pipeline.
  Deploy to Google Play internal testing.

Future:
  Watch app (native, voice-focused)
  CarPlay/Android Auto (audio + voice interface)
```

---

## Convex Schema (Starting Point for Discussion)

```
devices:
  - deviceId: string (unique, generated on first launch)
  - deviceName: string ("Desktop — Secunda", "MacBook Pro")
  - ownerEmail: string
  - tailscaleIp: string
  - serverPort: number
  - lastSeen: number (timestamp)
  - isOnline: boolean (computed from lastSeen)

remoteSessions:
  - sessionId: string
  - deviceId: string (references devices)
  - projectName: string
  - projectPath: string
  - status: "idle" | "working" | "waiting_approval" | "error"
  - lastMessage: string (preview text)
  - updatedAt: number

authTokens:
  - token: string
  - email: string
  - deviceId: string
  - createdAt: number
  - expiresAt: number
```

This is a conversation starter, not a final schema. The actual shape depends on what we discover about Kuumba Code's existing session model.
