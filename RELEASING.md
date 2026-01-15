# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for version management and publishing to npm.

## 📋 Prerequisites

Before publishing, ensure you have:

1. **npm account** with access to publish `p0-ts-sdk`
2. **Logged into npm**: `npm login`
3. **All tests passing**: `pnpm test`
4. **Clean working directory**: All changes committed

## 🚀 Release Workflow

### 1. Make Your Changes

```bash
# Make code changes
vim src/models/client.ts

# Add tests
vim tests/unit/models/client.test.ts

# Build and test
pnpm build
pnpm test
```

### 2. Create a Changeset

After making changes, document them with a changeset:

```bash
pnpm changeset
```

This will prompt you for:
- **Package to bump**: `p0-ts-sdk`
- **Bump type**: 
  - `patch` - Bug fixes (1.0.0 → 1.0.1)
  - `minor` - New features, backwards compatible (1.0.0 → 1.1.0)
  - `major` - Breaking changes (1.0.0 → 2.0.0)
- **Summary**: Brief description of changes

Example:
```
🦋  Which packages would you like to include?
› [x] p0-ts-sdk

🦋  Which type of change is this for p0-ts-sdk?
› minor

🦋  Please enter a summary for this change:
Add support for new oracle price feeds
```

This creates a markdown file in `.changeset/` describing your changes.

### 3. Commit the Changeset

```bash
git add .changeset/
git commit -m "Add changeset for new oracle support"
git push
```

### 4. Version Bump (When Ready to Release)

When you're ready to publish, consume all changesets and bump versions:

```bash
pnpm version
```

This will:
- Update `package.json` version
- Update `CHANGELOG.md`
- Delete consumed changeset files
- Create a version commit

```bash
git add .
git commit -m "Version packages"
git push
```

### 5. Publish to npm

```bash
# Ensure you're logged in
npm whoami

# Build and publish
pnpm release
```

This will:
1. Build the package (`pnpm build`)
2. Publish to npm (`changeset publish`)
3. Create git tags for the release

### 6. Push Tags

```bash
git push --follow-tags
```

## 📝 Examples

### Example: Bug Fix Release (Patch)

```bash
# Fix a bug
vim src/utils/calculations.ts

# Create changeset
pnpm changeset
# Select: patch
# Summary: "Fix calculation overflow in computeHealthFactor"

# Commit
git add .
git commit -m "Fix health factor calculation overflow"
git push

# When ready to release
pnpm version
git push

pnpm release
git push --follow-tags
```

### Example: New Feature (Minor)

```bash
# Add new feature
vim src/services/new-feature.ts

# Create changeset
pnpm changeset
# Select: minor
# Summary: "Add support for Jupiter swap integration"

# Commit and release as above
```

### Example: Breaking Change (Major)

```bash
# Make breaking change
vim src/models/client.ts

# Create changeset
pnpm changeset
# Select: major
# Summary: "BREAKING: Rename MarginfiClient to Project0Client"

# Commit and release as above
```

## 🔄 CI/CD Integration (Optional)

For automated releases, you can set up GitHub Actions:

### `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          registry-url: 'https://registry.npmjs.org'
      
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 📊 Version Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
  - API changes that break existing code
  - Removed functionality
  - Changed behavior that breaks compatibility

- **MINOR** (1.x.0): New features (backwards compatible)
  - New functions/methods
  - New exports
  - New optional parameters
  - Deprecations (but not removals)

- **PATCH** (1.0.x): Bug fixes
  - Bug fixes
  - Performance improvements
  - Documentation updates
  - Internal refactoring (no API changes)

## 🛡️ Pre-release Checklist

Before running `pnpm release`, verify:

- ✅ All tests pass: `pnpm test`
- ✅ Builds successfully: `pnpm build`
- ✅ Linting passes: `pnpm lint`
- ✅ Type checking passes: `pnpm typecheck`
- ✅ Examples work: `cd examples && tsx 01-deposit.ts`
- ✅ CHANGELOG.md looks correct
- ✅ Version number is correct in package.json
- ✅ You're logged into npm: `npm whoami`

## 🚨 Troubleshooting

### "You need to be logged in to publish"

```bash
npm login
```

### "You do not have permission to publish"

Ensure your npm account has access to the `p0-ts-sdk` package, or publish with scope:

```json
// package.json
{
  "name": "@your-org/p0-ts-sdk"
}
```

### "Version already exists"

You've already published this version. Bump the version:

```bash
pnpm version
```

### Accidental Publish

You can unpublish within 72 hours (but it's discouraged):

```bash
npm unpublish p0-ts-sdk@1.2.3
```

## 📚 Additional Resources

- [Changesets Documentation](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Semantic Versioning](https://semver.org/)
- [npm Publishing Guide](https://docs.npmjs.com/cli/v9/commands/npm-publish)
