# Publishing `homebridge-petlibro-granary` v0.4.0

A complete, no-context-needed walkthrough for publishing from your
**Mac mini at home** (`~/homebridge-petlibro-granary`).

---

## What you have at home

- Local clone at `~/homebridge-petlibro-granary`
- npm + git already installed and authenticated

## What you need to do

1. Fix the stale lockfile on the PR branch so CI passes
2. Wait for CI to go green
3. Merge PR #1 into `main` on GitHub
4. Pull `main`, build, tag, publish to npm

---

## Step 1 — Fix the lockfile and get CI green

The `package-lock.json` on the branch is still at v0.3.3 and missing the new
devDependencies (vitest, etc.). CI runs `npm ci`, which requires the lockfile
to match `package.json` exactly, so it fails immediately.

```bash
cd ~/homebridge-petlibro-granary
git fetch origin
git checkout feature/reliability-and-polish
rm -rf node_modules package-lock.json
npm install
npm run lint
npm test
npm run build
git add package-lock.json
git commit -m "fix: regenerate package-lock.json for 0.4.0 dependencies"
git push
```

After the push, go check the PR. CI should re-run and pass on all three
Node versions (20, 22, 24). **Do not continue until all checks are green.**

---

## Step 2 — Merge the PR on GitHub

Once CI is green, open the PR and click **"Squash and merge"**:

https://github.com/somekindawizard/homebridge-petlibro-granary/pull/1

(Or with the `gh` CLI: `gh pr merge 1 --squash --delete-branch`)

This puts all the new code on the `main` branch.

---

## Step 3 — Pull main and verify locally

```bash
cd ~/homebridge-petlibro-granary
git checkout main
git pull
rm -rf node_modules dist *.tgz
npm install
npm test
npm run lint
npm run build
```

If all four pass, you're ready to publish.

**Optional sanity check** — see exactly what files will end up in the npm
tarball:

```bash
npm pack --dry-run
```

You should see only: `dist/`, `config.schema.json`, `LICENSE`, `README.md`,
`CHANGELOG.md`, `package.json`. **Not** `src/`, `node_modules/`, `.git/`,
or test files.

---

## Step 4 — Tag and publish

`package.json` already says `0.4.0` from the PR, so you just need the git
tag and the npm publish:

```bash
git tag v0.4.0
git push --follow-tags
npm publish
```

If `npm publish` asks for a 2FA code:

```bash
npm publish --otp=123456    # use your current Authenticator code
```

> **Note:** If `git tag v0.4.0` says the tag already exists, that means
> you (or a previous attempt) already created it. Check with `git tag -l`
> and if the tag is pointing at the right commit, just skip to
> `git push --follow-tags` and `npm publish`.

---

## Step 5 — Verify it worked

Wait about 30 seconds, then:

```bash
npm view homebridge-petlibro-granary version
# Should print: 0.4.0
```

Or check in a browser:
- npm: https://www.npmjs.com/package/homebridge-petlibro-granary
- GitHub: https://github.com/somekindawizard/homebridge-petlibro-granary/releases (you'll see tag v0.4.0)

**Homebridge users will see "Update available: 0.4.0" within about an hour
automatically.** Nothing else for you to do.

---

## What each step actually does

| Step | What it changes |
|---|---|
| `git fetch origin` | Downloads remote branch refs without changing local files |
| Fix lockfile + push | CI can now install dependencies and run checks |
| Merge PR on GitHub | Code on GitHub `main` is updated |
| `git checkout main && git pull` | Your Mac mini gets the latest source |
| `npm install` | Downloads new dev dependencies |
| `npm test` | Runs the test suite covering the new code |
| `npm run build` | Compiles TypeScript to JavaScript in `dist/` |
| `git tag v0.4.0` | Creates the version tag (package.json already says 0.4.0) |
| `git push --follow-tags` | GitHub now shows v0.4.0 tag |
| `npm publish` | **Tarball uploaded to npmjs.com, users can install** |

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
| `npm publish` says "version exists" | You already published 0.4.0. If you need to fix something, bump to 0.4.1. |
| `npm publish` says "you do not have permission" | Run `npm login` first |
| `npm publish` asks for OTP | `npm publish --otp=YOUR_6_DIGIT_CODE` |
| Pushed wrong version by accident | `npm unpublish homebridge-petlibro-granary@0.4.0` (only works within 72hr) |
| `git push` asks for username/password | Username = your GitHub username. Password = your **PAT**, not your GitHub password |
| `git tag v0.4.0` says "already exists" | Check `git log v0.4.0` to see if it's on the right commit. If so, skip to `git push --follow-tags`. |

---

## TL;DR

### Fix CI (do this first):

```bash
cd ~/homebridge-petlibro-granary
git fetch origin
git checkout feature/reliability-and-polish
rm -rf node_modules package-lock.json
npm install
npm run lint
npm test
npm run build
git add package-lock.json
git commit -m "fix: regenerate package-lock.json for 0.4.0 dependencies"
git push
```

### After CI is green, merge the PR on GitHub, then publish:

```bash
cd ~/homebridge-petlibro-granary
git checkout main
git pull
rm -rf node_modules dist *.tgz
npm install
npm test
npm run lint
npm run build
git tag v0.4.0
git push --follow-tags
npm publish
```

Done. Both GitHub and npm are updated. Homebridge users get 0.4.0 within an hour.
