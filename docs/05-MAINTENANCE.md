# Task 05 — Ongoing Maintenance

## Objective

Routine for syncing upstream T3 Code releases into your fork, keeping your custom features intact.

## The Sync Routine (5-10 minutes)

Run this whenever pingdotgg releases a new version:

```bash
# 1. Fetch upstream changes
git fetch upstream

# 2. Switch to your custom branch
git checkout custom/my-build

# 3. Merge upstream main into your branch
git merge upstream/main
```

### If No Conflicts (99% of the time):

```bash
# 4. Install any new/updated dependencies
bun install

# 5. Quick test
bun run dev:desktop
# Verify: app runs, your custom name shows, TTS button works

# 6. Bump version and push to trigger auto-update build
npm version patch -m "Sync upstream + release %s"
git push origin custom/my-build --tags

# Done. GitHub Actions builds. Your app auto-updates.
```

### If There Are Merge Conflicts:

```bash
# Git will tell you which files have conflicts
git status

# Open each conflicting file and resolve
# Conflicts look like:
# <<<<<<< HEAD (your changes)
# your code here
# =======
# their code here
# >>>>>>> upstream/main

# After resolving all conflicts:
git add .
git merge --continue

# Then continue with steps 4-6 above
```

## What Could Conflict (and How to Fix)

| Your Change                                 | Their Change                        | Likelihood | Fix                                                        |
| ------------------------------------------- | ----------------------------------- | ---------- | ---------------------------------------------------------- |
| branding.ts (app name)                      | They update branding.ts             | Very low   | Keep your values, accept their structural changes          |
| Desktop package.json (productName, publish) | They update build config            | Low        | Keep your name/publish, accept their other changes         |
| Theme colors (CSS/Tailwind)                 | They redesign the theme             | Low        | Re-apply your color values to their new theme structure    |
| Message component (+3 lines for TTS)        | They refactor the message component | Medium     | Re-add your 3 lines (import + render) to the new structure |
| TTS files (lib/tts/\*, ReadAloudButton)     | N/A — they'll never touch these     | **Zero**   | No action needed                                           |

## Quick Conflict Resolution Cheatsheet

**For branding.ts / package.json conflicts:**
Accept the incoming structure but replace the values back to yours.

**For the message component conflict:**
If they refactored the component, just find where the assistant message renders in the new structure and re-add:

```tsx
import { ReadAloudButton } from "./ReadAloudButton";
// ... then in the render, after the message content:
{
  message.role === "assistant" && (
    <div className="mt-1">
      <ReadAloudButton content={message.text} />
    </div>
  );
}
```

## Monitoring Upstream Releases

### Option A: Watch on GitHub

Go to https://github.com/pingdotgg/t3code → Click "Watch" → "Releases only"
You'll get email notifications for each new release.

### Option B: Check Manually

```bash
git fetch upstream --tags
git log --oneline upstream/main -10
```

## Emergency: If Your Fork Gets Too Far Behind

If you haven't synced in a while and there are many conflicts:

```bash
# Nuclear option: rebase your changes onto the latest upstream
git checkout custom/my-build
git rebase upstream/main

# This replays your commits on top of their latest
# You may need to resolve conflicts commit-by-commit
# After resolving:
git push origin custom/my-build --force-with-lease
```

⚠️ Force push rewrites history — only do this on your personal fork.

## Summary

The routine in 6 commands:

```bash
git fetch upstream
git checkout custom/my-build
git merge upstream/main
bun install
npm version patch -m "Sync upstream + release %s"
git push origin custom/my-build --tags
```

That's it. Your app auto-updates from your fork's releases.
