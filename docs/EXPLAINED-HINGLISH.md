# Webapp Project: Poora Explanation (Hinglish)

Is file me project ki har file ka **What (kya hai), How (kaise kaam karta hai), Why (kyu aisa kiya)** diya hai. Last me **Review (kya improve ho sakta hai)** aur **Interview Questions (basic se advanced)** hai.

---

## 1. Project ek line me

Ek Node.js web app ko AWS pe **Terraform** se deploy kiya hai, production jaisa setup: **HTTPS Load Balancer + Auto Scaling EC2 (private subnet) + RDS MySQL (private, Multi-AZ) + Secrets Manager + S3 + GitHub Actions CI/CD (OIDC)**.

## 2. Traffic flow (request kaise chalti hai)

```
User browser
   |  https://app.example.com
   v
Route 53 (DNS)  ---> alias record ALB ko point karta hai
   v
ALB (public subnet)  port 80 -> 443 redirect, ACM certificate se HTTPS
   v
Target Group (port 3000, /health check)
   v
EC2 instances (private-app subnet, Auto Scaling Group, 2 AZ)
   |  startup pe Secrets Manager se DB password leta hai (IAM role se)
   v
RDS MySQL (private-db subnet, Multi-AZ, encrypted)

ALB access logs ---> S3 logs bucket
EC2 internet (dnf, git clone, AWS APIs) ---> NAT Gateway ---> Internet Gateway
```

Interview me yahi flow bolna hai: **"Internet se sirf ALB tak aate hai, ALB se app tak, app se DB tak. Har layer ka Security Group sirf apne pichle layer ko allow karta hai."**

## 3. Folder structure

```
app/                  Node.js app (server.js, package.json)
terraform/            Saara AWS infra code
.github/workflows/    CI/CD pipeline (terraform fmt/validate/plan/apply)
docs/                 architecture.md, deployment.md, ye file
diagram/              Architecture diagram (svg + png)
screenshots/          Deploy ke baad screenshots yaha daalne hai
```

Terraform files **service wise** alag kiye hai (network.tf, alb.tf, rds.tf...). **Why:** Terraform folder ki saari `.tf` files ko ek hi config maanta hai, file names sirf humare padhne ke liye hai. Alag karne se code padhna aur review karna easy hota hai.

---

## 4. Har file ka explanation

### 4.1 `terraform/versions.tf`

**What:** Terraform aur providers ka version fix karta hai.
- `required_version = ">= 1.6"` : Terraform CLI kam se kam 1.6 chahiye.
- `aws ~> 5.60` : AWS provider 5.60 ya usse upar, but 6.0 nahi (`~>` = pessimistic constraint, sirf rightmost number badh sakta hai).
- `random ~> 3.6` : password generate karne ke liye.

**Why:** Bina version pin kiye kal naya major version aaya to code toot sakta hai. Team me sabke paas same version chale.

### 4.2 `terraform/backend.tf`

```hcl
terraform { backend "s3" {} }
```

**What:** State file S3 me rakhni hai, but bucket ka naam yaha nahi likha (khaali block). Ise **partial backend configuration** bolte hai.

**How:** `terraform init -backend-config="bucket=..." -backend-config="dynamodb_table=..."` se values bahar se di jaati hai.

**Why:**
- Backend block me variables use nahi ho sakte (`var.x` allowed nahi), isliye `-backend-config` se dete hai.
- Same code alag environment (dev/prod) me alag bucket/key se chal sakta hai.
- **S3** = state ek shared jagah pe, **DynamoDB** = state locking (do log ek saath `apply` na kar sake, state corrupt na ho).

### 4.3 `terraform/providers.tf`

**What:** AWS provider, region `var.region` (default `ap-south-1` Mumbai).

`default_tags` : har resource pe automatically `Project=webapp` aur `ManagedBy=terraform` tag lag jaata hai.

**Why:** Billing me cost project wise dikhegi, aur pata chalega kaunsa resource Terraform ne banaya (manual change mat karo).

### 4.4 `terraform/variables.tf`

**What:** Saare inputs. Important ones:

