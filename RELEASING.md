# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for version management and publishing to npm as `@0dotxyz/p0-ts-sdk`.

## Prerequisites

- npm account with publish access to `@0dotxyz/p0-ts-sdk`
- Node >= 18, pnpm installed

## Release Steps

### 1. Prepare your branch

Push all changes to a separate branch. Make sure the working tree is clean — nothing uncommitted.

```bash
git checkout -b release/vX.X.X
git status  # should be clean
```

### 2. Build, test, and verify locally

Build the SDK and make sure examples still run:

```bash
pnpm build
pnpm test:run
cd examples && npx tsx 01-deposit.ts
```

**Local link test with the app** — in the app's `package.json`, temporarily point the SDK dependency to your local build:

```json
"@repo/marginfi-client-v2": "file:../../../p0-ts-sdk"
```

Adjust the relative path if the app lives elsewhere. Run the app and verify things work end-to-end. **Revert this change before committing.**

### 3. Create a changeset

```bash
pnpm changeset
```

Select the bump type:

| Type    | When to use                          | Example            |
|---------|--------------------------------------|--------------------|
| `patch` | Bug fixes, docs, internal refactors  | 2.1.1 → 2.1.2     |
| `minor` | New features, backwards compatible   | 2.1.1 → 2.2.0     |
| `major` | Breaking API changes                 | 2.1.1 → 3.0.0     |

Write a descriptive summary when prompted, or edit the generated `.changeset/<random-name>.md` file afterwards to improve the description.

### 4. Apply version changes

```bash
pnpm changeset version
```

This updates `package.json` version, writes to `CHANGELOG.md`, and deletes consumed changeset files. Review the diff to make sure it looks correct.

### 5. Commit the release

```bash
git add .
git commit -m "chore: release v2.2.0"
```

Use format: `chore: release vX.X.X` (or `chore: release vX.X.X-alpha.X — short description` for pre-releases).

### 6. Tag the release

```bash
git tag v2.2.0
```

Use the same version string: `vX.X.X` (or `vX.X.X-alpha.X` for pre-releases).

### 7. Log in to npm

```bash
npm login
npm whoami  # verify you're the right user
```

### 8. Publish

```bash
pnpm build
npm publish
```

For **stable releases**, this automatically tags as `latest` on npm.
For **alpha/pre-releases**, use `--tag alpha` (see [Alpha Releases](#alpha--pre-releases) below).

### 9. Verify dist-tags

```bash
npm dist-tag ls @0dotxyz/p0-ts-sdk
```

Confirm `latest` (or `alpha`) points to the version you just published.

### 10. Review on npm

Check the package page: https://www.npmjs.com/package/@0dotxyz/p0-ts-sdk

Verify: correct version, correct files in the tarball, README renders properly.

### 11. Push to remote

```bash
git push origin release/vX.X.X --follow-tags
```

Open a PR to merge into `main` if your workflow requires it.

### 12. Optional: integrity hash check

Generate a local tarball and compare its hash with what npm received:

```bash
# Generate local tarball
npm pack

# Hash it
shasum -a 256 0dotxyz-p0-ts-sdk-*.tgz

# Compare with npm's reported hash
npm view @0dotxyz/p0-ts-sdk dist.integrity
```

The hashes should match (npm uses base64-encoded sha512 by default — use `shasum -a 512` and compare manually, or just verify the tarball contents look right with `tar -tzf *.tgz`).

---

## Alpha / Pre-releases

Use alpha releases to test breaking changes or new features before promoting to stable.

### How it differs from a stable release

1. **Version format**: `X.X.X-alpha.N` (e.g. `2.2.0-alpha.0`, `2.2.0-alpha.1`)
2. **Publish with `--tag alpha`** so it does NOT become `latest`
3. **Consumers install with**: `npm install @0dotxyz/p0-ts-sdk@alpha`

### Alpha release walkthrough

```bash
# 1. Create changeset as usual
pnpm changeset  # select minor/major/patch as appropriate

# 2. Enter pre-release mode (changesets feature)
pnpm changeset pre enter alpha

# 3. Apply version — this produces e.g. 2.2.0-alpha.0
pnpm changeset version

# 4. Commit and tag
git add .
git commit -m "chore: release v2.2.0-alpha.0 — new oracle integration"
git tag v2.2.0-alpha.0

# 5. Publish with alpha tag (IMPORTANT: --tag alpha)
pnpm build
npm publish --tag alpha

# 6. Verify
npm dist-tag ls @0dotxyz/p0-ts-sdk
# Should show:  alpha: 2.2.0-alpha.0
#               latest: 2.1.1  (unchanged)

# 7. Push
git push origin <branch> --follow-tags
```

### Iterating on alpha

Repeat steps 1-7 — changesets will auto-increment the pre-release number (`alpha.0` → `alpha.1` → ...).

### Promoting alpha to stable

```bash
# Exit pre-release mode
pnpm changeset pre exit

# Version as stable
pnpm changeset version

# Commit, tag, publish as a normal stable release (steps 5-11 above)
git add .
git commit -m "chore: release v2.2.0"
git tag v2.2.0
pnpm build
npm publish
git push origin <branch> --follow-tags
```

You can also manually move the `latest` tag if needed:

```bash
npm dist-tag add @0dotxyz/p0-ts-sdk@2.2.0 latest
```

---

## Troubleshooting

**"You need to be logged in to publish"** — Run `npm login`.

**"You do not have permission to publish"** — Ensure your npm account has access to the `@0dotxyz` org.

**"Version already exists"** — You already published this version. Bump again with `pnpm changeset version` or manually edit `package.json`.

**Accidental publish** — You can unpublish within 72 hours: `npm unpublish @0dotxyz/p0-ts-sdk@X.X.X` (discouraged — prefer publishing a fix version instead).

**Wrong dist-tag** — Fix with: `npm dist-tag add @0dotxyz/p0-ts-sdk@X.X.X <correct-tag>`
