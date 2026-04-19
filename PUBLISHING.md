# 🚀 Publishing `homebridge-petlibro-granary` v0.4.0

A self-contained cheat sheet for cutting the next release. Save / print / screenshot — no other context needed.

---

## Prereqs (one-time only)

```bash
# Make sure you're logged in to npm
npm whoami                    # if this errors, run: npm login

# Optional: install gh CLI for terminal-based PR merging
# Or just merge the PR via the GitHub web UI
```

---

## The full flow

```bash
# 1. Go to your local clone
cd ~/path/to/homebridge-petlibro-granary

# 2. Merge PR #1 — pick ONE of these:
#    Option A (web UI):
#      https://github.com/somekindawizard/homebridge-petlibro-granary/pull/1
#      -> click "Squash and merge"
#    Option B (terminal):
gh pr merge 1 --squash --delete-branch

# 3. Sync local main with the merged changes
git checkout main
git pull origin main

# 4. Install dependencies (the PR added vitest + others)
npm install

# 5. Verify everything works
npm run lint
npm test
npm run build

# 6. Sanity-check what will get published (optional but recommended)
npm pack --dry-run

# 7. Bump version, tag, push, publish
npm version 0.4.0             # updates package.json + creates git tag v0.4.0
git push --follow-tags        # pushes commit + tag to GitHub
npm publish                   # uploads to npmjs.com
#   ^ if 2FA prompts: npm publish --otp=123456
```

---

## What each step does

| Step | Result |
|---|---|
| Merge PR | Source code on GitHub `main` updated |
| `git pull` | Your laptop has the latest source |
| `npm install` | Pulls in vitest + other new dev deps |
| `npm test` | Runs the new test suite |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm version 0.4.0` | Bumps `package.json`, makes git tag `v0.4.0` |
| `git push --follow-tags` | GitHub now shows the new version + tag |
| `npm publish` | **Homebridge users can now install 0.4.0** |

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `npm test` fails | Open an issue, paste output. Don't publish broken code. |
| `npm publish` says "version exists" | You forgot `npm version`. Run it, then republish. |
| `npm publish` asks for OTP | `npm publish --otp=YOUR_6_DIGIT_CODE` |
| `npm publish` says "you do not have permission" | `npm login` again |
| Pushed wrong version | `npm unpublish homebridge-petlibro-granary@0.4.0` (only works within 72hr) |

---

## Verify it worked

```bash
# Wait ~30s after publish, then:
npm view homebridge-petlibro-granary version
# Should print: 0.4.0
```

Or check: https://www.npmjs.com/package/homebridge-petlibro-granary

---

## What users see

Homebridge UI checks for plugin updates roughly hourly. Your existing users will get an "Update available: 0.4.0" notification automatically. No action needed on your end.

---

## Mental model

- **GitHub** = the factory (source code, issues, PRs)
- **npm** = the store shelf (where Homebridge actually installs from)

Pushing to GitHub alone does *not* update Homebridge users. You need both `git push` AND `npm publish`.