| Variable | Default | Matlab |
|---|---|---|
| project | webapp | Har resource ke naam ka prefix |
| region | ap-south-1 | Mumbai region |
| vpc_cidr | 10.0.0.0/16 | VPC ka IP range (65,536 IPs) |
| az_count | 2 | Kitne Availability Zones |
| instance_type | t3.micro | EC2 size |
| app_port | 3000 | Node app ka port |
| asg_min/desired/max | 2 / 2 / 4 | Auto Scaling limits |
| db_multi_az | true | DB ka standby dusre AZ me |
| domain_name, hosted_zone_name, app_repo_url | koi default nahi | **Required**, user ko dena hi padega |

**Why no default for domain:** Ye har user ke liye alag hai, galat default se galat domain pe certificate ban sakta hai. Isliye required rakha.

### 4.5 `terraform/terraform.tfvars.example`

**What:** Example values. `cp terraform.tfvars.example terraform.tfvars` karke apni values bharo.

**Why example file:** Asli `terraform.tfvars` `.gitignore` me hai (usme personal/secret values ho sakti hai). Example file sirf format batati hai.

### 4.6 `terraform/network.tf` (sabse important)

**What:** VPC, 3 tier subnets, Internet Gateway, NAT Gateway, route tables.

**How (step by step):**

1. `data "aws_availability_zones"` : region ke available AZs laata hai (jaise ap-south-1a, 1b).
2. `locals` me `slice(..., 0, var.az_count)` : pehle 2 AZ le liye.
3. `cidrsubnet(var.vpc_cidr, 8, i)` : /16 me 8 bits add karke /24 subnets banata hai:
   - Public: `10.0.0.0/24`, `10.0.1.0/24` (i = 0,1)
   - Private app: `10.0.10.0/24`, `10.0.11.0/24` (i + 10)
   - Private db: `10.0.20.0/24`, `10.0.21.0/24` (i + 20)
   - **Why +10, +20 gap:** Number dekh ke pata chal jaata hai kaunsa tier hai, aur aage AZ badhane ke liye jagah bachi rehti hai.
4. `aws_vpc` : `enable_dns_hostnames = true` zaroori hai, warna RDS endpoint jaise DNS names resolve nahi honge.
5. `aws_internet_gateway` : VPC ka internet ka darwaza.
6. Subnets `count = var.az_count` se banaye (ek loop jaisa). Public subnet me `map_public_ip_on_launch = true`.
7. `aws_eip` + `aws_nat_gateway` : NAT public subnet[0] me. `depends_on = [igw]` kyunki NAT ko kaam karne ke liye pehle IGW chahiye.
8. Route tables:
   - **public** : `0.0.0.0/0 -> IGW` (seedha internet)
   - **private_app** : `0.0.0.0/0 -> NAT` (sirf bahar ja sakte hai, bahar se andar nahi aa sakte)
   - **private_db** : koi route nahi (internet se poora cut, sirf VPC ke andar ka local route)
9. `aws_route_table_association` : har subnet ko uska route table attach.

**Why 3 tier:** Defense in depth. Agar app hack bhi ho jaye, DB internet pe expose nahi hai. **Public vs private subnet ka farak sirf route table hai** (IGW route hai to public).

**Why NAT:** Private EC2 ko `dnf update`, `git clone`, `npm install` aur Secrets Manager API ke liye bahar jaana hai, but bahar se koi andar connect nahi kar sake.

### 4.7 `terraform/security_groups.tf`

**What:** 3 Security Groups, chain banake:

| SG | Inbound kisse allow | Port |
|---|---|---|
| alb-sg | `0.0.0.0/0` (poora internet) | 80, 443 |
| app-sg | sirf **alb-sg** | 3000 |
| db-sg | sirf **app-sg** | 3306 |

**How:** `security_groups = [aws_security_group.alb.id]` : CIDR ki jagah SG ID reference. Matlab "jis bhi cheez pe alb-sg laga hai, wahi andar aa sakta hai".

**Why SG reference instead of IP:** ASG me instances aate jaate hai, IP badalte hai. SG reference se rule apne aap sab naye instances pe lagta hai. Ye **least privilege** hai.

**Note:** Security Group **stateful** hai: request andar aayi to uska reply apne aap bahar jaata hai, alag rule nahi chahiye. (NACL stateless hota hai.)

### 4.8 `terraform/alb.tf`

