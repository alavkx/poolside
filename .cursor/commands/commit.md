---
description: Verify, commit, and push changes
---

## Step 1: Verify Everything Works

Run all checks in parallel:

```bash
npm run test
npm run build
npm run lint
```

If any command fails, stop and report the failure. Do not proceed to commit.

## Step 2: Describe and Commit Changes

1. Run `git status` and `git diff` to understand what changed
2. Stage all changes with `git add .`
3. Write a descriptive commit message based on the actual changes
4. Commit with `git commit --no-verify -m "<message>"`

Use conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `refactor:` for code changes that neither fix bugs nor add features
- `test:` for adding/updating tests
- `docs:` for documentation changes
- `chore:` for maintenance tasks

## Step 3: Push Changes

Push to remote with:

```bash
git push --no-verify
```

If no upstream is set, use `git push -u origin HEAD --no-verify`.
