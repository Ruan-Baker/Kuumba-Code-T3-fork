# Task 01 — Fork & Setup

## Objective

Fork the T3 Code repo, clone it locally, set up upstream tracking, install dependencies, and verify the app builds and runs.

## Prerequisites

- Git installed
- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- Node.js 18+ installed
- GitHub account with SSH or HTTPS access

## Steps

### 1. Fork on GitHub

Go to https://github.com/pingdotgg/t3code and click "Fork".

- Fork to: `YOUR_GITHUB_USERNAME/t3code`
- Uncheck "Copy the main branch only" (we want all tags for version tracking)

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/t3code.git
cd t3code
```

### 3. Add Upstream Remote

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
```

Verify remotes:

```bash
git remote -v
# origin    https://github.com/YOUR_GITHUB_USERNAME/t3code.git (fetch)
# origin    https://github.com/YOUR_GITHUB_USERNAME/t3code.git (push)
# upstream  https://github.com/pingdotgg/t3code.git (fetch)
# upstream  https://github.com/pingdotgg/t3code.git (push)
```

### 4. Create Your Custom Branch

```bash
git checkout -b custom/my-build
git push -u origin custom/my-build
```

All customizations happen on this branch. Upstream `main` stays clean for easy merging.

### 5. Install Dependencies

```bash
bun install
```

### 6. Verify the App Builds & Runs

```bash
bun run dev:desktop
```

The app should launch as an Electron window. Close it once confirmed.

### 7. Understand the Build Commands

```bash
# Development (hot reload):
bun run dev:desktop

# Production build (creates distributable):
# Check apps/desktop/package.json scripts section for the exact command
# Typically something like:
cd apps/desktop && bun run build
```

## Done Criteria

- [ ] Fork exists on your GitHub account
- [ ] Cloned locally with `upstream` remote configured
- [ ] `custom/my-build` branch created and pushed
- [ ] `bun install` completes without errors
- [ ] `bun run dev:desktop` launches the Electron app successfully