**What:** Application Load Balancer, Target Group, 2 Listeners.

- `aws_lb` : `internal = false` (internet facing), public subnets me, access logs S3 me (`prefix = "alb"`). `depends_on = [aws_s3_bucket_policy.logs]` kyunki bucket policy pehle na ho to ALB create time pe logs bucket ka permission check fail ho jaata hai.
- `aws_lb_target_group` : port 3000, health check `/health`, 200 chahiye. 2 baar pass = healthy, 3 baar fail = unhealthy, har 30 sec.
- `http` listener (80) : **301 redirect to HTTPS 443**.
- `https` listener (443) : TLS 1.3 policy, certificate `aws_acm_certificate_validation.this.certificate_arn` se, traffic target group ko forward.

**Why certificate validation ka ARN use kiya (direct certificate ka nahi):** Isse Terraform tab tak wait karta hai jab tak certificate **validate** na ho jaye. Unvalidated cert listener pe lagao to error aata hai. Ye ek smart dependency trick hai.

**Why ALB (NLB nahi):** HTTP level (Layer 7) features chahiye: redirect, path based routing, HTTPS termination, health check on path.

### 4.9 `terraform/dns.tf`

**What:** Route 53 zone lookup, ACM certificate, DNS validation records, app ka A record.

**How:**
1. `data "aws_route53_zone"` : pehle se bani hui hosted zone dhundhta hai (data source = sirf padhna, banana nahi).
2. `aws_acm_certificate` : `validation_method = "DNS"`. `create_before_destroy = true` : cert badalna pade to pehle naya bane, phir purana hate (warna listener ke paas thodi der cert nahi hoga = downtime).
3. `aws_route53_record.cert_validation` : `for_each` loop `domain_validation_options` pe. ACM batata hai "ye CNAME record daalo", Terraform daal deta hai. `allow_overwrite = true` taaki pehle se record ho to error na aaye.
4. `aws_acm_certificate_validation` : wait karta hai jab tak cert ISSUED na ho.
5. `aws_route53_record.app` : **Alias A record** ALB ke DNS pe.

**Why Alias (CNAME nahi):** Alias free hai (query charge nahi), root domain (example.com) pe bhi chalta hai, aur `evaluate_target_health` support karta hai.

**Why for_each (count nahi):** Key domain name hai, order change ho to resources recreate nahi honge. `count` me index badle to sab shift ho jaata hai.

### 4.10 `terraform/compute.tf`

**What:** AMI lookup, Launch Template, Auto Scaling Group, Scaling policy.

- `data "aws_ssm_parameter" "al2023"` : AWS ka public SSM parameter jo **latest Amazon Linux 2023 AMI ID** deta hai. **Why:** AMI ID hardcode karo to region badalne pe ya purani hone pe problem. Ye hamesha latest deta hai.
- `aws_launch_template` : EC2 ka "blueprint".
  - `iam_instance_profile` : EC2 ko IAM role deta hai (Secrets Manager padhne ke liye).
  - `metadata_options { http_tokens = "required" }` : **IMDSv2 enforce**. **Why:** SSRF attack se metadata (169.254.169.254) se credentials churane ka risk kam hota hai.
  - `user_data = base64encode(templatefile(...))` : boot pe chalne wali script, usme region, secret ARN, DB host, port, repo URL inject karte hai.
  - `name_prefix` : Terraform unique naam banata hai (naam clash nahi hota).
- `aws_autoscaling_group` :
  - Private app subnets me (dono AZ).
  - `target_group_arns` : naye instances apne aap ALB me register.
  - `health_check_type = "ELB"` : ALB health check fail = ASG instance replace karega. (Default EC2 type sirf hardware check karta hai, app crash pakad nahi pata.)
  - `health_check_grace_period = 180` : boot + npm install me time lagta hai, 3 min tak health fail ignore.
  - `version = "$Latest"` : launch template ka latest version.
- `aws_autoscaling_policy` : **Target Tracking**, average CPU 50% rakhne ki koshish. CPU zyada = instance add (max 4), kam = remove (min 2).

### 4.11 `terraform/user_data.sh`

**What:** EC2 boot hote hi root se chalti hai (sirf pehli baar).

