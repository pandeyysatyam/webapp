# Deployment

## 1. Prerequisites

- AWS account with permissions to create VPC, EC2, RDS, ALB, S3, IAM and Secrets Manager resources.
- A Route 53 public hosted zone, for example `example.com`. The app will be served at a subdomain such as `app.example.com`.
- A remote state backend: an S3 bucket and a DynamoDB table (with a `LockID` partition key).

Create the state backend once:

```
aws s3 mb s3://<state-bucket> --region ap-south-1
aws dynamodb create-table \
  --table-name <lock-table> \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

## 2. Configure variables

```
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Set `domain_name`, `hosted_zone_name` and `app_repo_url` to your values.

## 3. Deploy

```
terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="key=webapp/terraform.tfstate" \
  -backend-config="region=ap-south-1" \
  -backend-config="dynamodb_table=<lock-table>"

terraform plan
terraform apply
```

The ACM certificate validates through DNS in the hosted zone, so the apply waits until validation completes. This usually takes a few minutes.

## 4. Verify

```
terraform output application_url
curl -I https://app.example.com
```

Open the URL in a browser. The page shows the serving instance and the database connection status.

## 5. CI/CD

The pipeline in `.github/workflows/terraform.yml` runs `fmt`, `validate` and `plan` on pull requests, and `apply` on merges to `main`. It authenticates to AWS with GitHub OIDC (no static keys).

Set these in the repository:

- Secrets: `AWS_ROLE_ARN`, `TF_STATE_BUCKET`, `TF_STATE_LOCK_TABLE`
- Variables: `DOMAIN_NAME`, `HOSTED_ZONE_NAME`, `APP_REPO_URL`

The IAM role in `AWS_ROLE_ARN` must trust the GitHub OIDC provider and allow the actions used by the Terraform resources.

## 6. Teardown

```
terraform destroy
```
