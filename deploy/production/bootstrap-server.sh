#!/usr/bin/env bash

set -Eeuo pipefail

deploy_user="${1:-ubuntu}"
deploy_root="${2:-/opt/new-api-async-staging}"

if [[ $(id -u) -ne 0 ]]; then
  printf 'Run this script as root.\n' >&2
  exit 1
fi

if ! id "$deploy_user" >/dev/null 2>&1; then
  printf 'Deploy user does not exist: %s\n' "$deploy_user" >&2
  exit 1
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0755 "$deploy_root"
install -m 0755 "$script_dir/new-api-production-deploy" /usr/local/sbin/new-api-production-deploy
install -m 0755 "$script_dir/new-api-production-rollback" /usr/local/sbin/new-api-production-rollback
install -m 0644 "$script_dir/compose.release.yml" "$deploy_root/compose.release.yml"

sudoers_file="/etc/sudoers.d/new-api-production-release"
sudoers_candidate=$(mktemp)
trap 'rm -f "$sudoers_candidate"' EXIT
cat >"$sudoers_candidate" <<EOF
$deploy_user ALL=(root) NOPASSWD: /usr/local/sbin/new-api-production-deploy, /usr/local/sbin/new-api-production-rollback
EOF
chmod 0440 "$sudoers_candidate"
visudo -cf "$sudoers_candidate"
install -m 0440 "$sudoers_candidate" "$sudoers_file"

printf 'Production release commands installed for user %s.\n' "$deploy_user"