**How:**
1. `set -euo pipefail` : koi command fail ho to script ruk jaaye (silent failure nahi).
2. `dnf install nodejs npm git`
3. `git clone ${app_repo_url} /opt/app` : GitHub se code. **Isliye repo public hona chahiye.**
4. `npm install --omit=dev` : sirf production dependencies.
5. `/etc/app.env` : environment variables (region, secret ARN, DB host, port). **Password yaha nahi hai**, sirf secret ka ARN.
6. `systemd` service `app.service` : `Restart=always`, app crash ho to 5 sec me restart. `enable --now` = abhi start + reboot pe bhi start.

**`${region}` jaisa syntax:** Ye bash variable nahi, Terraform `templatefile` ka placeholder hai, Terraform deploy se pehle real value daal deta hai. (Agar bash ka `${VAR}` chahiye to `$${VAR}` likhna padta.)

**Why systemd (nohup/pm2 nahi):** OS ka built-in process manager, auto restart, boot pe start, logs `journalctl -u app` me.

### 4.12 `terraform/iam.tf`

**What:** EC2 ke liye IAM Role.

- `ec2_assume` policy : **Trust policy**, "ec2.amazonaws.com is role ko assume kar sakta hai".
- `app_secrets` : **Permission policy**, sirf `secretsmanager:GetSecretValue` aur sirf **ek secret ke ARN** pe. Ye least privilege hai (`*` nahi diya).
- `AmazonSSMManagedInstanceCore` : **Session Manager** se instance me login (SSH key, port 22, bastion kuch nahi chahiye).
- `aws_iam_instance_profile` : Role ko EC2 se jodne ka wrapper. EC2 directly role nahi leta, instance profile leta hai.

**Why role (access key nahi):** Role ke credentials temporary hote hai aur auto rotate hote hai. Code ya server pe koi permanent key nahi.

### 4.13 `terraform/secrets.tf`

**What:** DB password generate karke Secrets Manager me rakhna.

- `random_password` : 24 char, special chars. `override_special` me sirf wahi symbols jo RDS allow karta hai (RDS `/`, `@`, `"`, space allow nahi karta).
- `aws_secretsmanager_secret` : secret ka "dabba".
- `aws_secretsmanager_secret_version` : andar ki value, JSON (`username, password, dbname, engine, port`).

**Why:** Password kisi file, code ya GitHub me nahi hai. App runtime pe IAM role se padhta hai.

**Dhyan rakho:** Password Terraform **state file** me plain text hota hai. Isliye state S3 me encrypted aur restricted rakhni chahiye.

### 4.14 `terraform/rds.tf`

**What:** MySQL 8.0 database.

- `aws_db_subnet_group` : RDS kaunse subnets me reh sakta hai (private_db, 2 AZ). Multi-AZ ke liye kam se kam 2 AZ ke subnets chahiye.
- `aws_db_instance` key settings:
  - `storage_type = "gp3"`, `storage_encrypted = true` (KMS se at-rest encryption)
  - `password = random_password.db.result` (Secrets Manager wala same)
  - `multi_az = true` : dusre AZ me **synchronous standby**, primary down to automatic failover (~1-2 min), endpoint same rehta hai.
  - `publicly_accessible = false`
  - `backup_retention_period = 7` : 7 din ke automated backups, point in time restore.
  - `deletion_protection = false`, `skip_final_snapshot = true` : **lab/demo ke liye** taaki `destroy` easy ho. Production me ulta rakhna.

**Multi-AZ vs Read Replica:** Multi-AZ = high availability (standby pe read nahi kar sakte). Read Replica = read scaling (asynchronous).

### 4.15 `terraform/s3.tf`

**What:** 2 buckets.

1. **app bucket** : versioning ON, AES256 encryption, public access poora block.
2. **logs bucket** : ALB access logs. `force_destroy = true` (destroy pe andar ke logs ke saath delete).
   - Bucket policy : `data.aws_elb_service_account.main` (us region ka AWS ka ELB account) ko `s3:PutObject` sirf `alb/AWSLogs/<account-id>/*` path pe.

**Why account ID bucket naam me:** S3 bucket naam **globally unique** hote hai, account ID lagane se clash nahi hota.

