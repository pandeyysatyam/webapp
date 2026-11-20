#!/bin/bash
set -euo pipefail

dnf update -y
dnf install -y nodejs npm git

git clone ${app_repo_url} /opt/app

cd /opt/app/app
npm install --omit=dev

cat > /etc/app.env <<EOF
AWS_REGION=${region}
DB_SECRET_ARN=${secret_arn}
DB_HOST=${db_host}
DB_PORT=3306
PORT=${app_port}
EOF

cat > /etc/systemd/system/app.service <<'EOF'
[Unit]
Description=Web application
After=network.target

[Service]
EnvironmentFile=/etc/app.env
WorkingDirectory=/opt/app/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now app
