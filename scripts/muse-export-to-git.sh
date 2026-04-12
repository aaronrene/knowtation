#!/usr/bin/env bash
# Export a Muse snapshot at REF to a Git working tree and optionally commit + push.
# Canonical VCS: MuseHub. Git is a one-way mirror for CI/CD (see docs/MUSE-GITHUB-MIRROR.md).
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: muse-export-to-git.sh [options] <GIT_REPO_DIR>

  --muse-dir DIR     Muse repository root (default: current directory)
  --ref REF          Branch, tag, or commit to archive (default: HEAD)
  --git-branch NAME  Branch to commit and push in GIT_REPO_DIR (default: current branch)
  --dry-run          Show Muse commit id and file count; do not modify Git repo
  --no-push          Commit but do not push
  -h, --help         This help

Environment:
  GIT_COMMITTER_NAME / GIT_COMMITTER_EMAIL — optional override for the mirror commit

Example:
  ./scripts/muse-export-to-git.sh --muse-dir ~/knowtation-muse --ref main ~/knowtation-git
  ./scripts/muse-export-to-git.sh --dry-run ~/knowtation-git
USAGE
}

MUSE_DIR="${MUSE_DIR:-.}"
REF="HEAD"
GIT_BRANCH=""
DRY_RUN=0
NO_PUSH=0
GIT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --muse-dir)
      MUSE_DIR="$2"
      shift 2
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    --git-branch)
      GIT_BRANCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-push)
      NO_PUSH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$GIT_DIR" ]]; then
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      GIT_DIR="$1"
      shift
      ;;
  esac
done

if [[ -z "${GIT_DIR}" ]]; then
  echo "Error: GIT_REPO_DIR is required." >&2
  usage >&2
  exit 1
fi

if ! command -v muse >/dev/null 2>&1; then
  echo "Error: 'muse' not found on PATH." >&2
  exit 1
fi

if [[ ! -d "${MUSE_DIR}/.muse" ]]; then
  echo "Error: Not a Muse repo (missing ${MUSE_DIR}/.muse)." >&2
  exit 1
fi

if [[ ! -d "${GIT_DIR}/.git" ]]; then
  echo "Error: Not a Git repo (missing ${GIT_DIR}/.git)." >&2
  exit 1
fi

COMMIT_ID="$(muse -C "${MUSE_DIR}" rev-parse "${REF}" --format text)"
ARCHIVE="$(mktemp -t muse-archive.XXXXXX.tar.gz)"
EXTRACT="$(mktemp -d -t muse-export.XXXXXX)"

cleanup() {
  rm -f "${ARCHIVE}"
  rm -rf "${EXTRACT}"
}
trap cleanup EXIT

muse -C "${MUSE_DIR}" archive --ref "${REF}" --format tar.gz --output "${ARCHIVE}"

FILE_COUNT="$(tar tzf "${ARCHIVE}" | wc -l | tr -d ' ')"

echo "Muse commit: ${COMMIT_ID}"
echo "Archived files: ${FILE_COUNT}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[dry-run] Skipping Git import, commit, and push."
  exit 0
fi

tar xzf "${ARCHIVE}" -C "${EXTRACT}"

cd "${GIT_DIR}"
if [[ -n "${GIT_BRANCH}" ]]; then
  if git show-ref --verify --quiet "refs/heads/${GIT_BRANCH}"; then
    git checkout "${GIT_BRANCH}"
  elif git show-ref --verify --quiet "refs/remotes/origin/${GIT_BRANCH}"; then
    git checkout -B "${GIT_BRANCH}" "origin/${GIT_BRANCH}"
  else
    git checkout -B "${GIT_BRANCH}" HEAD
  fi
else
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required." >&2
  exit 1
fi

rsync -a --delete --exclude='.git/' "${EXTRACT}/" "${GIT_DIR}/"

git add -A
MSG="mirror: muse ${COMMIT_ID}"

if git diff --staged --quiet; then
  echo "Git tree already matches Muse snapshot; nothing to commit."
  exit 0
fi

git commit -m "${MSG}"

if [[ "${NO_PUSH}" -eq 1 ]]; then
  echo "[--no-push] Skipping git push."
  exit 0
fi

git push origin "${GIT_BRANCH}"

echo "Pushed mirror commit to origin/${GIT_BRANCH}"
