# DynamoPy release workflow

CI setup for the **AxioforceDynamoPy** repo that powers FluxDeluxe's hot-update
system. Copy `release.yml` below into `.github/workflows/release.yml` in the
DynamoPy repo.

## What it does

Every push to the configured **stable** or **beta** branch packages the Python
backend into a zip and publishes it as a GitHub Release tagged by channel:

| Channel | Tag format              | Default branch    |
|---------|-------------------------|-------------------|
| stable  | `stable-v<timestamp>`   | `main`            |
| beta    | `beta-v<timestamp>`     | `staging/merge`   |

Any push to a branch that isn't mapped to a channel is ignored (no release).

Timestamps are UTC and sort lexicographically (e.g. `20260423T140000Z`) so the
newest release in a channel is always the alphabetically-greatest tag.

## Branch-to-channel mapping is controlled by repo variables

The workflow reads two **GitHub Actions repository variables** to decide which
branch maps to which channel:

| Variable         | Purpose                                   | Default          |
|------------------|-------------------------------------------|------------------|
| `STABLE_BRANCH`  | Source branch for the stable channel      | `main`           |
| `BETA_BRANCH`    | Source branch for the beta channel        | `staging/merge`  |

**To set or change these:**
GitHub → repo → Settings → Secrets and variables → Actions → **Variables** tab → **New repository variable**.

So when `staging/merge` becomes obsolete and you switch to a new dev branch,
just change `BETA_BRANCH`'s value in repo settings. No workflow edit required.

## Workflow file

Save this as `.github/workflows/release.yml` in the DynamoPy repo:

```yaml
name: Release

on:
  push:
    branches: ['**']
  # Manual trigger to force a release from any branch (channel chosen by user)
  workflow_dispatch:
    inputs:
      channel:
        description: 'Channel'
        required: true
        default: 'beta'
        type: choice
        options: [stable, beta]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Determine channel
        id: ch
        env:
          STABLE_BRANCH: ${{ vars.STABLE_BRANCH || 'main' }}
          BETA_BRANCH:   ${{ vars.BETA_BRANCH   || 'staging/merge' }}
        run: |
          BRANCH="${GITHUB_REF#refs/heads/}"
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            CHANNEL="${{ inputs.channel }}"
          elif [[ "$BRANCH" == "$STABLE_BRANCH" ]]; then
            CHANNEL="stable"
          elif [[ "$BRANCH" == "$BETA_BRANCH" ]]; then
            CHANNEL="beta"
          else
            echo "Branch '$BRANCH' is not mapped to a channel; skipping."
            echo "  STABLE_BRANCH = $STABLE_BRANCH"
            echo "  BETA_BRANCH   = $BETA_BRANCH"
            echo "skip=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          TS=$(date -u +%Y%m%dT%H%M%SZ)
          TAG="${CHANNEL}-v${TS}"
          echo "branch=$BRANCH"    >> "$GITHUB_OUTPUT"
          echo "channel=$CHANNEL"  >> "$GITHUB_OUTPUT"
          echo "tag=$TAG"          >> "$GITHUB_OUTPUT"
          echo "zip=${TAG}.zip"    >> "$GITHUB_OUTPUT"

      - name: Package DynamoPy
        if: steps.ch.outputs.skip != 'true'
        run: |
          mkdir -p /tmp/bundle
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
        if: steps.ch.outputs.skip != 'true'
        run: |
          cd /tmp
          sha256sum "${{ steps.ch.outputs.zip }}" > "${{ steps.ch.outputs.zip }}.sha256"

      - name: Create GitHub Release
        if: steps.ch.outputs.skip != 'true'
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

## Rollout

1. Add the variables in repo Settings → Variables (if you don't, defaults kick in: `main` and `staging/merge`).
2. Commit this workflow file to the branch(es) you want to publish from. **It must exist on the branch being pushed**, otherwise GitHub won't run it.
3. Push. You should see a run in the Actions tab and a new release under Releases.

### To start with just `staging/merge` (beta):

1. Switch the repo's default branch view to `staging/merge`
2. Create `.github/workflows/release.yml` on `staging/merge`
3. Commit. The commit itself triggers a run and produces the first `beta-v<ts>` release
4. Later, when you want stable too, cherry-pick or merge the workflow file onto `main`

## Changing which branch is beta

Say you retire `staging/merge` and move to a new dev branch like `develop`:

1. Repo → Settings → Secrets and variables → Actions → Variables → edit `BETA_BRANCH` → set to `develop`
2. Make sure `develop` has the workflow file (merge it in from the previous beta branch)
3. Next push to `develop` produces a new `beta-v<ts>` release
4. The old beta branch (`staging/merge`) still has the workflow file but pushes to it will now log "Branch not mapped, skipping" and do nothing

No release cleanup required — past `beta-v<ts>` releases stay in the Releases page as history.

## What other DynamoPy users see

- New entries in the Releases tab a few times per week
- Stable releases show as "Latest release" (same as a manual release)
- Beta releases carry the `Pre-release` label so they don't outrank stable in the UI
- No existing code, tags, or branches are modified

## Uninstalling

Delete `.github/workflows/release.yml`. Past releases stay in place (tag
deletion is manual if you want to tidy).
