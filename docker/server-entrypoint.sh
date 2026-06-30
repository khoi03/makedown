#!/bin/sh
# Ensure every workspace under the root is a git repo (snapshots/branches need
# git), then start the Makedown server. Operates on the container's own copy of
# the workspaces, so it never touches a bind-mounted host repo's history unless
# you mount one without a .git of its own.
set -e

ROOT="${MAKEDOWN_WORKSPACES_ROOT:-/workspaces}"
git config --global user.email "makedown@localhost" >/dev/null 2>&1 || true
git config --global user.name "Makedown" >/dev/null 2>&1 || true
git config --global init.defaultBranch main >/dev/null 2>&1 || true
git config --global --add safe.directory '*' >/dev/null 2>&1 || true

if [ -d "$ROOT" ]; then
  for dir in "$ROOT"/*/; do
    [ -f "${dir}build.md" ] || continue
    if [ ! -d "${dir}.git" ]; then
      echo "[makedown] initializing git repo for workspace: ${dir}"
      git -C "$dir" init -q
      git -C "$dir" add -A
      git -C "$dir" commit -qm "Initial workspace state" >/dev/null 2>&1 || true
    fi
  done
fi

exec node apps/server/dist/main.js
