# AWS Web Application Infrastructure

A web application deployed on AWS with Terraform and a GitHub Actions pipeline.

Traffic flow:

```
Internet -> ALB (HTTPS) -> Auto Scaling EC2 instances -> RDS MySQL (private)
ALB -> S3 (access logs)
```

## What it provisions

- VPC with public, private-app and private-db subnets across two Availability Zones
- Internet Gateway and a NAT Gateway
- Application Load Balancer with HTTP to HTTPS redirect and an ACM certificate
- EC2 Auto Scaling Group with a launch template (Amazon Linux 2023)
- RDS MySQL in the private subnets, Multi-AZ, encrypted at rest
- Secrets Manager for the database credentials
- S3 buckets for application storage and ALB access logs
- IAM roles and security groups scoped to least privilege

## Repository layout

```
app/                  Node.js application
terraform/            Infrastructure as code
.github/workflows/    Terraform CI/CD pipeline
docs/                 Architecture and deployment notes
diagram/              Architecture diagram
```

## Prerequisites

- An AWS account and credentials
- A Route 53 public hosted zone for your domain (used for the ACM certificate and the app record)
- An S3 bucket and DynamoDB table for Terraform remote state
- Terraform >= 1.6

## Deploy

```
cd terraform
cp terraform.tfvars.example terraform.tfvars   # edit the values

terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="key=webapp/terraform.tfstate" \
  -backend-config="region=ap-south-1" \
  -backend-config="dynamodb_table=<lock-table>"

terraform plan
terraform apply
```

The application URL is printed as the `application_url` output once the apply finishes.

See [docs/deployment.md](docs/deployment.md) for the full walkthrough.

Hinglish me poora explanation (har file ka what/how/why, review aur interview Q&A): [docs/EXPLAINED-HINGLISH.md](docs/EXPLAINED-HINGLISH.md)
