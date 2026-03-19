#!/bin/bash
set -e

# DOT Protocol — publish 2 packages to npm
# Run from: projects/dot-protocol/
# Usage: ./scripts/publish-all.sh [--dry-run]

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "Dry run mode"
fi

# Internal packages (core, chain, compression, identity, relay, wrapper, sdk)
# are private — they build but don't publish separately.
# Only 2 packages reach npm:
PACKAGES=(
  "packages/engine"   # → dot-protocol
  "packages/kin"      # → dot-protocol-kin
)

echo "Building all packages..."
pnpm -r build

echo "Running tests..."
pnpm --filter dot-protocol test

echo ""
for pkg in "${PACKAGES[@]}"; do
  name=$(node -p "require('./$pkg/package.json').name")
  version=$(node -p "require('./$pkg/package.json').version")
  echo "Publishing $name@$version..."
  cd "$pkg"
  npm publish --access public $DRY_RUN
  cd ../..
done

echo ""
echo "Published:"
echo "  npm install dot-protocol"
echo "  npm install dot-protocol-kin"