**Why AES256 (KMS nahi) logs ke liye:** ALB access logs sirf SSE-S3 (AES256) support karte hai.

### 4.16 `terraform/outputs.tf`

**What:** Apply ke baad dikhne wali values: app URL, ALB DNS, RDS endpoint, secret ARN, bucket names.

`sensitive = true` (rds_endpoint) : CLI output me `(sensitive)` dikhega, chhupa rahega. (State me fir bhi hai.)

### 4.17 `app/server.js` + `app/package.json`

**What:** Express app.

**How:**
1. Start pe `getDbCredentials()` : AWS SDK v3 se Secrets Manager call. Credentials SDK apne aap instance role (IMDS) se le leta hai, koi key nahi likhi.
2. `mysql.createPool(...)` : **connection pool** (max 5). **Why:** har request pe naya connection banana slow hai.
3. `GET /health` : sirf "ok" (DB check nahi karta). **Why:** DB thoda slow ho to saare instances unhealthy hoke replace na ho jaye (cascading failure se bachav).
4. `GET /` : `SELECT NOW()` chalake page pe **hostname** (kaunsa instance) + DB status dikhata hai. Refresh karne pe hostname badle = load balancing kaam kar raha hai.
5. `main().catch(... process.exit(1))` : startup fail ho to process exit, systemd restart karega.

**package.json:** `express`, `mysql2`, `@aws-sdk/client-secrets-manager`. `"private": true` = galti se npm pe publish na ho.

### 4.18 `.github/workflows/terraform.yml`

**What:** CI/CD pipeline.

**Trigger:** `main` pe push ya PR, **sirf** jab `terraform/**` ya workflow file badle (`paths` filter). README badalne pe pipeline nahi chalegi.

**Steps:**
1. `checkout` : code laao.
2. `configure-aws-credentials` with `role-to-assume` : **OIDC**. GitHub ek short lived token deta hai, AWS us token ke badle temporary credentials deta hai. Isliye `permissions: id-token: write` zaroori hai.
3. `setup-terraform` 1.9.5
4. `init` (backend values GitHub secrets se)
5. `fmt -check` : formatting galat = fail
6. `validate` : syntax/reference check
7. `plan -out=tfplan` : plan file save
8. `apply tfplan` : **sirf** `main` pe push hone pe. PR pe sirf plan.

`TF_VAR_domain_name` : env var `TF_VAR_<name>` se Terraform variable set hota hai.

**Why OIDC:** GitHub me koi `AWS_ACCESS_KEY_ID` store nahi. Key leak ka risk zero, rotate karne ka jhanjhat nahi.

**Why saved plan apply:** Jo plan review hua, exactly wahi apply ho.

### 4.19 `.gitignore`

`.terraform/`, `*.tfstate` (state me password hai!), `*.tfvars` (but `!*.tfvars.example` allowed), `node_modules/`.

### 4.20 `docs/`, `diagram/`, `screenshots/`

Architecture aur deployment ka English doc, diagram, aur screenshots ki checklist.

---

## 5. Review: Maine kya check kiya aur kya improve ho sakta hai

**Check kiya (sab pass):**
- `terraform fmt -check` : pass
- `terraform validate` : pass (`Success! The configuration is valid.`)
- `node --check app/server.js` : pass
- `bash -n user_data.sh` : pass

Code sahi hai aur design production jaisa hai. Neeche wo points hai jo **interview me "isme kya improve karoge?"** pe bol sakte ho. (Code me change nahi kiya, taaki original project jaisa hai waisa rahe.)

