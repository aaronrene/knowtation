#!/usr/bin/env bash
######################################################################
# Paperclip orchestrator — one-shot install on Ubuntu 24.04 LTS
#
# Run AS ROOT (or via `sudo bash install.sh`) on a fresh AWS t3.medium
# provisioned by deploy/paperclip/terraform.
#
# Idempotent: safe to re-run. Skips steps already complete.
#
# What this does:
#   1. Creates 'paperclip' service user (locked-down, no shell)
#   2. Installs Node 20 LTS via NodeSource
#   3. Installs pnpm
#   4. Installs PostgreSQL 16 + creates database 'paperclip' + role 'paperclip'
#   5. Clones Paperclip from PAPERCLIP_REPO_URL into /opt/paperclip
#   6. Builds all workspace packages (tsc → dist/) + patches subpath exports
#   7. Runs Paperclip migrations
#   8. Installs nginx + certbot (Let's Encrypt)
#   9. Configures nginx reverse proxy (HTTP-only by default; you add HTTPS via certbot if desired)
#  10. Installs systemd service 'paperclip.service' (runs compiled JS, no tsx runtime)
#  11. Loads SSM secrets into the systemd EnvironmentFile every 60 seconds via 'paperclip-secrets-sync.timer'
#
# What this does NOT do:
#   - Push secrets (run scripts/push-secrets.sh after this completes)
#   - Wire Knowtation MCP (run scripts/wire-knowtation-mcp.sh after secrets)
#   - Load skills/agents (run scripts/load-skills-and-agents.sh after MCP)
######################################################################

set -euo pipefail

############
# Settings
############

# Paperclip source — public upstream (default branch is master).
# Override with forks via: PAPERCLIP_REPO_URL=... PAPERCLIP_REPO_REF=... when invoking install.sh
: "${PAPERCLIP_REPO_URL:=https://github.com/paperclipai/paperclip.git}"
: "${PAPERCLIP_REPO_REF:=master}"
: "${PAPERCLIP_INSTALL_DIR:=/opt/paperclip}"
: "${PAPERCLIP_USER:=paperclip}"
: "${PAPERCLIP_DB:=paperclip}"
: "${PAPERCLIP_PORT:=3000}"
: "${SSM_NAMESPACE:=/knowtation/paperclip/}"
# When install is run as `curl … | bash`, $0 is bash — operator assets are fetched from this raw URL instead.
: "${KNOWTATION_RAW_DEPLOY_BASE:=https://raw.githubusercontent.com/aaronrene/knowtation/main/deploy/paperclip}"

LOG_FILE=/var/log/paperclip-install.log
exec > >(tee -a "$LOG_FILE") 2>&1
echo "[$(date -u +%FT%TZ)] install.sh starting"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: install.sh must run as root. Use 'sudo bash install.sh'."
  exit 1
fi

if ! command -v aws &>/dev/null; then
  echo "ERROR: AWS CLI not installed. Did user-data run? Re-install with:"
  echo "  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install"
  exit 1
fi

REGION=$(curl -fsSL -H "X-aws-ec2-metadata-token: $(curl -fsSL -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" 'http://169.254.169.254/latest/meta-data/placement/region' || echo 'us-west-2')
echo "[install] AWS region detected: $REGION"

#####################
# 1. Service user
#####################

if ! id -u "$PAPERCLIP_USER" &>/dev/null; then
  echo "[install] Creating service user: $PAPERCLIP_USER"
  useradd --system --home-dir "$PAPERCLIP_INSTALL_DIR" --shell /usr/sbin/nologin "$PAPERCLIP_USER"
else
  echo "[install] Service user $PAPERCLIP_USER already exists, skipping"
fi

#####################
# 2. Node 20 LTS
#####################

if ! node -v 2>/dev/null | grep -q '^v20'; then
  echo "[install] Installing Node 20 LTS via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[install] Node 20 already installed: $(node -v)"
fi

#####################
# 3. pnpm
#####################

if ! command -v pnpm &>/dev/null; then
  echo "[install] Installing pnpm via corepack"
  corepack enable
  corepack prepare pnpm@latest --activate
else
  echo "[install] pnpm already installed: $(pnpm -v)"
fi

#####################
# 4. PostgreSQL 16
#####################

