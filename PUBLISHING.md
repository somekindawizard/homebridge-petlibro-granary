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
4. Install locally on Homebridge for a quick smoke test
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

```bash
cd ~/homebridge-petlibro-granary
npm run build                # make sure dist/ is fresh
sudo npm link                # creates a global symlink to this folder
```

Then in your Homebridge installation directory:

```bash
sudo npm link homebridge-petlibro-granary
```

Restart Homebridge:

```bash
sudo hb-service restart
```

### What to check

- [ ] Plugin loads without errors in the Homebridge log
- [ ] Feeder accessory appears in Home.app
- [ ] Indicator shows as a **Lightbulb** (not a generic Switch)
- [ ] Child Lock shows as a **Lock** (not a generic Switch)
- [ ] Feeding Schedule is the **primary tile** (shown first)
- [ ] Emoji prefixes appear in default service names
- [ ] Feed Now switch works (dispenses food)
- [ ] Reset Desiccant tile is **not** visible by default
- [ ] No orphaned tiles from the old 0.4.0 Switch services

If anything is wrong, fix it locally, `npm run build` again, restart
Homebridge, and retest. Homebridge picks up the linked build automatically.

### When done testing, unlink

```bash
cd ~/homebridge-petlibro-granary
sudo npm unlink homebridge-petlibro-granary -g
```

Then reinstall the published version after Step 4 (Homebridge UI will
handle this automatically once it sees the new version on npm).

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
| `sudo npm link` | Symlinks your local build into Homebridge for testing |
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

## Mental model: Git vs npm

> **GitHub** = the factory (source code, issues, PRs, history)
> **npm** = the store shelf (where Homebridge installs from)
>
> Pushing to GitHub alone does NOT update Homebridge users. You MUST run
> `npm publish` for users to get the new version.

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
| Homebridge still shows old version after unlink | `sudo hb-service restart` to clear the module cache |
| `npm link` permission denied | Use `sudo npm link` (Homebridge typically runs as root) |

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
sudo npm link
# (in Homebridge dir) sudo npm link homebridge-petlibro-granary
sudo hb-service restart
# test in Home.app, then:
sudo npm unlink homebridge-petlibro-granary -g
```

### Publish:

```bash
git tag v0.5.0
git push --follow-tags
npm publish
sudo hb-service restart
```

Done. Both GitHub and npm are updated. Homebridge users get 0.5.0 within an hour.
