#!/usr/bin/env bash
set -euo pipefail

# Deterministic release-candidate gate. It intentionally does not compile Move
# or start a node: e2e-local.sh owns that coverage. It proves both normal and
# prerelease tarballs before either exact version needs to exist in npm.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/movehat-candidate.XXXXXX")"
PACKAGE_README="${PROJECT_ROOT}/packages/movehat/README.md"
PACKAGE_README_BACKUP="${TMP_ROOT}/package-README.md"
cp "${PACKAGE_README}" "${PACKAGE_README_BACKUP}"

cleanup() {
  # `npm pack` runs the package's existing prepack hook, which synchronizes
  # the root README into packages/movehat. Keep this verification gate
  # observational so a local run never dirties the caller's worktree.
  cp "${PACKAGE_README_BACKUP}" "${PACKAGE_README}"
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

verify_tarball() (
  local tarball_path="$1"
  local label="$2"
  local install_root="${TMP_ROOT}/cli-${label}"
  local project_dir="${TMP_ROOT}/project-${label}"

  mkdir -p "${install_root}"
  npm install --prefix "${install_root}" --no-save "${tarball_path}" >/dev/null
  node "${install_root}/node_modules/movehat/bin/movehat.js" init "${project_dir}" >/dev/null

  local packed_version
  local scaffold_pin
  packed_version=$(node -p "require('${install_root}/node_modules/movehat/package.json').version")
  scaffold_pin=$(node -p "require('${project_dir}/package.json').dependencies.movehat")
  test "${scaffold_pin}" = "${packed_version}" || {
    echo "Scaffold pin '${scaffold_pin}' does not match candidate '${packed_version}'" >&2
    exit 1
  }

  cd "${project_dir}"
  npm install --no-save "${tarball_path}" >/dev/null
  local installed_version
  local pin_after_install
  installed_version=$(node -p "require('./node_modules/movehat/package.json').version")
  pin_after_install=$(node -p "require('./package.json').dependencies.movehat")
  test "${installed_version}" = "${packed_version}" || {
    echo "Installed '${installed_version}', expected candidate '${packed_version}'" >&2
    exit 1
  }
  test "${pin_after_install}" = "${packed_version}" || {
    echo "Candidate install rewrote exact pin '${packed_version}' to '${pin_after_install}'" >&2
    exit 1
  }
  npx tsc --noEmit
  echo "Candidate tarball ${packed_version} scaffolded, installed, and typechecked."
)

cd "${PROJECT_ROOT}"
pnpm build:movehat >/dev/null

cd "${PROJECT_ROOT}/packages/movehat"
PACK_OUTPUT=$(npm pack --pack-destination "${TMP_ROOT}" --silent)
TARBALL_NAME=$(printf '%s\n' "${PACK_OUTPUT}" | tail -1)
TARBALL_PATH="${TMP_ROOT}/${TARBALL_NAME}"
test -f "${TARBALL_PATH}"

ORIGINAL_VERSION=$(node -p "require('./package.json').version")
verify_tarball "${TARBALL_PATH}" "original"

# Build a second tarball from the packed artifact, changing only its version.
# This exercises the opposite release form without mutating the worktree:
# normal candidates get an rc counterpart; prereleases get a normal one.
VARIANT_ROOT="${TMP_ROOT}/variant"
mkdir -p "${VARIANT_ROOT}"
tar -xzf "${TARBALL_PATH}" -C "${VARIANT_ROOT}"
if [[ "${ORIGINAL_VERSION}" == *-* ]]; then
  VARIANT_VERSION="${ORIGINAL_VERSION%%-*}"
else
  VARIANT_VERSION="${ORIGINAL_VERSION}-rc.0"
fi
node -e '
  const fs = require("fs");
  const manifestPath = process.argv[1];
  const version = process.argv[2];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  delete manifest.scripts.prepack;
  delete manifest.scripts.prepublishOnly;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
' "${VARIANT_ROOT}/package/package.json" "${VARIANT_VERSION}"

cd "${VARIANT_ROOT}/package"
VARIANT_OUTPUT=$(npm pack --pack-destination "${TMP_ROOT}" --silent)
VARIANT_NAME=$(printf '%s\n' "${VARIANT_OUTPUT}" | tail -1)
verify_tarball "${TMP_ROOT}/${VARIANT_NAME}" "variant"