if ! command -v psql &>/dev/null; then
  echo "[install] Installing PostgreSQL 16"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/pgdg.gpg
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-16 postgresql-contrib-16
  systemctl enable --now postgresql
else
  echo "[install] PostgreSQL already installed: $(psql --version)"
fi

# Create database + role (idempotent).
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = '$PAPERCLIP_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE $PAPERCLIP_USER WITH LOGIN PASSWORD '$(openssl rand -hex 16)';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$PAPERCLIP_DB'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $PAPERCLIP_DB OWNER $PAPERCLIP_USER;"

#####################
# 5. Clone Paperclip
#####################

if [[ ! -d "$PAPERCLIP_INSTALL_DIR/.git" ]]; then
  echo "[install] Cloning Paperclip from $PAPERCLIP_REPO_URL@$PAPERCLIP_REPO_REF"
  rm -rf "$PAPERCLIP_INSTALL_DIR"
  git clone --branch "$PAPERCLIP_REPO_REF" "$PAPERCLIP_REPO_URL" "$PAPERCLIP_INSTALL_DIR"
else
  echo "[install] Paperclip already cloned, fetching latest on $PAPERCLIP_REPO_REF"
  cd "$PAPERCLIP_INSTALL_DIR"
  git fetch origin "$PAPERCLIP_REPO_REF"
  git checkout "$PAPERCLIP_REPO_REF"
  git pull --ff-only origin "$PAPERCLIP_REPO_REF"
fi

# Mirror Knowtation deploy artifacts into /opt/paperclip (scripts, skills, agents).
# Piped installs (`curl | bash`): $0 is bash — local DEPLOY_DIR is wrong; fetch from KNOWTATION_RAW_DEPLOY_BASE.
mkdir -p "$PAPERCLIP_INSTALL_DIR/scripts" "$PAPERCLIP_INSTALL_DIR/skills" "$PAPERCLIP_INSTALL_DIR/agents"
DEPLOY_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != bash && "${BASH_SOURCE[0]}" != */bash ]]; then
  DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [[ -f "$(readlink -f "$0" 2>/dev/null || true)" ]]; then
  DEPLOY_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
fi
if [[ -n "$DEPLOY_DIR" && -f "$DEPLOY_DIR/scripts/push-secrets.sh" ]]; then
  echo "[install] Copying operator scripts from $DEPLOY_DIR/scripts"
  cp -f "$DEPLOY_DIR"/scripts/*.sh "$PAPERCLIP_INSTALL_DIR/scripts/"
else
  echo "[install] Fetching operator scripts from $KNOWTATION_RAW_DEPLOY_BASE/scripts/"
  for f in push-secrets.sh hello-world-test.sh wire-knowtation-mcp.sh load-skills-and-agents.sh run-controller.sh; do
    curl -fsSL "$KNOWTATION_RAW_DEPLOY_BASE/scripts/$f" -o "$PAPERCLIP_INSTALL_DIR/scripts/$f"
  done
fi
chmod +x "$PAPERCLIP_INSTALL_DIR/scripts/"*.sh 2>/dev/null || true

if [[ -n "$DEPLOY_DIR" && -d "$DEPLOY_DIR/skills" ]]; then
  cp -rf "$DEPLOY_DIR"/skills/* "$PAPERCLIP_INSTALL_DIR/skills/" 2>/dev/null || true
  cp -rf "$DEPLOY_DIR"/agents/* "$PAPERCLIP_INSTALL_DIR/agents/" 2>/dev/null || true
else
  echo "[install] Fetching skills from $KNOWTATION_RAW_DEPLOY_BASE/skills/"
  SKILL_FILES=(
    write-draft.mjs search-vault.mjs read-style-guide.mjs read-positioning.mjs read-playbook.mjs
    hub-client.mjs heygen-render.mjs elevenlabs-tts.mjs descript-import.mjs
  )
  for f in "${SKILL_FILES[@]}"; do
    curl -fsSL "$KNOWTATION_RAW_DEPLOY_BASE/skills/$f" -o "$PAPERCLIP_INSTALL_DIR/skills/$f"
  done
  echo "[install] Fetching agents from $KNOWTATION_RAW_DEPLOY_BASE/agents/"
  AGENT_FILES=(
    knowtation/project.yaml bornfree/project.yaml storefree/project.yaml controller/controller.yaml
    _universal-preamble.yaml
    _templates/script-writer.yaml _templates/blog-seo.yaml _templates/newsletter.yaml
    _templates/social-poster.yaml _templates/clip-factory.yaml _templates/thumbnail-brief.yaml
  )
  for f in "${AGENT_FILES[@]}"; do
    mkdir -p "$PAPERCLIP_INSTALL_DIR/agents/$(dirname "$f")"
    curl -fsSL "$KNOWTATION_RAW_DEPLOY_BASE/agents/$f" -o "$PAPERCLIP_INSTALL_DIR/agents/$f"
  done
fi

chown -R "$PAPERCLIP_USER:$PAPERCLIP_USER" "$PAPERCLIP_INSTALL_DIR"

#####################
# 6. Install + migrate Paperclip
#####################

echo "[install] Running pnpm install (includes devDeps needed for build)"
sudo -u "$PAPERCLIP_USER" -H bash -c "cd $PAPERCLIP_INSTALL_DIR && pnpm install --frozen-lockfile"

echo "[install] Building workspace packages (compiling TypeScript → JavaScript)"
sudo -u "$PAPERCLIP_USER" -H bash -c "cd $PAPERCLIP_INSTALL_DIR && NODE_OPTIONS='--max-old-space-size=2048' pnpm -r build"

echo "[install] Patching package.json wildcard exports to use compiled dist/ paths"
python3 -c "
import json, glob
pkgs = glob.glob('$PAPERCLIP_INSTALL_DIR/packages/*/package.json')
for path in pkgs:
    with open(path) as f:
        pkg = json.load(f)
    exports = pkg.get('exports', {})
    changed = False
    for key in list(exports.keys()):
        val = exports[key]
        if isinstance(val, str) and val.startswith('./src/') and val.endswith('.ts'):
            exports[key] = val.replace('./src/', './dist/').replace('.ts', '.js')
            changed = True
    if changed:
        with open(path, 'w') as f:
            json.dump(pkg, f, indent=2)
        print('[install] Patched exports:', path)
