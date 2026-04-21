# Publishing `homebridge-petlibro-granary` v0.5.0

A complete, no-context-needed walkthrough for publishing from your
**Mac mini at home** (`~/homebridge-petlibro-granary`).

---

## What's happened since v0.4.0

PRs #1, #3, and #4 have been merged to `main` via the GitHub web UI.
Your local repo is behind and its `package-lock.json` is stale. The steps
below sync everything up, fix CI, install locally for testing, then publish.

---

## What you have at home

- Local clone at `~/homebridge-petlibro-granary`
- npm + git already installed and authenticated
- Homebridge running locally (for live testing before publish)

## What you need to do

1. Sync your local repo with the remote `main`
2. Regenerate the lockfile and push it (fixes CI)
3. Wait for CI to go green
4. Install locally on Homebridge for a smoke test
5. Tag and publish to npm

---

## Step 1 -- Sync your local repo

```bash
cd ~/homebridge-petlibro-granary
git checkout main
git pull origin main
```

If git complains about local changes:

```bash
git stash
git pull origin main
git stash pop
```

---

## Step 2 -- Fix the lockfile and push

The `package-lock.json` on `main` is stale because the PRs were merged
through the GitHub web UI (which can't run `npm install`). CI uses
`npm ci`, which requires the lockfile to match `package.json` exactly.

```bash
rm -rf node_modules package-lock.json dist
npm install
npm run lint
npm test
npm run build
```

If all four pass, commit and push the regenerated lockfile:

```bash
git add package-lock.json
git commit -m "chore: regenerate package-lock.json for 0.5.0"
git push
```

**Check CI on GitHub.** All three Node versions (20, 22, 24) should go
green. Do not continue until they do.

https://github.com/somekindawizard/homebridge-petlibro-granary/actions

---

## Step 3 -- Install locally on Homebridge

Before publishing to npm, install the plugin from your local build to
make sure it actually works on your feeder.

### What `npm link` does

It creates a symlink (a shortcut) so that Homebridge loads your local
`dist/` folder instead of the version it downloaded from npm. Think of
it like temporarily pointing Homebridge at your local code instead of
the store-bought version.

**It does not:**
- Modify your Homebridge config
- Delete your existing accessories or automations
- Touch your Home.app rooms/scenes/names
- Install anything permanently

**It does:**
- Replace the plugin's code with your local build (via symlink)
- Survive until you explicitly unlink or reinstall from npm

### 3a. Build your local code

```bash
cd ~/homebridge-petlibro-granary
npm run build
```

This compiles your TypeScript into `dist/`. The symlink will point here.

### 3b. Create the global symlink

```bash
sudo npm link
```

This registers your local folder globally so any project can reference
it by package name. Nothing happens to Homebridge yet.

### 3c. Find your Homebridge plugin directory

If you're running `hb-service` (the standard Homebridge UI setup), the
plugin directory is usually `/usr/local/lib/node_modules/`. You can
check:

```bash
npm root -g
# Typical output: /usr/local/lib/node_modules
```

Verify the current install exists:

```bash
ls /usr/local/lib/node_modules/ | grep petlibro
```

If you see `homebridge-petlibro-granary` there, that's the installed
copy from npm that will be replaced by the symlink.

### 3d. Link it into Homebridge

```bash
cd /usr/local/lib/node_modules    # or whatever npm root -g showed
sudo npm link homebridge-petlibro-granary
```

This replaces the npm-installed copy with a symlink to your local build.
You can verify it worked:

```bash
ls -la /usr/local/lib/node_modules/homebridge-petlibro-granary
# Should show -> /Users/yourname/homebridge-petlibro-granary
```

### 3e. Restart Homebridge

```bash
sudo hb-service restart
```

### 3f. Check the Homebridge log

Open the Homebridge web UI (usually `http://your-mac-mini:8581`) and
watch the log. You're looking for:

- Plugin loads with `[PetLibro]` log lines, no red errors
- It logs in to the PETLIBRO API successfully
- Your feeder is discovered and accessories are registered
- You might see `Removed indicator service` and `Removed child-lock
  service` lines. That's the legacy migration working correctly (it's
  cleaning up the old 0.4.0 Switch services)

