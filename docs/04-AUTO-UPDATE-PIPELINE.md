# Task 04 — Auto-Update Pipeline

## Objective

Configure your fork so that:

1. Your installed app checks **your** GitHub Releases for updates (not pingdotgg's)
2. A GitHub Action automatically builds and publishes releases when you push a version tag
3. You install the app once — all future updates arrive automatically

## Step 1: Point Electron-Updater at Your Fork

**File: `apps/desktop/package.json`**

Find the `build` section and update (or add) the `publish` config:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "YOUR_GITHUB_USERNAME",
      "repo": "t3code",
      "releaseType": "release"
    }
  }
}
```

This tells `electron-updater` to check `github.com/YOUR_GITHUB_USERNAME/t3code/releases` for new versions.

### Verify the Updater Code

Check `apps/desktop/src/main.ts` for the auto-update setup. It likely uses `electron-updater`'s `autoUpdater`. Confirm it reads from the `publish` config in package.json (this is the default behavior — you usually don't need to change the TypeScript code).

```bash
grep -n "autoUpdater\|electron-updater" apps/desktop/src/main.ts
```

If they hardcoded a custom update URL, override it to use the package.json publish config.

## Step 2: Examine Existing CI Workflow

T3 Code already has a GitHub Actions workflow that builds releases. Check:

```bash
ls .github/workflows/
cat .github/workflows/*.yml
```

Look for the workflow that:

- Triggers on tag pushes (`on: push: tags: ['v*']`)
- Runs electron-builder for Mac/Windows/Linux
- Publishes to GitHub Releases
- Generates `latest.yml` / `latest-mac.yml` / `latest-linux.yml`

### Typical Workflow Structure

```yaml
name: Build & Release

on:
  push:
    tags:
      - "v*"

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build # in apps/desktop
      - name: Publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx electron-builder --publish always
```

## Step 3: Adapt the Workflow for Your Fork

If the existing workflow works on tag pushes, you may only need to:

1. **Ensure the trigger matches your branch/tags:**

   ```yaml
   on:
     push:
       tags:
         - "v*"
   ```

2. **Verify `GH_TOKEN` is available:**
   GitHub automatically provides `GITHUB_TOKEN` in Actions. However, if the workflow uses a custom secret name (like `GH_TOKEN` or `PERSONAL_TOKEN`), you need to:
   - Go to your fork → Settings → Secrets and variables → Actions
   - Add a secret named `GH_TOKEN` with a GitHub Personal Access Token (PAT)
   - The PAT needs `repo` scope (to publish releases)

3. **If the workflow references `pingdotgg` anywhere**, update to your username

4. **If the workflow only runs on `main` branch**, update to include your branch:
   ```yaml
   on:
     push:
       branches: [main, custom/my-build]
       tags: ["v*"]
   ```

## Step 4: Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens?type=beta (Fine-grained tokens)
2. Generate new token:
   - Name: `t3code-fork-releases`
   - Repository access: Only select repositories → your t3code fork
   - Permissions: Contents (Read and write), Actions (Read and write)
3. Copy the token
4. Go to your fork → Settings → Secrets and variables → Actions
5. Add new repository secret: `GH_TOKEN` = your token

## Step 5: Test the Pipeline

### Tag and push a test release:

```bash
# Make sure you're on your custom branch with all changes committed
git checkout custom/my-build

# Bump version (updates package.json version field)
npm version patch -m "Release %s"

# Push the commit and tag
git push origin custom/my-build --tags
```

### Watch the workflow:

1. Go to your fork → Actions tab
2. You should see a workflow run triggered by the tag push
3. Wait for it to complete (can take 10-20 minutes for multi-platform builds)
4. Check your fork → Releases — you should see a new release with:
   - `.dmg` (macOS ARM + Intel)
   - `.exe` / NSIS installer (Windows)
   - `.AppImage` (Linux)
   - `latest.yml`, `latest-mac.yml`, `latest-linux.yml`

### Install and verify auto-update:

1. Download and install from your release
2. Push another version bump + tag
3. Wait for the new release to publish
4. Your installed app should notify you of the update (or auto-install it)

## Troubleshooting

### "Actions workflow doesn't trigger"

- Check that your tag matches the trigger pattern (must start with `v`)
- Check the workflow file is on the branch you're pushing from

### "Build fails on macOS — code signing"

- For personal use, you can disable code signing by setting `CSC_IDENTITY_AUTO_DISCOVERY=false` in the workflow env
- Or remove `mac.identity` from electron-builder config

### "Release is created but auto-update doesn't work"

- Verify `latest.yml` exists in the release assets
- Check that `apps/desktop/package.json` → `build.publish` points to YOUR repo
- The app version must be LOWER than the release version for the update to trigger

### "GITHUB_TOKEN permission denied"

- Go to fork → Settings → Actions → General → Workflow permissions
- Set to "Read and write permissions"

## Done Criteria

- [ ] `apps/desktop/package.json` publish config points to your fork
- [ ] GitHub Action triggers on version tags
- [ ] Release is published with all platform builds + `latest.yml`
- [ ] Installed app detects and applies the update
