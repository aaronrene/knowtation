######################################################################
# Paperclip orchestrator — AWS infrastructure
#
# Provisions ONE EC2 t3.medium with:
#   - Ubuntu 24.04 LTS (latest Canonical AMI for the chosen region)
#   - 30 GB gp3 EBS root volume (encrypted)
#   - IAM role with read-only access to /knowtation/paperclip/* in SSM
#   - Security group: SSH from your home IP, Tailscale UDP, HTTP/HTTPS
#   - User-data script that joins Tailscale on first boot and runs install.sh
#
# After 'terraform apply':
#   - SSH via Tailscale: ssh ubuntu@paperclip-prod
#   - SSM secrets pre-seeded with empty placeholders for hub URL + vault ID
#   - Real secrets pushed later via deploy/paperclip/scripts/push-secrets.sh
######################################################################

# Latest Ubuntu 24.04 LTS AMI for the chosen region.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Default VPC + first default subnet — keeps blast radius narrow for a single-instance deploy.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Random suffix so multiple deploys (prod + staging) don't collide on names.
resource "random_id" "suffix" {
  byte_length = 4
}

#################
# SSH key pair
#################

resource "aws_key_pair" "operator" {
  key_name   = "knowtation-paperclip-${var.environment}-${random_id.suffix.hex}"
  public_key = var.ssh_public_key
}

#################
# Security group
#################

resource "aws_security_group" "paperclip" {
  name        = "knowtation-paperclip-${var.environment}-${random_id.suffix.hex}"
  description = "Paperclip orchestrator: SSH from home IP only, Tailscale, HTTP/HTTPS for Let's Encrypt"
  vpc_id      = data.aws_vpc.default.id

  # SSH (TCP 22) — your home IP only. Primary access is Tailscale; this is fallback.
  ingress {
    description = "SSH from operator home IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.home_ip_cidr]
  }

  # Tailscale (UDP 41641) — outbound NAT-traversal; ingress is for direct connections.
  ingress {
    description = "Tailscale direct connection"
    from_port   = 41641
    to_port     = 41641
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP — Let's Encrypt HTTP-01 challenge ONLY. Paperclip dashboard is Tailscale-only.
  ingress {
    description = "Let's Encrypt HTTP-01 challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS — only if you intentionally expose the Paperclip dashboard publicly. Closed by default.
  # Uncomment to expose. Recommended: keep closed, use Tailscale Funnel for sharing.
  # ingress {
  #   description = "HTTPS public dashboard (off by default)"
  #   from_port   = 443
  #   to_port     = 443
  #   protocol    = "tcp"
  #   cidr_blocks = ["0.0.0.0/0"]
  # }

  egress {
    description = "All outbound (Paperclip calls DeepInfra, HeyGen, ElevenLabs, Descript, Knowtation Hub)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

##################################
# IAM role + SSM Parameter access
##################################

resource "aws_iam_role" "paperclip" {
  name = "knowtation-paperclip-${var.environment}-${random_id.suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ssm_read" {
  name = "ssm-read-paperclip-secrets"
  role = aws_iam_role.paperclip.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/knowtation/paperclip/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_managed_core" {
  role       = aws_iam_role.paperclip.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "paperclip" {
  name = "knowtation-paperclip-${var.environment}-${random_id.suffix.hex}"
  role = aws_iam_role.paperclip.name
}

##############################################
# SSM placeholders for non-secret config items
##############################################

# Empty placeholders — push-secrets.sh fills the real ones interactively.
# These exist so the install script's first boot doesn't fail on missing keys.

resource "aws_ssm_parameter" "hub_url" {
  count       = var.knowtation_hub_url == "" ? 0 : 1
  name        = "/knowtation/paperclip/KNOWTATION_HUB_URL"
  description = "Knowtation hosted Hub URL"
  type        = "String"
  value       = var.knowtation_hub_url
  tier        = "Standard"
}

resource "aws_ssm_parameter" "vault_id" {
  name        = "/knowtation/paperclip/KNOWTATION_VAULT_ID"
  description = "Knowtation vault ID for the Hub MCP"
  type        = "String"
  value       = var.knowtation_vault_id
  tier        = "Standard"
}

#################
# EC2 instance
#################

resource "aws_instance" "paperclip" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  subnet_id     = data.aws_subnets.default.ids[0]

  vpc_security_group_ids = [aws_security_group.paperclip.id]
  key_name               = aws_key_pair.operator.key_name
  iam_instance_profile   = aws_iam_instance_profile.paperclip.name

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ebs_size_gb
    encrypted             = true
    delete_on_termination = true
    tags = {
      Name = "knowtation-paperclip-${var.environment}-root"
    }
  }

  user_data = templatefile("${path.module}/user-data.sh.tpl", {
    tailscale_auth_key = var.tailscale_auth_key
    hostname           = "paperclip-${var.environment}"
  })

  user_data_replace_on_change = false

  tags = {
    Name = "knowtation-paperclip-${var.environment}"
  }

  lifecycle {
    ignore_changes = [
      ami,                  # don't replace box just because Canonical published a new minor AMI
      user_data,            # user_data only matters first boot
      root_block_device[0].tags,
    ]
  }
}
