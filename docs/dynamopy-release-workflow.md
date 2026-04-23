# DynamoPy release workflow

This file documents the CI setup required in the **AxioforceDynamoPy** repo to
power the FluxDeluxe hot-update system. Copy `release.yml` below into
`.github/workflows/release.yml` in the DynamoPy repo.

## What it does

On every push to a branch, packages the Python backend into a zip and creates a
GitHub Release tagged by **channel**:

| Source branch            | Channel | Tag format                                 |
|--------------------------|---------|--------------------------------------------|
| `main`                   | stable  | `stable-v<timestamp>`                      |
| `staging/merge`          | beta    | `beta-v<timestamp>`                        |
| anything else            | edge    | `edge-<branch-slug>-v<timestamp>`          |

Timestamp is UTC and sorts lexicographically (e.g. `20260423T130000Z`) so
"latest" is the alphabetically-largest tag in a channel.

## Client-side filtering

FluxDeluxe will filter releases by tag prefix:

- Stable channel → tags starting with `stable-`
- Beta channel → tags starting with `beta-`
- Other channel with branch `<foo>` → tags starting with `edge-<foo-slug>-`

"Latest" in a channel = the release with the alphabetically-greatest tag.

## Workflow file

Save this as `.github/workflows/release.yml` in the DynamoPy repo:

```yaml
name: Release

on:
  push:
    branches: ['**']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Determine channel + slug
        id: ch
        run: |
          BRANCH="${GITHUB_REF#refs/heads/}"
          # Channel mapping
          if [[ "$BRANCH" == "main" ]]; then
            CHANNEL="stable"
            PREFIX="stable"
          elif [[ "$BRANCH" == "staging/merge" ]]; then
            CHANNEL="beta"
            PREFIX="beta"
          else
            CHANNEL="edge"
            # Slugify: replace everything not [a-z0-9] with '-', lowercase
            SLUG=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//; s/-$//')
            PREFIX="edge-$SLUG"
          fi
          TS=$(date -u +%Y%m%dT%H%M%SZ)
          TAG="${PREFIX}-v${TS}"
          echo "branch=$BRANCH" >> "$GITHUB_OUTPUT"
          echo "channel=$CHANNEL" >> "$GITHUB_OUTPUT"
          echo "prefix=$PREFIX"  >> "$GITHUB_OUTPUT"
          echo "tag=$TAG"        >> "$GITHUB_OUTPUT"
          echo "zip=${PREFIX}-v${TS}.zip" >> "$GITHUB_OUTPUT"

      - name: Package DynamoPy
        run: |
          mkdir -p /tmp/bundle
          # Copy repo contents, excluding VCS + cache detritus
          rsync -a \
            --exclude='.git' \
            --exclude='.github' \
            --exclude='__pycache__' \
            --exclude='*.pyc' \
            --exclude='.pytest_cache' \
            --exclude='.venv' \
            --exclude='venv' \
            ./ /tmp/bundle/
          cd /tmp && zip -r "${{ steps.ch.outputs.zip }}" bundle

      - name: Generate checksum
        run: |
          cd /tmp
          sha256sum "${{ steps.ch.outputs.zip }}" > "${{ steps.ch.outputs.zip }}.sha256"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.ch.outputs.tag }}
          name: ${{ steps.ch.outputs.tag }}
          body: |
            Channel: ${{ steps.ch.outputs.channel }}
            Branch: ${{ steps.ch.outputs.branch }}
            Commit: ${{ github.sha }}
          files: |
            /tmp/${{ steps.ch.outputs.zip }}
            /tmp/${{ steps.ch.outputs.zip }}.sha256
          draft: false
          prerelease: ${{ steps.ch.outputs.channel != 'stable' }}
```

## Notes

- `permissions: contents: write` is required so the workflow can create releases.
  If the DynamoPy repo uses a GitHub App / fine-grained PAT for CI, grant
  Contents: read/write.
- `softprops/action-gh-release@v2` is a well-maintained third-party action for
  uploading release assets. Official `actions/create-release` is deprecated.
- Timestamp tags avoid the need for a shared version counter. If the team prefers
  semver, replace the tag generator with logic that reads the latest existing
  tag in the channel and bumps it.
- `prerelease: true` for beta/edge keeps them from surfacing as "latest" in the
  GitHub UI (the client doesn't care; it filters by prefix explicitly).

## Opt-out per branch (future refinement)

If edge releases become too noisy, gate the job on a file marker:

```yaml
    if: hashFiles('.dynamorelease') != '' || github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging/merge'
```

Branches that want to publish add a `.dynamorelease` file to opt in. Not needed
for initial rollout.
