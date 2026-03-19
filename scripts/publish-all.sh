#!/bin/bash
set -e

# DOT Protocol — publish all 8 packages to npm
# Run from: projects/dot-protocol/
# Usage: ./scripts/publish-all.sh [--dry-run]

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "Dry run mode"
fi

PACKAGES=(
  "packages/core"
  "packages/compression"
  "packages/chain"
  "packages/identity"
  "packages/relay"
  "packages/wrapper"
  "packages/sdk"
  "packages/engine"
)

echo "Building all packages..."
pnpm -r build

echo "Running tests..."
pnpm -r test

echo "Publishing packages..."
for pkg in "${PACKAGES[@]}"; do
  echo "Publishing $pkg..."
  cd "$pkg"
  npm publish --access public $DRY_RUN
  cd -
done

echo "All packages published"
