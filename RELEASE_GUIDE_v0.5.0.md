# v0.5.0 Release Guide

End-to-end checklist for merging the open PRs, bumping the version, and
publishing `homebridge-petlibro-granary@0.5.0` to npm from your Mac mini.

> **Repo location:** `~/Downloads/homebridge-petlibro-granary`
> **PRs to merge:** #1 (reliability), then #3 (UX improvements)
> PR #2 is already closed and superseded by #3.

---

## ⚠️ READ THIS FIRST: Lockfile drift

Every PR on this repo has the same problem: `package.json` was updated to
newer dependency versions but `package-lock.json` was never regenerated.
`npm ci` (used by GitHub Actions CI) is strict and refuses to install when
they don't match, so **every PR will fail CI until you regenerate the
lockfile on the branch**.

The error looks like:
```
npm error `npm ci` can only install packages when your package.json and
package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @vitest/coverage-v8@4.x.x from lock file
```

**Fix (run on every PR branch before merging):**
```bash
git checkout <pr-branch>
git pull
rm -rf node_modules package-lock.json
npm install
npm run lint && npm test && npm run build
git add package-lock.json
git commit -m "chore: regenerate package-lock.json"
git push
```

CI will re-run automatically and go green.

This step is incorporated into the per-PR sections below.

---

## Status of open PRs

| PR | Title | State | Action |
|----|-------|-------|--------|
| #1 | Reliability + security pass | **open** | Regen lockfile, then merge |
| #2 | HomeKit UX overhaul (semantic types + emoji) | **closed** (superseded) | Nothing |
| #3 | UX improvements (configurable services + tests + pet naming) | **open** | Regen lockfile, then merge after #1 |

---

## Step 0: Sync your local repo

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

## Step 1: Merge PR #1 (Reliability + security)

### 1a. Identify the PR #1 branch name

```bash
git branch -a | grep -v HEAD
# Look for the PR #1 branch, probably "feature/reliability-and-polish"
# or similar. You can also check on GitHub:
# https://github.com/somekindawizard/homebridge-petlibro-granary/pull/1
```

For the rest of this section, replace `<pr1-branch>` with the actual name.

### 1b. Regenerate the lockfile on the branch

```bash
git checkout <pr1-branch>
git pull origin <pr1-branch>

# Nuke node_modules and the stale lockfile
rm -rf node_modules package-lock.json

# Regenerate
npm install

# Validate everything still passes locally
npm run lint
npm test
npm run build
```

If all four pass, commit and push:
```bash
git add package-lock.json
git commit -m "chore: regenerate package-lock.json to match package.json"
git push origin <pr1-branch>
```

### 1c. Wait for CI to go green

Watch:
https://github.com/somekindawizard/homebridge-petlibro-granary/actions

All three Node versions (20 / 22 / 24) should show green checkmarks.

### 1d. Merge PR #1

Pick one:

**Option A: GitHub UI**
1. Open https://github.com/somekindawizard/homebridge-petlibro-granary/pull/1
2. Click **"Squash and merge"** (recommended for clean history)
3. Confirm

**Option B: gh CLI**
```bash
gh pr merge 1 --squash --delete-branch
```

**Option C: Local merge**
```bash
git checkout main
git merge <pr1-branch> --no-ff -m "Merge PR #1: Reliability + security pass"
git push origin main
git branch -d <pr1-branch>
git push origin --delete <pr1-branch>
```

### 1e. Sync local main

```bash
git checkout main
git pull origin main
```

---

## Step 2: Merge PR #3 (UX improvements)

PR #3 was branched off main *before* PR #1 was merged, so it now needs to be
brought up to date with main. Two paths:

### 2a. Update PR #3 with main

```bash
git checkout ux-improvements
git pull origin ux-improvements

# Bring in the PR #1 changes from main
git merge main
# (or: git rebase main, if you prefer linear history)
```

If there are merge conflicts, resolve them in your editor, then:
```bash
git add <conflicted-files>
git commit  # for merge
# OR
git rebase --continue  # for rebase
```

### 2b. Regenerate the lockfile on PR #3

Same drill as PR #1:
```bash
rm -rf node_modules package-lock.json
npm install
npm run lint && npm test && npm run build
git add package-lock.json
git commit -m "chore: regenerate package-lock.json"
```

### 2c. Bump version to 0.5.0

The `package.json` on the branch is still at `0.4.0`. Bump it now so it
ships with the release:

```bash
npm version 0.5.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 0.5.0"
```

### 2d. Push everything

```bash
git push origin ux-improvements
# OR if you rebased:
git push origin ux-improvements --force-with-lease
```

### 2e. Wait for CI to go green

Same URL as before; verify all three Node versions pass.

### 2f. Merge PR #3

```bash
gh pr merge 3 --squash --delete-branch
# OR via GitHub UI: "Squash and merge"

git checkout main
git pull origin main
```

---

## Step 3: Tag the release

```bash
git checkout main
git pull origin main

# Verify package.json shows 0.5.0
cat package.json | grep version
# Expected: "version": "0.5.0",

# Create an annotated tag
git tag -a v0.5.0 -m "Release v0.5.0 -- UX improvements"

# Push the tag
git push origin v0.5.0
```

---

## Step 4: Create a GitHub release

```bash
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

## Step 5: Publish to npm

### 5a. One-time setup (skip if already done)

```bash
node --version
# Should be 20+

npm install -g npm@latest

