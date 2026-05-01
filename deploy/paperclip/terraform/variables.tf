variable "aws_region" {
  description = "AWS region for the Paperclip orchestrator. us-west-2 (Oregon) for west-coast users, us-east-1 (Virginia) for east-coast."
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment tag (prod, staging). Single-environment plan currently."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be 'prod' or 'staging'."
  }
}

variable "instance_type" {
  description = "EC2 instance type. t3.medium is sufficient for Paperclip + 22 agents at 30 videos/week. Upgrade to t3.large if OOMs occur (one-line change, 90s downtime)."
  type        = string
  default     = "t3.medium"
}

variable "ebs_size_gb" {
  description = "Root EBS volume size. 30 GB covers Paperclip + Postgres + ~6 months of agent logs + Node modules + buffer."
  type        = number
  default     = 30

  validation {
    condition     = var.ebs_size_gb >= 20 && var.ebs_size_gb <= 200
    error_message = "ebs_size_gb must be between 20 and 200."
  }
}

variable "home_ip_cidr" {
  description = "Your home/office public IP in CIDR notation (e.g. 73.214.182.55/32). SSH on port 22 is locked to this IP. Find with: curl ifconfig.me. Tailscale is the preferred access method; SSH port is fallback only."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.home_ip_cidr))
    error_message = "home_ip_cidr must be a valid CIDR (e.g. 73.214.182.55/32)."
  }
}

variable "ssh_public_key" {
  description = "Your SSH public key content (cat ~/.ssh/id_ed25519.pub). Used as fallback access if Tailscale is unreachable."
  type        = string

  validation {
    condition     = startswith(var.ssh_public_key, "ssh-")
    error_message = "ssh_public_key must start with ssh-rsa, ssh-ed25519, etc."
  }
}

variable "tailscale_auth_key" {
  description = "Tailscale ephemeral auth key (https://login.tailscale.com/admin/settings/keys). Used by user-data to auto-join the Tailnet on first boot. Mark the key as Reusable=false, Ephemeral=false, Tags=tag:paperclip-prod."
  type        = string
  sensitive   = true
}

variable "knowtation_hub_url" {
  description = "Hosted Knowtation Hub URL (https://hub.knowtation.dev or your custom domain). Pre-seeded into SSM at /knowtation/paperclip/KNOWTATION_HUB_URL. Override later via push-secrets.sh."
  type        = string
  default     = ""
}

variable "knowtation_vault_id" {
  description = "Knowtation vault ID (e.g. 'default'). Pre-seeded into SSM. Override later via push-secrets.sh."
  type        = string
  default     = "default"
}
