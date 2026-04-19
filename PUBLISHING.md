# 🚀 Publishing `homebridge-petlibro-granary` v0.4.0

A complete, no-context-needed walkthrough for publishing the next version from your **Mac mini at home** (which already has an older clone of this repo).

---

## What you have at home

- ✅ Old clone of `homebridge-petlibro-granary` (somewhere like `~/Developer/` or `~/Code/`)
- ✅ Old built `dist/` folder and `.tgz` from your last release
- ✅ npm + git already installed and authenticated

## What you need to do

1. Merge PR #1 on GitHub
2. Pull the latest code to your local clone
3. Build + test
4. Publish new version to npm AND push tag to GitHub

---

## Step 0 — Find your local clone

```bash
# If you don't remember where it is:
mdfind -name "homebridge-petlibro-granary" -onlyin ~

# Or just search common dev folders:
ls ~/Developer ~/Code ~/Projects ~/Documents 2>/dev/null | grep -i petlibro
```

Once you find it, `cd` into it:

```bash
cd ~/path/to/homebridge-petlibro-granary
```

**Verify it's the right repo and remote is set:**

```bash
git remote -v
# Should print:
# origin  https://github.com/somekindawizard/homebridge-petlibro-granary.git (fetch)
# origin  https://github.com/somekindawizard/homebridge-petlibro-granary.git (push)
```

If `origin` is set, you're good — git remembers everything from your original clone. No re-cloning needed, no matter how out of date the local copy is.

---

## Step 1 — Merge the PR on GitHub

Open the PR and click **"Squash and merge"**:

👉 https://github.com/somekindawizard/homebridge-petlibro-granary/pull/1

(Or if you have the `gh` CLI: `gh pr merge 1 --squash --delete-branch`)

This puts all the new code on the `main` branch.

---

## Step 2 — Pull the latest code to your Mac mini

```bash
cd ~/path/to/homebridge-petlibro-granary

# Make sure you're on main
git checkout main

# Pull the merged PR
git pull
```

You'll see output like:
```
Updating abc1234..def5678
Fast-forward
 24 files changed, 1616 insertions(+), 438 deletions(-)
```

That confirms the new 0.4.0 code is now on your machine.

---

## Step 3 — Clean install + build + test

The PR added new dev dependencies (vitest, eslint plugins, etc.), so a fresh install is safest:

```bash
# Wipe old node_modules and old built tarball
rm -rf node_modules dist *.tgz

# Fresh install
npm install

# Run the new test suite
npm test

# Lint
npm run lint

# Build the dist/ folder
npm run build
```

If all four pass, you're ready to publish.

**Optional sanity check** — see exactly what files will end up in the npm tarball:

```bash
npm pack --dry-run
```

You should see only: `dist/`, `config.schema.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`. **Not** `src/`, `node_modules/`, `.git/`, or test files.

---

## Step 4 — Bump version, tag, push, publish

```bash
# Bumps package.json to 0.4.0 AND creates git tag v0.4.0 AND commits both
npm version 0.4.0

# Push the version-bump commit + the new tag to GitHub
git push --follow-tags

# Publish to npm (this is what Homebridge users actually install)
npm publish
```

If npm asks for a 2FA code:
```bash
npm publish --otp=123456    # use your current Authenticator code
```

---

## Step 5 — Verify it worked

Wait ~30 seconds, then:

```bash
npm view homebridge-petlibro-granary version
# Should print: 0.4.0
```

Or check in a browser:
- npm: https://www.npmjs.com/package/homebridge-petlibro-granary
- GitHub releases: https://github.com/somekindawizard/homebridge-petlibro-granary/releases (you'll see tag v0.4.0)

**Your Homebridge users will see "Update available: 0.4.0" within ~1 hour automatically.** Nothing else for you to do.

---

## What each step actually does

| Step | What it changes |
|---|---|
| Merge PR on GitHub | Code on GitHub `main` is updated |
| `git pull` | Your Mac mini gets the latest source |
| `npm install` | Downloads new dev dependencies |
| `npm test` | Runs ~50 tests covering the new code |
| `npm run build` | Compiles TypeScript → JavaScript in `dist/` |
| `npm version 0.4.0` | Bumps version, makes git tag, commits |
| `git push --follow-tags` | GitHub now shows v0.4.0 tag + bump commit |
| `npm publish` | **Tarball uploaded to npmjs.com — users can install** |

---

## Mental model: Git vs npm

> **GitHub** = the factory (source code, issues, PRs, history)
> **npm** = the store shelf (where Homebridge installs from)
>
> Pushing to GitHub alone does NOT update Homebridge users. You MUST run `npm publish` for users to get the new version.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `git pull` says "you have local changes" | `git stash` first, then `git pull`, then `git stash pop` |
| `git pull` says "merge conflict" | Your old clone has changes you forgot. `git status` to see what. If safe to discard: `git reset --hard origin/main` |
| `npm install` errors about Node version | You need Node 20+. Check with `node -v`. If old, install via `brew upgrade node` or from nodejs.org |
| `npm test` fails | **Stop.** Don't publish broken code. Open the PR or file an issue. |
| `npm publish` says "version exists" | You skipped `npm version`. Run it, then republish. |
| `npm publish` says "you do not have permission" | Run `npm login` first |
| `npm publish` asks for OTP | `npm publish --otp=YOUR_6_DIGIT_CODE` |
| Pushed wrong version by accident | `npm unpublish homebridge-petlibro-granary@0.4.0` (only works within 72hr) |
| `git push` asks for username/password | Username = your GitHub username. Password = your **PAT**, not your GitHub password |

---

## TL;DR — the whole thing in one block

After merging PR #1 on GitHub:

```bash
cd ~/path/to/homebridge-petlibro-granary
git checkout main
git pull
rm -rf node_modules dist *.tgz
npm install
npm test
npm run lint
npm run build
npm version 0.4.0
git push --follow-tags
npm publish
```

Done. Both GitHub and npm are updated. Homebridge users get 0.4.0 within an hour.
