#!/usr/bin/env bash
# Install two independent system services after configuring and staging the worker.
set -euo pipefail
repo=${1:?Supply the absolute worker checkout path}
node=${2:?Supply the absolute Node 22 executable path}
worker_user=${3:-tape-worker}
[[ $EUID == 0 ]] || { echo 'Run as root to install services.'; exit 1; }
[[ $repo =~ ^/[A-Za-z0-9_./-]+$ && $node =~ ^/[A-Za-z0-9_./-]+$ && $worker_user =~ ^[a-z][a-z0-9-]+$ ]] || exit 1
test -x "$node"
test -f "$repo/.conference-runner/config.json"
test -f "$repo/.conference-runner/portal.json"
id "$worker_user" >/dev/null
for name in tape-conferences tape-conference-portal; do
  test ! -e "/etc/systemd/system/$name.service" || { echo "$name already installed; inspect before replacing."; exit 1; }
done
for name in tape-conferences tape-conference-portal; do
  command='scripts/conference-worker.ts run'
  [[ $name == tape-conference-portal ]] && command='scripts/conference-portal-bridge.ts'
  cat > "/etc/systemd/system/$name.service" <<EOF
[Unit]
Description=Tape conference ${name}
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$worker_user
WorkingDirectory=$repo
Environment=PATH=$(dirname "$node"):/usr/local/bin:/usr/bin:/bin
ExecStart=$node --import tsx $command
Restart=on-failure
RestartSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$repo
[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
systemctl enable --now tape-conferences.service tape-conference-portal.service
systemctl is-active tape-conferences.service tape-conference-portal.service
