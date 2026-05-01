output "paperclip_instance_id" {
  description = "EC2 instance ID — use this in AWS Console for stop/start/reboot"
  value       = aws_instance.paperclip.id
}

output "paperclip_public_ip" {
  description = "Public IP of the Paperclip orchestrator. Use Tailscale (paperclip-prod hostname) for routine access; use this only if Tailscale is down."
  value       = aws_instance.paperclip.public_ip
}

output "paperclip_public_dns" {
  description = "Public DNS of the Paperclip orchestrator"
  value       = aws_instance.paperclip.public_dns
}

output "paperclip_private_ip" {
  description = "Private VPC IP — used for internal AWS-to-AWS traffic if you ever add more services"
  value       = aws_instance.paperclip.private_ip
}

output "ssh_command" {
  description = "Fallback SSH (use only if Tailscale is broken). Routine access: ssh ubuntu@paperclip-prod via Tailscale."
  value       = "ssh ubuntu@${aws_instance.paperclip.public_ip}"
}

output "tailscale_admin_url" {
  description = "Open this in your browser AFTER terraform apply to confirm the box joined Tailscale. Rename the node to 'paperclip-prod'."
  value       = "https://login.tailscale.com/admin/machines"
}

output "ssm_namespace" {
  description = "AWS SSM Parameter Store namespace for secrets. Run scripts/push-secrets.sh to populate."
  value       = "/knowtation/paperclip/"
}

output "next_steps" {
  description = "What to do after terraform apply succeeds"
  value       = <<-EOT

    Next steps:
      1. Wait ~3 minutes for the instance to boot, run user-data, and join Tailscale.
      2. Open https://login.tailscale.com/admin/machines and rename the new node to 'paperclip-prod'.
      3. From your Mac (which must also be on Tailscale): tailscale ping paperclip-prod
      4. SSH in: ssh ubuntu@paperclip-prod
      5. Run install: sudo bash /opt/paperclip/install.sh
      6. Push secrets: sudo -u paperclip /opt/paperclip/scripts/push-secrets.sh
      7. Smoke test: sudo -u paperclip /opt/paperclip/scripts/hello-world-test.sh

    See docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md Step 8 for full details.

  EOT
}