| # | Point | Problem | Fix |
|---|---|---|---|
| 1 | Single NAT Gateway | NAT sirf AZ-1 me hai. AZ-1 down = AZ-2 ke instances bhi internet (Secrets Manager) tak nahi pahunchenge | Har AZ me ek NAT + har AZ ka alag private route table. (Cost vs HA ka trade off, lab me 1 NAT sasta) |
| 2 | Secrets Manager recovery window | `destroy` ke baad secret 30 din "scheduled for deletion" rehta hai, dobara `apply` karo to **same naam ka error** aata hai | Lab ke liye `recovery_window_in_days = 0` |
| 3 | `$Latest` without instance refresh | Launch template badla (naya user_data) to purane instances update nahi honge | ASG me `instance_refresh { strategy = "Rolling" }` block |
| 4 | Password state me | `random_password` state file me plain text | RDS ka `manage_master_user_password = true` (AWS khud Secrets Manager me rakhta aur rotate karta hai), aur backend me `encrypt=true` |
| 5 | `.terraform.lock.hcl` gitignored | HashiCorp recommend karta hai lock file commit karo, taaki sab jagah exact same provider version chale | `.gitignore` se hata ke commit |
| 6 | App bucket use nahi ho raha | S3 app bucket bana hai but EC2 role ko S3 permission nahi, app use nahi karta | Ya to hatao, ya role me us bucket ka `s3:GetObject/PutObject` do |
| 7 | CI me apply pe approval nahi | main pe merge hote hi seedha apply | GitHub `environment: production` with required reviewers |
| 8 | DynamoDB locking | Terraform 1.10+ me S3 native locking (`use_lockfile = true`) aa gaya, DynamoDB deprecated ho raha hai | Naye setup me `use_lockfile` |
| 9 | Deploy = git clone on boot | Har boot pe GitHub + npm pe depend, slow aur GitHub down = scale out fail | Packer se AMI bake karo ya Docker image (ECR) use karo |
| 10 | Monitoring nahi | Koi CloudWatch alarm/dashboard nahi | ALB 5xx, unhealthy hosts, RDS CPU/storage alarms + SNS |
| 11 | WAF nahi | ALB seedha internet pe | AWS WAF managed rules ALB pe |
| 12 | DB SG egress open | DB ko outbound ki zaroorat nahi | Egress hata do ya restrict |
| 13 | Single environment | dev/prod alag nahi | Workspaces ya alag backend key / folders (`envs/dev`, `envs/prod`) |

---

## 6. Interview Questions (Basic se Advanced)

### Basic

**Q: Terraform kya hai?**
Infrastructure as Code tool (HashiCorp). Code (HCL) likh ke cloud resources banate hai. Declarative hai: "kya chahiye" batate hai, "kaise" Terraform khud sochta hai.

**Q: `init`, `plan`, `apply`, `destroy` kya karte hai?**
`init` = providers download + backend setup. `plan` = kya badlega uska preview. `apply` = asli me banana. `destroy` = sab delete.

**Q: State file kya hai, kyu chahiye?**
Terraform ka record ki real world me kya bana hai (resource IDs). Isse wo code aur reality compare karta hai. Isme secrets bhi hote hai, isliye git me nahi, S3 me encrypted rakhte hai.

**Q: Resource vs Data source?**
`resource` = banata/manage karta hai. `data` = pehle se bani cheez sirf padhta hai (jaise is project me Route 53 zone, AZ list, AMI ID, account ID).

**Q: Variable, local, output me farak?**
`variable` = bahar se input. `locals` = andar ka calculated value (jaise subnet CIDRs). `output` = apply ke baad bahar dikhane wali value.

**Q: Public aur private subnet me kya farak hai?**
Route table. Public ka route IGW pe, private ka NAT pe (ya kahin nahi).

**Q: Security Group vs NACL?**
SG instance level, stateful, sirf allow rules. NACL subnet level, stateless, allow + deny dono.

### Intermediate

**Q: `count` vs `for_each`?**
`count` index (0,1,2) se, beech ka item hata do to baaki shift hoke recreate. `for_each` key se (map/set), stable. Is project me subnets `count` se (AZ fixed hai), cert validation records `for_each` se.

**Q: `depends_on` kab use karte ho?**
Jab dependency code reference se dikh nahi rahi. Yaha ALB ko bucket policy pe aur NAT ko IGW pe depend karaya, kyunki direct reference nahi tha but order zaroori tha.

**Q: Remote backend + locking kyu?**
Team me sab same state use kare, aur ek time pe ek hi apply ho (DynamoDB lock), warna state corrupt.

**Q: ALB health check fail hone pe kya hota hai?**
ALB us target ko traffic bhejna band karta hai. ASG `health_check_type = ELB` hai to wo instance terminate karke naya launch karta hai.

**Q: Private EC2 me login kaise karoge?**
SSM Session Manager (`AmazonSSMManagedInstanceCore` policy lagi hai). SSH key, port 22, bastion kuch nahi.

