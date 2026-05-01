#!/bin/bash
######################################################################
# Paperclip first-boot user-data
#
# Runs ONCE on first boot of the EC2 instance.
# - Sets hostname
# - Installs Tailscale and joins the Tailnet using the supplied auth key
# - Installs git + curl + AWS CLI prerequisites
# - Clones the knowtation repo into /opt/paperclip-repo (deploy artifacts only — no vault data)
# - Hands control to install.sh which the operator runs manually after SSH-ing in
#
# DOES NOT install Paperclip itself — that's install.sh, run by the operator after SSH.
# Reason: install.sh prompts for confirmation on a few steps; user-data has no TTY.
######################################################################

set -euo pipefail

exec > >(tee -a /var/log/paperclip-user-data.log) 2>&1
echo "[$(date -u +%FT%TZ)] user-data starting on $(hostname)"

############
# Hostname
############
hostnamectl set-hostname "${hostname}"
echo "127.0.1.1 ${hostname}" >> /etc/hosts

#####################
# OS package updates
#####################
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  jq \
  unzip \
  ufw

############
# AWS CLI
############
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install || /tmp/aws/install --update
rm -rf /tmp/awscliv2.zip /tmp/aws

############
# Tailscale
############
curl -fsSL https://tailscale.com/install.sh | sh

# Join the Tailnet. Tags from the auth key apply automatically.
# --ssh enables Tailscale SSH on this node (alongside the EC2 SG rule).
# --hostname pins the node name so 'ssh ubuntu@paperclip-prod' works immediately.
tailscale up \
  --auth-key="${tailscale_auth_key}" \
  --hostname="${hostname}" \
  --ssh \
  --accept-routes

############
# Optional UFW (Tailscale handles most of this; double-belt approach)
############
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 41641/udp comment 'Tailscale'
ufw allow 80/tcp comment 'Lets Encrypt HTTP-01'
ufw --force enable || true

#######################
# Clone deploy artifacts
#######################
mkdir -p /opt
chown -R ubuntu:ubuntu /opt

# install.sh and friends are pulled by the operator after SSH-ing in.
# The repo URL is configured by the operator in install.sh.

echo "[$(date -u +%FT%TZ)] user-data finished. SSH in via 'ssh ubuntu@${hostname}' and run install.sh next."
