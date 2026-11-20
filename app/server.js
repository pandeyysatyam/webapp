const os = require("os");
const express = require("express");
const mysql = require("mysql2/promise");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const port = Number(process.env.PORT || 3000);
const region = process.env.AWS_REGION || "ap-south-1";

async function getDbCredentials() {
  const client = new SecretsManagerClient({ region });
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN })
  );
  return JSON.parse(res.SecretString);
}

function page(dbStatus, dbTime) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Web Application</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:60px auto;padding:0 16px;color:#1b1b1b}
h1{font-size:22px}
.card{border:1px solid #ddd;border-radius:8px;padding:16px 20px;margin-top:16px}
.ok{color:#137333}.bad{color:#b00020}
code{background:#f3f3f3;padding:2px 5px;border-radius:4px}
</style></head>
<body>
<h1>Web Application</h1>
<p>Served from an EC2 instance behind the Application Load Balancer.</p>
<div class="card">
<p>Instance: <code>${os.hostname()}</code></p>
<p>Database: <span class="${dbStatus === "connected" ? "ok" : "bad"}">${dbStatus}</span></p>
${dbTime ? `<p>Database time: <code>${dbTime}</code></p>` : ""}
</div>
</body>
</html>`;
}

async function main() {
  const creds = await getDbCredentials();

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const app = express();

  app.get("/health", (req, res) => res.status(200).send("ok"));

  app.get("/", async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT NOW() AS now");
      res.send(page("connected", rows[0].now));
    } catch (err) {
      res.status(500).send(page("error: " + err.code, null));
    }
  });

  app.listen(port, () => console.log(`listening on ${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