**Q: EC2 ko DB password kaise milta hai?**
IAM role (instance profile) se Secrets Manager `GetSecretValue`. App startup pe JSON padhta hai. Password code, AMI, env file kahin nahi.

**Q: HTTPS kaise setup hua?**
ACM certificate, DNS validation Route 53 me automatic, ALB 443 listener pe cert, 80 se 443 pe 301 redirect.

**Q: Auto scaling kaise kaam karta hai?**
Target tracking policy, average CPU 50%. Upar gaya to instance add (max 4), neeche to remove (min 2). CloudWatch alarms Terraform nahi banata, AWS khud banata hai.

### Advanced

**Q: Multi-AZ RDS failover me kya hota hai?**
Synchronous standby dusre AZ me. Primary fail = AWS DNS (endpoint) standby pe flip karta hai, 1-2 min. App ka connection pool reconnect karta hai. Data loss nahi (synchronous).

**Q: Ek AZ poora down ho jaye to is setup me kya hoga?**
ALB dusre AZ ke targets ko traffic bhejega, ASG dusre AZ me instances badhayega, RDS failover. **But** agar down AZ wahi hai jisme NAT hai, to naye instances `dnf/git clone` nahi kar paayenge = scale out fail. Fix: har AZ me NAT. (Ye bolna strong impression deta hai.)

**Q: IMDSv2 kyu?**
Session token based, PUT request chahiye. SSRF vulnerability se attacker GET karke role credentials nahi chura sakta (Capital One breach jaisa).

**Q: OIDC GitHub se AWS kaise kaam karta hai?**
AWS me GitHub ka OIDC Identity Provider + ek IAM role jiski trust policy me `token.actions.githubusercontent.com` aur `sub` condition (sirf is repo/branch). Workflow JWT token leta hai, `AssumeRoleWithWebIdentity` se temporary creds. Koi static key nahi.

**Q: Kisi ne console se SG manually badal diya (drift), kya hoga?**
Next `terraform plan` me difference dikhega aur `apply` wapas code wali state pe le aayega. Drift detect karne ke liye scheduled `plan -detailed-exitcode` chala sakte ho.

**Q: Bina downtime ke cert ya launch template kaise badloge?**
Cert: `create_before_destroy`. Instances: ASG instance refresh (rolling, `min_healthy_percentage`), ya blue/green (do target groups / do ASGs).

**Q: Existing manual resource ko Terraform me kaise laoge?**
`terraform import` ya Terraform 1.5+ ka `import {}` block, phir `plan` zero diff aane tak code adjust.

**Q: Ise multiple environments ke liye kaise banaoge?**
Code ko modules me todo (network, compute, db), har env ka alag folder/tfvars aur alag backend key. Ya Terragrunt. Workspaces sirf chhote cases me.

**Q: Cost kya-kya lagega?**
Sabse mehnga NAT Gateway (per hour + data), ALB, RDS Multi-AZ (double), 2x EC2. Free tier me bhi NAT aur Multi-AZ RDS free nahi. Practice ke baad `terraform destroy` zaroor.

**Q: Terraform `plan` me password change dikh raha hai bina code change ke, kyu?**
`random_password` tab hi badalta hai jab uske arguments ya `keepers` badle. Agar dikh raha hai to state kho gayi ya kisi ne argument badla. Isliye state backup (S3 versioning) zaroori.

---

## 7. Interview me 30 second ka pitch

"Maine Terraform se AWS pe ek 3 tier web app deploy kiya. 2 AZ me VPC with public, private-app aur private-db subnets. Internet traffic sirf ALB pe aata hai jo ACM certificate se HTTPS terminate karta hai aur HTTP ko redirect karta hai. App Auto Scaling Group me private subnet me chalti hai, CPU target tracking ke saath. DB RDS MySQL Multi-AZ, encrypted, private. Password Terraform generate karke Secrets Manager me rakhta hai aur EC2 IAM role se padhta hai, IMDSv2 enforce hai, SSH ki jagah SSM. State S3 me DynamoDB locking ke saath, aur GitHub Actions OIDC se PR pe plan aur main pe apply karta hai, koi static AWS key nahi."