### 3g. Check Home.app

Open Home.app on your phone. The feeder's tile group should look
different from before:

**Before (0.4.0):**
- Indicator was a generic Switch toggle
- Child Lock was a generic Switch toggle
- All tiles had plain names like "Granary Indicator"

**After (0.5.0):**
- Indicator shows as a **lightbulb icon** (tap it, should toggle the LED)
- Child Lock shows as a **lock icon** (tap it, should lock/unlock; try
  saying "Hey Siri, lock the child lock")
- Feeding Schedule should be the **first tile** shown
- Names have emoji prefixes: 📅 Feeding Schedule, 💡 Indicator,
  🔒 Child Lock, etc.
- Reset Desiccant tile should be **gone** (hidden by default now)
- No duplicate/orphaned tiles from the old Switch versions

Try tapping a few things:

- [ ] Toggle the indicator lightbulb on/off
- [ ] Lock/unlock the child lock
- [ ] Hit Feed Now (it will actually dispense food, so be ready)
- [ ] Check that Food Low sensor and Desiccant filter show up
- [ ] Verify no orphaned "Switch" tiles from the old version

### 3h. If you need to make fixes

If anything looks wrong, you can edit your local code, rebuild, and
restart. The symlink means Homebridge always picks up whatever is in
your `dist/` folder:

```bash
# edit code...
npm run build
sudo hb-service restart
```

No need to re-link. Just build and restart.

### 3i. Unlink when done testing

```bash
sudo npm unlink homebridge-petlibro-granary -g
```

This removes the global symlink. After you publish in Step 4, Homebridge
will go back to using the npm registry version on the next restart.

---

## Step 4 -- Tag and publish

`package.json` already says `0.5.0` from the merged PRs, so you just
need the git tag and the npm publish:

```bash
cd ~/homebridge-petlibro-granary
git tag v0.5.0
git push --follow-tags
npm publish
```

If `npm publish` asks for a 2FA code:

```bash
npm publish --otp=123456    # use your current Authenticator code
```

> **Note:** If `git tag v0.5.0` says the tag already exists, check with
> `git tag -l` and `git log v0.5.0` to see if it's on the right commit.
> If so, just skip to `git push --follow-tags` and `npm publish`.

---

## Step 5 -- Verify it worked

Wait about 30 seconds, then:

```bash
npm view homebridge-petlibro-granary version
# Should print: 0.5.0
```

Or check in a browser:
- npm: https://www.npmjs.com/package/homebridge-petlibro-granary
- GitHub: https://github.com/somekindawizard/homebridge-petlibro-granary/releases (you'll see tag v0.5.0)

After publishing, restart Homebridge one more time so it picks up the
real npm version instead of any leftover symlink:

```bash
sudo hb-service restart
```

**Homebridge users will see "Update available: 0.5.0" within about an
hour automatically.** Nothing else for you to do.

---

## What each step actually does

| Step | What it changes |
|---|---|
| `git pull origin main` | Your Mac mini gets the latest source from all merged PRs |
| `rm -rf node_modules package-lock.json` | Clean slate so npm resolves fresh |
| `npm install` | Downloads dependencies and generates a correct lockfile |
| `npm test` | Runs the test suite (81 tests across 6 files) |
| `npm run build` | Compiles TypeScript to JavaScript in `dist/` |
| Push `package-lock.json` | CI can now run `npm ci` successfully |
| `sudo npm link` | Registers your local build as a global package |
| `sudo npm link homebridge-petlibro-granary` | Symlinks your local build into Homebridge's plugin directory |
| `sudo hb-service restart` | Homebridge picks up the linked local code |
| `sudo npm unlink homebridge-petlibro-granary -g` | Removes the symlink, Homebridge goes back to the npm version |
| `git tag v0.5.0` | Creates the version tag |
| `git push --follow-tags` | GitHub now shows v0.5.0 tag |
| `npm publish` | **Tarball uploaded to npmjs.com, users can install** |

---

## What's new in 0.5.0 (for your own reference)

