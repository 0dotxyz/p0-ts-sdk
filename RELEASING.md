# Release Process

`@0dotxyz/p0-ts-sdk` is versioned with [Changesets](https://github.com/changesets/changesets) and published to npm by GitHub Actions ([`release.yml`](.github/workflows/release.yml)), through npm trusted publishing: no npm token exists anywhere, and every version carries a provenance attestation.

## Branches and dist-tags

| Branch    | Line                      | Versions       | npm dist-tag                                     |
| --------- | ------------------------- | -------------- | ------------------------------------------------ |
| `main`    | v3 (Solana Kit)           | `3.0.0-next.N` | `next` while in pre mode, `latest` from 3.0.0 on |
| `main-v2` | v2 (web3.js), maintenance | `2.x`          | `latest` until 3.0.0, then `v2`                  |

The two lines are never merged into each other; a fix needed on both is made on each.

## Releasing

1. **Add a changeset in your PR.** Run `pnpm changeset`, pick the bump, and write the summary consumers will read in the changelog:

   | Bump    | When                                 |
   | ------- | ------------------------------------ |
   | `patch` | Bug fixes, docs, internal refactors  |
   | `minor` | New features, backwards compatible   |
   | `major` | Breaking API changes                 |

2. **Merge the PR.** On `main` or `main-v2`, the release workflow opens (or updates) a `chore: release` PR that applies the pending changesets: the `package.json` version, `CHANGELOG.md`, and the consumed changeset files.

3. **Merge the `chore: release` PR** when you want to ship. The publish job then waits for approval on the `npm` environment.

4. **Approve the deployment** in the workflow run. The job runs typecheck and tests, publishes (the build runs in `prepublishOnly`), and pushes the `vX.Y.Z` tag.

5. **Check the dist-tags:** `npm dist-tag ls @0dotxyz/p0-ts-sdk`.

A prerelease (`3.0.0-next.1`) is published under its identifier (`next`); a stable version under `publishConfig.tag` if `package.json` sets one, otherwise `latest`.

## Pre mode

`main` is in Changesets pre mode with the `next` tag (`.changeset/pre.json`), so release PRs produce `3.0.0-next.N`. To ship 3.0.0:

```bash
pnpm changeset pre exit   # commit; the next release PR versions 3.0.0
```

At the same time, set `"publishConfig": { "access": "public", "tag": "v2" }` on `main-v2`, so v2 releases stop taking `latest`.

To start a new prerelease line later: `pnpm changeset pre enter <tag>` (e.g. `alpha`).

## One-time setup

- **npm:** on the package's settings page, add a trusted publisher: GitHub Actions, repository `0dotxyz/p0-ts-sdk`, workflow `release.yml`, environment `npm`. Keep "Require two-factor authentication and disallow tokens" on; trusted publishing still works.
- **GitHub environment:** Settings → Environments → `npm`, with the release approvers as required reviewers and deployments limited to `main` and `main-v2`.
- **GitHub Actions:** Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests", so the workflow can open the release PR.
- **Branch protection** for `main` and `main-v2`, requiring the CI checks. The release PR is opened with the workflow token, and GitHub doesn't run workflows for PRs opened that way: merge it as an admin, or have the workflow use a GitHub App token instead of `GITHUB_TOKEN`.

## Manual fallback

If the workflow can't publish (e.g. npm is down), a maintainer with publish rights can, from a clean checkout of the release commit:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test
npm publish --tag <next|latest|v2>   # 2FA prompt; prepublishOnly builds
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Troubleshooting

- **Publish job didn't start:** it only runs once no changesets are pending and the `package.json` version isn't on npm yet.
- **`ENEEDAUTH` / 404 on publish:** the trusted publisher on npm doesn't match the repository, workflow file name or environment.
- **Wrong dist-tag:** `npm dist-tag add @0dotxyz/p0-ts-sdk@X.Y.Z <tag>`.
- **Bad release:** publish a fixed version rather than unpublishing; `npm deprecate @0dotxyz/p0-ts-sdk@X.Y.Z "<reason>"` warns anyone installing it.