print('[install] Export patch complete')
"

echo "[install] Running database migrations (if Paperclip ships them)"
if [[ -f "$PAPERCLIP_INSTALL_DIR/package.json" ]] && grep -q '"migrate"' "$PAPERCLIP_INSTALL_DIR/package.json"; then
  sudo -u "$PAPERCLIP_USER" -H bash -c "cd $PAPERCLIP_INSTALL_DIR && DATABASE_URL=postgresql://$PAPERCLIP_USER@localhost/$PAPERCLIP_DB pnpm migrate"
else
  echo "[install] No 'migrate' script in package.json — skipping. Paperclip may auto-migrate on first run."
fi

#####################
# 7. nginx + certbot
#####################

if ! command -v nginx &>/dev/null; then
  echo "[install] Installing nginx + certbot"
  apt-get install -y nginx certbot python3-certbot-nginx
fi

# Default nginx site: reverse-proxy to Paperclip on $PAPERCLIP_PORT, HTTP only.
# HTTPS is opt-in via 'sudo certbot --nginx -d <your-domain>' AFTER you point DNS.
cat > /etc/nginx/sites-available/paperclip <<EOF
server {
    listen 80;
    server_name _;

    # Tailscale internal access. Allow from 100.64.0.0/10 (Tailscale CGNAT range) + localhost only.
    allow 100.64.0.0/10;
    allow 127.0.0.1;
    deny all;

    location / {
        proxy_pass http://127.0.0.1:$PAPERCLIP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sf /etc/nginx/sites-available/paperclip /etc/nginx/sites-enabled/paperclip
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

#####################
# 8. SSM secrets sync
#####################

# Pull ALL parameters under $SSM_NAMESPACE into /etc/paperclip/env.
# Re-runs every 60 seconds via paperclip-secrets-sync.timer so JWT rotation is hot.

mkdir -p /etc/paperclip
chown root:"$PAPERCLIP_USER" /etc/paperclip
chmod 750 /etc/paperclip

cat > /usr/local/bin/paperclip-secrets-sync <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SSM_NAMESPACE="${SSM_NAMESPACE:-/knowtation/paperclip/}"
ENV_FILE=/etc/paperclip/env
TMP_FILE=$(mktemp)

REGION=$(curl -fsSL -H "X-aws-ec2-metadata-token: $(curl -fsSL -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" 'http://169.254.169.254/latest/meta-data/placement/region')

aws ssm get-parameters-by-path \
  --path "$SSM_NAMESPACE" \
  --recursive \
  --with-decryption \
  --region "$REGION" \
  --output json | jq -r '.Parameters[] | "\(.Name | split("/") | last)=\(.Value)"' > "$TMP_FILE"

# Atomic replace.
chmod 640 "$TMP_FILE"
chown root:paperclip "$TMP_FILE"
mv "$TMP_FILE" "$ENV_FILE"

# If anything changed, restart Paperclip. Compare via checksum.
CHECKSUM_FILE=/var/lib/paperclip-secrets.checksum
NEW_SUM=$(sha256sum "$ENV_FILE" | cut -d' ' -f1)
OLD_SUM=$(cat "$CHECKSUM_FILE" 2>/dev/null || echo "")

if [[ "$NEW_SUM" != "$OLD_SUM" ]]; then
  echo "$NEW_SUM" > "$CHECKSUM_FILE"
  systemctl is-active --quiet paperclip.service && systemctl reload-or-restart paperclip.service || true
fi
EOF
chmod +x /usr/local/bin/paperclip-secrets-sync

cat > /etc/systemd/system/paperclip-secrets-sync.service <<EOF
[Unit]
Description=Pull Paperclip secrets from AWS SSM Parameter Store into /etc/paperclip/env
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=SSM_NAMESPACE=$SSM_NAMESPACE
ExecStart=/usr/local/bin/paperclip-secrets-sync
EOF

cat > /etc/systemd/system/paperclip-secrets-sync.timer <<EOF
[Unit]
Description=Sync Paperclip secrets every 60 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=paperclip-secrets-sync.service

[Install]
WantedBy=timers.target
EOF

#####################
# 9. systemd unit
#####################

cat > /etc/systemd/system/paperclip.service <<EOF
[Unit]
Description=Paperclip orchestrator (Knowtation video factory)
After=network.target postgresql.service paperclip-secrets-sync.service
Wants=postgresql.service paperclip-secrets-sync.service

[Service]
Type=simple
User=$PAPERCLIP_USER
Group=$PAPERCLIP_USER
WorkingDirectory=$PAPERCLIP_INSTALL_DIR
EnvironmentFile=/etc/paperclip/env
Environment=NODE_ENV=production
Environment=PORT=$PAPERCLIP_PORT
Environment=DATABASE_URL=postgresql://$PAPERCLIP_USER@localhost/$PAPERCLIP_DB
Environment=NODE_OPTIONS=--max-old-space-size=8192
ExecStart=/usr/bin/node dist/index.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$PAPERCLIP_INSTALL_DIR /var/lib/paperclip /tmp
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /var/lib/paperclip
chown -R "$PAPERCLIP_USER:$PAPERCLIP_USER" /var/lib/paperclip

systemctl daemon-reload
systemctl enable --now paperclip-secrets-sync.timer
systemctl start paperclip-secrets-sync.service

# Wait for the first secrets sync.
echo "[install] Waiting up to 60 seconds for first SSM secrets sync..."
for i in $(seq 1 60); do
  [[ -s /etc/paperclip/env ]] && break
  sleep 1
done

if [[ ! -s /etc/paperclip/env ]]; then
  echo "[install] WARNING: /etc/paperclip/env is empty after 60 seconds."
  echo "[install] This is expected on first boot — push secrets via:"
  echo "    sudo -u $PAPERCLIP_USER /opt/paperclip/scripts/push-secrets.sh"
  echo "[install] Skipping paperclip.service start until secrets are present."
else
  systemctl enable --now paperclip.service
  echo "[install] paperclip.service started"
fi

echo "[install] DONE. Next:"
echo "  1. sudo -u $PAPERCLIP_USER /opt/paperclip/scripts/push-secrets.sh   # interactive"
echo "  2. sudo -u $PAPERCLIP_USER /opt/paperclip/scripts/hello-world-test.sh"
echo "  3. sudo -u $PAPERCLIP_USER /opt/paperclip/scripts/wire-knowtation-mcp.sh"
echo "  4. sudo -u $PAPERCLIP_USER /opt/paperclip/scripts/load-skills-and-agents.sh"
echo "Logs: journalctl -u paperclip.service -f"
echo "Dashboard: http://paperclip-prod (Tailscale-only by default)"
