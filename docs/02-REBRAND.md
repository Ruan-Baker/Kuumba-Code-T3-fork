# Task 02 — Rebrand (Name, Icons, Colors)

## Objective

Change the app's display name, desktop/taskbar icon, and accent colors to create a personal branded version.

## Part A: Change the App Name

### Files to Modify

1. **`apps/desktop/package.json`** — Electron builder config

   ```json
   {
     "productName": "YOUR_APP_NAME",
     "build": {
       "appId": "com.yourname.yourappname",
       "productName": "YOUR_APP_NAME"
     }
   }
   ```

2. **`apps/web/src/branding.ts`** — UI branding constants
   - Open this file and find every exported string referencing "T3 Code" or "T3"
   - Replace with your app name
   - Example:
     ```typescript
     // Before:
     export const APP_NAME = "T3 Code";
     // After:
     export const APP_NAME = "YOUR_APP_NAME";
     ```

3. **`apps/web/index.html`** — Page title
   - Find `<title>T3 Code</title>` and replace with your name

### Discovery Step

Before making changes, scan for all hardcoded references:

```bash
grep -ri "t3 code\|t3code\|T3 Code\|T3Code" \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.html" \
  apps/ packages/
```

**Only change user-facing display strings.** Do NOT rename:

- Internal package names in `packages/` (causes import path breakage)
- GitHub-specific strings in CI workflows (unless needed for your fork)
- Any npm package `name` fields in workspace `package.json` files

## Part B: Replace App Icons

### Icon Files Location

`apps/desktop/resources/` — contains the app icons used by electron-builder.

### What You Need

Create your icon at **1024×1024 PNG** minimum, then generate:

| File        | Platform | How to Generate                                                     |
| ----------- | -------- | ------------------------------------------------------------------- |
| `icon.png`  | Linux    | Resize to 512×512 PNG                                               |
| `icon.ico`  | Windows  | Use https://icoconvert.com (include 16, 32, 48, 64, 128, 256 sizes) |
| `icon.icns` | macOS    | Use https://cloudconvert.com/png-to-icns                            |

### Steps

1. Place your new icon files in `apps/desktop/resources/`, replacing the existing ones with the **exact same filenames**
2. Check for a tray icon too:
   ```bash
   ls apps/desktop/resources/
   # Look for tray-icon.png or similar — replace if present
   ```
3. Check for web favicons:
   ```bash
   ls apps/web/public/
   # Replace favicon.ico, favicon.png, apple-touch-icon.png if present
   ```

### Verify

After replacing, run `bun run dev:desktop` and confirm:

- The app window shows your new icon in the title bar
- The taskbar/dock shows your new icon
- The app title shows your new name

## Part C: Adjust Theme Colors

### Discovery Step

Find where colors are defined:

```bash
# Check for Tailwind config
find apps/web -name "tailwind.config*" -o -name "tailwind.config.*"

# Check for CSS variables
grep -r "primary\|--accent\|--brand" --include="*.css" --include="*.ts" --include="*.tsx" apps/web/src/ | head -20

# Check ShadCN theme
cat apps/web/components.json 2>/dev/null
```

### Typical Change Locations

T3 Code likely uses ShadCN/ui with CSS variables. Look for a CSS file (often `globals.css` or `index.css`) with:

```css
:root {
  --primary: ...;
  --accent: ...;
  --background: ...;
}
```

Or a Tailwind config extending theme colors.

### Steps

1. Identify the theme source file (CSS variables or Tailwind config)
2. Change only the color values — keep the variable names identical
3. Test both **light and dark modes**
4. Keep changes to **one file** if possible to minimize merge conflict surface

### Color Change Tips

- Only change accent/brand colors, not structural colors (borders, backgrounds)
- If they use HSL values, keep the format consistent
- Don't scatter color overrides across component files

## Done Criteria

- [ ] App displays your custom name everywhere (title bar, UI headers, page title)
- [ ] Taskbar/dock shows your custom icon
- [ ] App window title bar shows your custom icon
- [ ] Accent colors reflect your preference
- [ ] Both light and dark modes look correct
- [ ] `bun run dev:desktop` runs without errors

## Merge Conflict Risk: LOW

You're touching 3-5 files with small, localized string/value changes. Upstream rarely changes branding or theme values.
