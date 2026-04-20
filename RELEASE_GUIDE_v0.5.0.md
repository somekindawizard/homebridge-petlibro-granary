# v0.5.0 Release Guide

End-to-end checklist for merging PR #3, bumping the version, and publishing
`homebridge-petlibro-granary@0.5.0` to npm from your Mac mini.

> **Repo location:** `~/Downloads/homebridge-petlibro-granary`
> **PR to merge:** [#3 -- UX improvements](https://github.com/somekindawizard/homebridge-petlibro-granary/pull/3)
> **Branch:** `ux-improvements`

---

## Status of open PRs

| PR | Title | State | Action |
|----|-------|-------|--------|
| #1 | Reliability + security pass | **closed** (merged to main) | Nothing |
| #2 | HomeKit UX overhaul (semantic types + emoji) | **closed** (superseded) | Nothing |
| #3 | UX improvements (configurable services + tests + pet naming) | **open** | **Merge this** |

Only **PR #3** needs to be merged. The reliability/security work from PR #1 is
already on `main`. PR #2 was a superseded approach -- the same UX goals are
achieved by PR #3 in a cleaner way.

---

## Step 1: Sync your local repo

```bash
cd ~/Downloads/homebridge-petlibro-granary

# Confirm you're at the right repo
git remote -v
# Expected: origin  https://github.com/somekindawizard/homebridge-petlibro-granary.git

# Make sure your working tree is clean
git status

# Fetch all remote branches and tags
git fetch --all --prune --tags

# Update main to latest
git checkout main
git pull origin main
```

If `git status` shows uncommitted changes, stash them first:
```bash
git stash push -m "wip before v0.5.0 release"
```

---

## Step 2: Review PR #3 locally

```bash
# Checkout the PR branch
git checkout ux-improvements
git pull origin ux-improvements

# See what changed vs main
git log --oneline main..ux-improvements
git diff main..ux-improvements --stat
```

Expected files changed:

| File | Purpose |
|------|---------|
| `config.schema.json` | Password masking, fieldset layout, `enabledServices` |
| `src/settings.ts` | `GranaryServiceKey` type, `ALL_GRANARY_SERVICES` |
| `src/accessories/granarySmartFeederAccessory.ts` | Conditional services, pet naming, `destroy()`, `ensureDisplayName()` |
| `src/devices/device.ts` | `primaryPetName` getter |
| `src/types/petlibroApi.ts` | `BoundPet` type, `// sic` comment |
| `src/platform.ts` | `destroy()` calls in shutdown + pruneOrphans |
| `src/__tests__/accessory.test.ts` | New test suite (25+ cases) |
| `README.md` | Badges, install section, service docs, what's new |
| `CHANGELOG.md` | v0.5.0 entry |

---

## Step 3: Bump the version to 0.5.0

The `package.json` on the branch is still at `0.4.0`. Bump it before publishing.

```bash
# While on ux-improvements branch
npm version 0.5.0 --no-git-tag-version
```

This updates `package.json` and `package-lock.json`. The `--no-git-tag-version`
flag prevents npm from creating a tag immediately -- we'll tag after merging
to main.

Commit the bump:
```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.5.0"
git push origin ux-improvements
```

---

## Step 4: Run the full validation suite

```bash
npm install
npm run lint
npm test
npm run build
```

All four should pass cleanly. If `npm test` fails on the accessory tests due
to mock shape issues, check `src/__tests__/accessory.test.ts` for any HAP
constant mismatches with your installed `homebridge` version.

---

## Step 5: Wait for CI to go green

After your `git push` in Step 3, GitHub Actions will run lint + tests + build
across Node 20 / 22 / 24. Verify on:

https://github.com/somekindawizard/homebridge-petlibro-granary/actions

Wait for all three Node versions to show green checkmarks before merging.

---

## Step 6: Merge PR #3

You have three options. Pick one:

### Option A: Merge via GitHub UI (recommended)

1. Open https://github.com/somekindawizard/homebridge-petlibro-granary/pull/3
2. Click **"Squash and merge"** (cleanest history) or **"Create a merge commit"** (preserves all 13 commits)
3. Confirm

Then sync local:
```bash
git checkout main
git pull origin main
```

### Option B: Merge via gh CLI

```bash
# If you have GitHub CLI installed
gh pr merge 3 --squash --delete-branch

# Then sync local
git checkout main
git pull origin main
```

### Option C: Merge locally and push

```bash
git checkout main
git merge ux-improvements --no-ff -m "Merge PR #3: UX improvements"
git push origin main

# Optionally delete the feature branch
git branch -d ux-improvements
git push origin --delete ux-improvements
```

---

## Step 7: Tag the release

```bash
# Make sure you're on main with the merge commit
git checkout main
git pull origin main

# Create an annotated tag
git tag -a v0.5.0 -m "Release v0.5.0 -- UX improvements"

# Push the tag
git push origin v0.5.0
```

This tag will be visible on the GitHub releases page and is the canonical
reference for the npm version.

---

## Step 8: Create a GitHub release (optional but recommended)

```bash
# Via gh CLI
gh release create v0.5.0 \
  --title "v0.5.0 -- UX improvements" \
  --notes-file CHANGELOG.md \
  --latest
```

Or via web UI:
1. Go to https://github.com/somekindawizard/homebridge-petlibro-granary/releases/new
2. Choose tag `v0.5.0`
3. Title: `v0.5.0 -- UX improvements`
4. Description: copy the v0.5.0 section from `CHANGELOG.md`
5. Click **Publish release**

---

## Step 9: Publish to npm

### One-time setup (skip if already done)

```bash
# Verify Node version (should be 20+)
node --version

# Check npm is up to date
npm install -g npm@latest

# Log in to npm (opens browser for OAuth)
npm login
```

If this is your first publish for `homebridge-petlibro-granary`, you'll also
need an npm account at https://www.npmjs.com/signup.

### Verify the publish payload

Before publishing, dry-run to see what files will be included:

```bash
npm pack --dry-run
```

You should see:
- `dist/` (compiled JS)
- `config.schema.json`
- `LICENSE`
- `README.md`
- `CHANGELOG.md`
- `package.json`

If `dist/` isn't there, run `npm run build` first.

### Publish

```bash
# Make sure you're at the v0.5.0 commit
git checkout main
git pull origin main
git status  # should be clean

# Build fresh
npm run build

# Publish (this is the irreversible step)
npm publish
```

For the first publish on a public package, you may need:
```bash
npm publish --access public
```

If you have 2FA enabled on npm (you should), it'll prompt for an OTP.

---

## Step 10: Verify the publish

```bash
# Check the listing
npm view homebridge-petlibro-granary

# Check the version specifically
npm view homebridge-petlibro-granary version
# Expected: 0.5.0

# Try installing it fresh in a temp dir
cd /tmp
mkdir test-install && cd test-install
npm install homebridge-petlibro-granary
ls node_modules/homebridge-petlibro-granary/dist/
# Should see the compiled .js files
```

Also verify on the npm web UI:
https://www.npmjs.com/package/homebridge-petlibro-granary

The README badge in your repo should auto-update to show `v0.5.0` within a
few minutes.

---

## Step 11: Smoke test on real Homebridge

This is the most important step.

```bash
# On your Homebridge machine (could be the same Mac mini)
sudo npm install -g homebridge-petlibro-granary@0.5.0

# Restart Homebridge
sudo hb-service restart
# OR
sudo systemctl restart homebridge
```

Open the Homebridge UI:
1. Go to the Plugins tab
2. Verify `homebridge-petlibro-granary` shows v0.5.0
3. Click Settings on the plugin
4. Confirm the new fieldset layout (Account / Feeder Settings / HomeKit Services / Advanced)
5. Confirm the password field is masked
6. Confirm the `enabledServices` checkboxes appear

Open the Home app on your iPhone:
1. Find your Granary feeder accessory
2. Verify all enabled service tiles appear
3. **Check the labels.** If you have a pet bound in the PETLIBRO app, you
   should see "Feed [PetName]" instead of "Test Feeder Feed Now"
4. Tap Feed Now -- should dispense and show a brief contact-sensor pulse
5. Toggle Indicator / Child Lock / Schedule -- should respond within 15s

### Validate the boundPets API shape

This was flagged as uncertain. Add this to your Homebridge config to confirm
the pet name field is correctly mapped:

```json
{
  "platform": "PetLibro",
  "debug": true,
  ...
}
```

Restart Homebridge, then check the logs:
```bash
hb-service logs
# OR
tail -f ~/.homebridge/homebridge.log
```

Look for the `boundPets` payload. The plugin currently reads `name` with a
fallback to `petName`. If the API actually returns the pet name under a
different key (like `nickName` or `petAlias`), the labels will fall back to
the device name. That's not a crash -- but if you want pet-aware labels,
file an issue with the actual payload structure and I'll patch it.

Once you've confirmed it works, set `debug: false` to quiet the logs.

---

## Step 12: Post-release housekeeping

```bash
# Clean up any stash from Step 1
git stash list
git stash drop  # if you stashed and don't need it

# Delete the docs/release-guide branch (after you've used this guide)
git push origin --delete docs/release-guide
```

Watch for issues at:
https://github.com/somekindawizard/homebridge-petlibro-granary/issues

---

## Rollback procedure (if something goes wrong)

### npm rollback

You **cannot** unpublish a version after 72 hours, and even within 72 hours
it's strongly discouraged. Instead, deprecate and publish a fix:

```bash
# Mark v0.5.0 as deprecated with a message
npm deprecate homebridge-petlibro-granary@0.5.0 "Critical bug; please upgrade to 0.5.1"

# Then fix the bug, bump to 0.5.1, and publish again
npm version 0.5.1
npm publish
```

### Homebridge rollback (for users)

If a user reports v0.5.0 breaks their setup:
```bash
sudo npm install -g homebridge-petlibro-granary@0.4.0
sudo hb-service restart
```

---

## Quick reference: full command sequence

For when you just want to copy-paste:

```bash
# Sync
cd ~/Downloads/homebridge-petlibro-granary
git fetch --all --prune --tags
git checkout main && git pull origin main

# Review PR #3
git checkout ux-improvements
git pull origin ux-improvements
git log --oneline main..ux-improvements

# Bump version
npm version 0.5.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 0.5.0"
git push origin ux-improvements

# Validate
npm install && npm run lint && npm test && npm run build

# Merge (via gh CLI)
gh pr merge 3 --squash --delete-branch

# Sync
git checkout main && git pull origin main

# Tag
git tag -a v0.5.0 -m "Release v0.5.0 -- UX improvements"
git push origin v0.5.0

# Release
gh release create v0.5.0 --title "v0.5.0 -- UX improvements" --notes-file CHANGELOG.md --latest

# Publish
npm run build
npm publish

# Verify
npm view homebridge-petlibro-granary version
```

---

## If you hit problems

| Symptom | Fix |
|---------|-----|
| `npm test` fails with HAP constant errors | Check that `homebridge` peer dep is installed: `npm install homebridge@^1.8.0` |
| `npm publish` says "you must be logged in" | Run `npm login` |
| `npm publish` says "package already exists at this version" | Bump the version: `npm version patch` |
| `npm publish` says "402 payment required" | Add `--access public` flag |
| `gh pr merge` not found | Install GitHub CLI: `brew install gh && gh auth login` |
| Tests pass locally but CI fails | Check Node version mismatch; CI runs on 20/22/24 |
| Pet name not showing up in Home app | Check logs with `debug: true` for actual `boundPets` shape |