- **Indicator Light** is now a Lightbulb (was a generic Switch)
- **Child Lock** is now a LockMechanism (supports Siri lock/unlock)
- **Feeding Schedule** is marked as PrimaryService (shows first)
- **Emoji prefixes** on default service names (opt-out via config)
- **Per-service visibility** via `ui.expose*` booleans (replaces `enabledServices` array)
- **Reset Desiccant** hidden by default (power-user feature)
- **Optimistic lock state** updates instantly instead of waiting for poll
- Legacy Switch subtypes (`indicator`, `child-lock`) auto-removed on upgrade

**Breaking:** automations referencing the old Indicator Switch or Child
Lock Switch will need to be recreated against the new Lightbulb/Lock.

---

## Mental model: Git vs npm vs npm link

> **GitHub** = the factory (source code, issues, PRs, history)
> **npm** = the store shelf (where Homebridge installs from)
> **npm link** = a temporary shortcut from the store shelf to the factory
>
> Pushing to GitHub alone does NOT update Homebridge users. You MUST run
> `npm publish` for users to get the new version. `npm link` is only for
> your local testing and is invisible to everyone else.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `git checkout` says "you have local changes" | `git stash` first, then checkout, then `git stash pop` |
| `git pull` says "merge conflict" | Your old clone has local changes. `git status` to see what. If safe to discard: `git reset --hard origin/main` |
| `npm install` errors about Node version | You need Node 20+. Check with `node -v`. If old: `brew upgrade node` or download from nodejs.org |
| `npm test` fails | **Stop.** Don't publish broken code. Debug locally or open an issue. |
| `npm publish` says "version exists" | You already published 0.5.0. If you need to fix something, bump to 0.5.1. |
| `npm publish` says "you do not have permission" | Run `npm login` first |
| `npm publish` asks for OTP | `npm publish --otp=YOUR_6_DIGIT_CODE` |
| Pushed wrong version by accident | `npm unpublish homebridge-petlibro-granary@0.5.0` (only works within 72hr) |
| `git push` asks for username/password | Username = your GitHub username. Password = your **PAT**, not your GitHub password |
| `git tag v0.5.0` says "already exists" | Check `git log v0.5.0` to see if it's on the right commit. If so, skip to `git push --follow-tags`. |
| Homebridge says plugin not found after link | Wrong directory. Run `npm root -g` to find the right global modules path, then link there. |
| Home.app still shows old Switch tiles | Homebridge cached the old accessory. Remove the accessory from Homebridge UI (Accessories tab), restart, let it re-discover. |
| Two copies of each tile | Old cached accessory plus new one. Same fix: remove stale accessories from Homebridge UI, restart. |
| Code changes don't show up after link | Forgot to rebuild. Run `npm run build` then `sudo hb-service restart`. |
| Homebridge still shows old version after unlink | Run `sudo hb-service restart` to clear the module cache. |
| `npm link` permission denied | Use `sudo npm link` (Homebridge typically runs as root). |
| Want to bail out of link entirely | `sudo npm unlink homebridge-petlibro-granary -g && sudo hb-service restart` puts everything back. |

---

## TL;DR

### Sync, fix lockfile, push:

```bash
cd ~/homebridge-petlibro-granary
git checkout main
git pull origin main
rm -rf node_modules package-lock.json dist
npm install
npm run lint
npm test
npm run build
git add package-lock.json
git commit -m "chore: regenerate package-lock.json for 0.5.0"
git push
```

### After CI is green, test locally:

```bash
cd ~/homebridge-petlibro-granary
npm run build
sudo npm link
cd /usr/local/lib/node_modules    # or whatever npm root -g shows
sudo npm link homebridge-petlibro-granary
sudo hb-service restart
# test in Home.app (lightbulb, lock, emoji, no orphans)
# when satisfied:
sudo npm unlink homebridge-petlibro-granary -g
```

### Publish:

```bash
cd ~/homebridge-petlibro-granary
git tag v0.5.0
git push --follow-tags
npm publish
sudo hb-service restart
```

Done. Both GitHub and npm are updated. Homebridge users get 0.5.0 within an hour.