npm login
# Opens browser for OAuth
```

If this is your first publish for `homebridge-petlibro-granary`, you'll
also need an npm account at https://www.npmjs.com/signup.

### 5b. Verify the publish payload

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

### 5c. Publish

```bash
git checkout main
git pull origin main
git status  # should be clean

npm run build

# This is the irreversible step
npm publish

# Or if it's the first publish on a public package:
npm publish --access public
```

If you have 2FA enabled on npm (you should), it'll prompt for an OTP.

---

## Step 6: Verify the publish

```bash
npm view homebridge-petlibro-granary version
# Expected: 0.5.0

# Try installing fresh in a temp dir
cd /tmp
mkdir test-install && cd test-install
npm install homebridge-petlibro-granary
ls node_modules/homebridge-petlibro-granary/dist/
# Should see compiled .js files
```

Verify on the npm web UI:
https://www.npmjs.com/package/homebridge-petlibro-granary

---

## Step 7: Smoke test on real Homebridge

This is the most important step.

```bash
# On your Homebridge machine
sudo npm install -g homebridge-petlibro-granary@0.5.0
sudo hb-service restart
# OR
sudo systemctl restart homebridge
```

Open the Homebridge UI:
1. Plugins tab -- verify `homebridge-petlibro-granary` shows v0.5.0
2. Click Settings on the plugin
3. Confirm the new fieldset layout (Account / Feeder Settings / HomeKit Services / Advanced)
4. Confirm the password field is masked
5. Confirm the `enabledServices` checkboxes appear

Open the Home app on your iPhone:
1. Find your Granary feeder accessory
2. Verify all enabled service tiles appear
3. **Check the labels.** If you have a pet bound in the PETLIBRO app, you
   should see "Feed [PetName]" instead of "Test Feeder Feed Now"
4. Tap Feed Now -- should dispense and show a brief contact-sensor pulse
5. Toggle Indicator / Child Lock / Schedule -- should respond within 15s

### Validate the boundPets API shape

Add `debug: true` to your Homebridge config:
```json
{
  "platform": "PetLibro",
  "debug": true,
  ...
}
```

Restart and check logs:
```bash
hb-service logs
# OR
tail -f ~/.homebridge/homebridge.log
```

Look for the `boundPets` payload. The plugin reads `name` with a fallback
to `petName`. If the API returns the pet name under a different key,
labels fall back to the device name -- not a crash, but if you want
pet-aware labels, file an issue with the actual payload structure.

Once verified, set `debug: false` to quiet the logs.

---

## Step 8: Post-release housekeeping

```bash
# Clean up any stash from Step 0
git stash list
git stash drop

# Delete the release-guide branch when you're done with this doc
git push origin --delete docs/release-guide
```

Watch for issues at:
https://github.com/somekindawizard/homebridge-petlibro-granary/issues

---

## Rollback procedure (if something goes wrong)

### npm rollback

You **cannot** unpublish a version after 72 hours, and even within 72
hours it's strongly discouraged. Instead, deprecate and publish a fix:

```bash
npm deprecate homebridge-petlibro-granary@0.5.0 "Critical bug; please upgrade to 0.5.1"

# Fix the bug, bump, publish
npm version 0.5.1
npm publish
```

### Homebridge rollback (for users)

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

# ===== PR #1 =====
git branch -a | grep -i reliability  # find the PR1 branch name
git checkout <pr1-branch>
git pull origin <pr1-branch>
rm -rf node_modules package-lock.json
npm install
npm run lint && npm test && npm run build
git add package-lock.json
git commit -m "chore: regenerate package-lock.json"
git push origin <pr1-branch>

# Wait for CI green, then:
gh pr merge 1 --squash --delete-branch
git checkout main && git pull origin main

# ===== PR #3 =====
git checkout ux-improvements
git pull origin ux-improvements
git merge main  # bring in PR #1 changes
rm -rf node_modules package-lock.json
npm install
npm run lint && npm test && npm run build
npm version 0.5.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump to 0.5.0 and regenerate lockfile"
git push origin ux-improvements

# Wait for CI green, then:
gh pr merge 3 --squash --delete-branch
git checkout main && git pull origin main

# ===== Release =====
git tag -a v0.5.0 -m "Release v0.5.0 -- UX improvements"
git push origin v0.5.0
gh release create v0.5.0 --title "v0.5.0 -- UX improvements" --notes-file CHANGELOG.md --latest

# ===== Publish =====
npm run build
npm publish

# ===== Verify =====
npm view homebridge-petlibro-granary version
```

---

## If you hit problems

| Symptom | Fix |
|---------|-----|
| `npm ci` fails with "Missing: ... from lock file" | Regenerate the lockfile (see Step 1b / 2b) |
| `npm test` fails with HAP constant errors | Verify peer dep: `npm install homebridge@^1.8.0` |
| `npm publish` says "you must be logged in" | Run `npm login` |
| `npm publish` says "package already exists at this version" | Bump the version: `npm version patch` |
| `npm publish` says "402 payment required" | Add `--access public` flag |
| `gh pr merge` not found | `brew install gh && gh auth login` |
| Tests pass locally but CI fails | Check Node version (CI runs 20/22/24) and lockfile state |
| Pet name not showing in Home app | Check logs with `debug: true` for actual `boundPets` shape |
| Merge conflicts when bringing main into PR #3 | Resolve in editor, `git add`, `git commit` (or `git rebase --continue`) |
