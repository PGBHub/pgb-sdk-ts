#!/usr/bin/env node

import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { createClient, type SchemaJson } from "./client";

export async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "login":
      await handleLogin(args.slice(1));
      break;
    case "init":
      await handleInit(args.slice(1));
      break;
    case "dev":
      await handleDev(args.slice(1));
      break;
    case "pull":
      await handlePull(args.slice(1));
      break;
    case "inspect":
      await handleInspect(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      printUsage();
      break;
  }
}

function printUsage() {
  console.log(`
⚡ PGBHub Developer CLI (pgb) — @pgb/sdk

Usage:
  pgb <command> [options]

Commands:
  pgb init <project>   Scaffold a standardized PGB starter template
  pgb dev              Start the local developer simulator on port 4000
  pgb login            Authenticate CLI with your PGBHub account
  pgb pull             Pull /schema.json and generate TypeScript types (pgbhub.d.ts)
  pgb inspect          Print database semantic schema JSON to stdout
  pgb help             Show this help documentation

Options:
  --port <port>        Port for pgb dev simulator (default: 4000)
  --endpoint <url>     PGBHub Cloud endpoint (default: $PGBHUB_ENDPOINT or https://cloud.pgbhub.com)
  --key <api-key>      PGBHub API Key (default: $PGBHUB_API_KEY)
  --db <dbname>        Target database name (default: postgres)
  --out <filename>     Output filename for pgb pull (default: pgbhub.d.ts)
`);
}

async function handleLogin(args: string[]) {
  const keyIndex = args.indexOf("--key");
  let key = keyIndex !== -1 ? args[keyIndex + 1] : undefined;

  if (!key) {
    key = process.env.PGBHUB_API_KEY;
  }

  if (!key) {
    console.log(`
🔐 PGBHub Authentication:
Please specify your API key using:
  pgb login --key <pgb_sec_...>

Or set the environment variable:
  export PGBHUB_API_KEY="pgb_sec_..."

You can obtain your secret key from your PGBHub Console dashboard.
`);
    process.exit(1);
  }

  const configDir = path.join(os.homedir(), ".pgbhub");
  const configFile = path.join(configDir, "config.json");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const endpointIndex = args.indexOf("--endpoint");
  const endpoint = endpointIndex !== -1 ? args[endpointIndex + 1] : process.env.PGBHUB_ENDPOINT || "https://cloud.pgbhub.com";

  fs.writeFileSync(configFile, JSON.stringify({ apiKey: key, endpoint, loggedInAt: new Date().toISOString() }, null, 2));
  console.log(`✅ Successfully logged in! Credentials saved to ~/.pgbhub/config.json`);
}

async function handleInit(args: string[]) {
  const projectName = args.find((a) => !a.startsWith("-")) || "my-pgb-app";
  const targetDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.error(`❌ Target directory '${projectName}' already exists and is not empty.`);
    process.exit(1);
  }

  console.log(`🚀 Scaffolding new PGBHub project in ./${projectName}...`);

  fs.mkdirSync(path.join(targetDir, "functions"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "containers"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "cron"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "migrations"), { recursive: true });

  // 1. functions/hello.ts
  fs.writeFileSync(
    path.join(targetDir, "functions", "hello.ts"),
    `/**
 * PGB Multi-Endpoint Function Module
 */
export default async function handler(req: Request) {
  const url = new URL(req.url);
  return new Response(
    JSON.stringify({
      message: "Hello from PGB Cloud Functions!",
      path: url.pathname,
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { "content-type": "application/json" },
    }
  );
}
`
  );

  // 2. containers/Dockerfile
  fs.writeFileSync(
    path.join(targetDir, "containers", "Dockerfile"),
    `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
`
  );

  // 3. cron/daily-summary.ts
  fs.writeFileSync(
    path.join(targetDir, "cron", "daily-summary.ts"),
    `/**
 * PGB Scheduled Task (Daily Summary)
 */
export async function run() {
  console.log("Running scheduled maintenance and daily rollup summary...");
  return { status: "completed", processed: 0, timestamp: new Date().toISOString() };
}
`
  );

  // 4. migrations/001_initial_schema.sql
  fs.writeFileSync(
    path.join(targetDir, "migrations", "001_initial_schema.sql"),
    `-- Initial PGBHub Schema Migration
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_created_at ON items (created_at DESC);
`
  );

  // 5. pgb.config.json
  fs.writeFileSync(
    path.join(targetDir, "pgb.config.json"),
    JSON.stringify(
      {
        $schema: "https://pgbhub.dev/schemas/pgb.config.json",
        project: projectName,
        region: "auto",
        version: "1.0.0",
        database: {
          engine: "postgres",
          version: "17",
          connection_limit: 25,
        },
        containers: {
          tier: "micro",
          min_replicas: 0,
          max_replicas: 5,
          schedule: "always_on",
        },
        storage: {
          pool_mb: 500,
        },
      },
      null,
      2
    ) + "\n"
  );

  // 6. .env.example
  fs.writeFileSync(
    path.join(targetDir, ".env.example"),
    `PGBHUB_PROJECT_URL=https://${projectName}.pgbhub.dev
PGBHUB_API_KEY=pgb_sec_example_key_replace_with_actual
PGBHUB_PUBLISHABLE_KEY=pgb_pub_example_key_replace_with_actual
DATABASE_URL=postgresql://${projectName}_app:password@db.pgbhub.dev:5432/${projectName}
`
  );

  // 7. package.json
  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: projectName,
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "pgb dev",
          pull: "pgb pull",
        },
        dependencies: {
          "@pgb/sdk": "^1.0.0",
        },
      },
      null,
      2
    ) + "\n"
  );

  // 8. README.md
  fs.writeFileSync(
    path.join(targetDir, "README.md"),
    `# ${projectName}

Full-stack project powered by [PGBHub Cloud](https://pgbhub.com).

## Project Structure

- \`functions/\`: Multi-endpoint serverless edge functions.
- \`containers/\`: CRIU-accelerated container services.
- \`cron/\`: Timezone-aware scheduled background jobs.
- \`migrations/\`: Idempotent SQL schema migrations.
- \`pgb.config.json\`: Portable infrastructure & scaling configuration.

## Getting Started

1. Copy environment variables:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

2. Run the offline simulator:
   \`\`\`bash
   npx pgb dev
   \`\`\`
`
  );

  console.log(`✅ Standardized PGBHub project template initialized in ./${projectName}!`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  npx pgb dev\n`);
}

async function handleDev(args: string[]) {
  const portIndex = args.indexOf("--port");
  const port = parseInt(portIndex !== -1 ? args[portIndex + 1] : process.env.PORT || "4000", 10);

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk;
    });

    req.on("end", () => {
      let body: any = {};
      try {
        if (bodyText) body = JSON.parse(bodyText);
      } catch {
        body = {};
      }

      res.setHeader("Content-Type", "application/json");

      // Route dispatch
      if (pathname === "/" || pathname === "/health") {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok", simulator: "pgb-dev", port, timestamp: new Date().toISOString() }));
      } else if (pathname === "/sql") {
        console.log(`[pgb-dev:sql] ${body.sql || "(empty sql)"} | params:`, body.params || []);
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            simulated: true,
            rows: [],
            row_count: 0,
            columns: [],
          })
        );
      } else if (pathname.startsWith("/auth/signup") || pathname.startsWith("/auth/login")) {
        const email = body.email || "dev@local.pgbhub.dev";
        console.log(`[pgb-dev:auth] ${pathname} for ${email}`);
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            user: {
              id: "usr_simulated_dev",
              email,
              is_verified: true,
              created_at: new Date().toISOString(),
            },
            session: {
              access_token: "simulated_dev_jwt_access_token",
              refresh_token: "simulated_dev_refresh_token",
              expires_in: 3600,
            },
          })
        );
      } else if (pathname.startsWith("/auth/user")) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            user: {
              id: "usr_simulated_dev",
              email: "dev@local.pgbhub.dev",
              is_verified: true,
            },
          })
        );
      } else if (pathname.startsWith("/auth/logout") || pathname.startsWith("/auth/magic") || pathname.startsWith("/auth/otp")) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: "Dev simulator operation successful" }));
      } else if (pathname === "/mail/send") {
        console.log(`[pgb-dev:mail] To: ${JSON.stringify(body.to)}, Subject: "${body.subject}"`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, simulated: true, message_id: `msg_dev_${Date.now()}` }));
      } else if (pathname.startsWith("/storage/upload")) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            upload_url: `http://localhost:${port}/storage/${body.file_path || "upload.bin"}`,
            public_url: `http://localhost:${port}/storage/${body.file_path || "upload.bin"}`,
          })
        );
      } else if (pathname.startsWith("/storage/")) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, path: pathname.replace("/storage/", "") }));
      } else if (pathname.startsWith("/functions/")) {
        const fnName = pathname.replace("/functions/", "");
        console.log(`[pgb-dev:functions] Invoked function: ${fnName}`);
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            simulated: true,
            function: fnName,
            result: { message: `Function '${fnName}' executed in local simulator.` },
          })
        );
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, simulator: "pgb-dev", path: pathname }));
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`
========================================================================
🚀 PGBHub Local Developer Simulator active on http://127.0.0.1:${port}
========================================================================
📡 Endpoints ready:
   - POST /sql               (HTTP Database Gateway Simulator)
   - POST /auth/signup       (Simulated Auth User Registration)
   - POST /auth/login        (Simulated Auth JWT Session Generation)
   - GET  /auth/user         (Simulated User Profile)
   - POST /storage/upload    (Simulated Cloudflare R2 Uploads)
   - POST /mail/send         (Console-Logged Transactional Email)
   - POST /functions/:name   (Edge Function Simulator)
   - GET  /health            (Simulator Health Check)

💡 You can point your local apps and @pgb/sdk to http://127.0.0.1:${port}!
Press Ctrl+C to terminate simulator.
`);
  });
}

async function handlePull(args: string[]) {
  const endpointIndex = args.indexOf("--endpoint");
  const endpoint = endpointIndex !== -1 ? args[endpointIndex + 1] : process.env.PGBHUB_ENDPOINT || "https://cloud.pgbhub.com";

  const keyIndex = args.indexOf("--key");
  const apiKey = keyIndex !== -1 ? args[keyIndex + 1] : process.env.PGBHUB_API_KEY;

  const dbIndex = args.indexOf("--db");
  const database = dbIndex !== -1 ? args[dbIndex + 1] : process.env.PGBHUB_DATABASE || "postgres";

  const outIndex = args.indexOf("--out");
  const outputFile = outIndex !== -1 ? args[outIndex + 1] : "pgbhub.d.ts";

  console.log(`📡 Connecting to PGBHub at ${endpoint} (db: ${database})...`);
  const client = createClient({ endpoint, apiKey, database });

  try {
    const schema = await client.getSchema();
    console.log(`✨ Generating TypeScript type definitions from schema (v${schema.version})...`);
    const dtsContent = generateDeclarationContent(schema);

    const outPath = path.resolve(process.cwd(), outputFile);
    fs.writeFileSync(outPath, dtsContent, "utf-8");
    console.log(`✅ Successfully generated typed schema definitions: ${outputFile}`);
    console.log(`💡 You can now import and use full typed autocomplete with @pgb/sdk!`);
  } catch (err) {
    console.error(`❌ Error executing pgb pull:`, (err as Error).message);
    process.exit(1);
  }
}

async function handleInspect(args: string[]) {
  const endpointIndex = args.indexOf("--endpoint");
  const endpoint = endpointIndex !== -1 ? args[endpointIndex + 1] : process.env.PGBHUB_ENDPOINT || "https://cloud.pgbhub.com";

  const keyIndex = args.indexOf("--key");
  const apiKey = keyIndex !== -1 ? args[keyIndex + 1] : process.env.PGBHUB_API_KEY;

  const dbIndex = args.indexOf("--db");
  const database = dbIndex !== -1 ? args[dbIndex + 1] : process.env.PGBHUB_DATABASE || "postgres";

  const client = createClient({ endpoint, apiKey, database });
  try {
    const schema = await client.getSchema();
    console.log(JSON.stringify(schema, null, 2));
  } catch (err) {
    console.error(`❌ Error executing pgb inspect:`, (err as Error).message);
    process.exit(1);
  }
}

function generateDeclarationContent(schema: SchemaJson): string {
  const tableInterfaces: string[] = [];
  const tableAccessors: string[] = [];
  const actionSignatures: string[] = [];
  const directActionMethods: string[] = [];

  for (const [_key, table] of Object.entries(schema.tables)) {
    const interfaceName = toPascalCase(table.name);
    const singularName = toCamelCase(table.name.replace(/s$/, ""));
    const pluralName = toCamelCase(table.name);

    const fields = table.columns.map((col) => {
      const opt = col.nullable ? "?" : "";
      return `    /** ${col.name} (${col.data_type}) */\n    ${col.name}${opt}: ${col.type_ts};`;
    });

    tableInterfaces.push(`  export interface ${interfaceName} {\n${fields.join("\n")}\n  }`);

    tableAccessors.push(`    /** Typed table model for '${table.name}' */\n    readonly ${singularName}: TableClient<Schema.${interfaceName}>;`);
    if (pluralName !== singularName) {
      tableAccessors.push(`    /** Typed table model for '${table.name}' */\n    readonly ${pluralName}: TableClient<Schema.${interfaceName}>;`);
    }
  }

  for (const [actionName, action] of Object.entries(schema.actions)) {
    const desc = action.description ? `/** ${action.description} */\n` : "";
    actionSignatures.push(
      `      ${desc}${actionName}(params?: Record<string, unknown>, opts?: { dryRun?: boolean }): Promise<ActionResponse>;`
    );
    directActionMethods.push(
      `    ${desc}${actionName}(params?: Record<string, unknown>, opts?: { dryRun?: boolean }): Promise<ActionResponse>;`
    );
  }

  return `// Auto-generated by PGBHub CLI (npx pgb pull)
// Do not edit directly. Re-run 'npx pgb pull' to sync latest database changes.

import { ActionResponse, TableClient } from "@pgb/sdk";

declare module "@pgb/sdk" {
  export namespace Schema {
${tableInterfaces.join("\n\n")}
  }

  export interface PGBHubClient {
    // --- Typed Table Accessors (ORM / Query Paradigm) ---
${tableAccessors.length > 0 ? tableAccessors.join("\n") : "    // No public tables"}

    // --- Direct Action Signatures ---
${directActionMethods.join("\n")}

    readonly actions: {
${actionSignatures.length > 0 ? actionSignatures.join("\n") : "      [key: string]: (params?: Record<string, unknown>, opts?: { dryRun?: boolean }) => Promise<ActionResponse>;"}
    };
  }
}
`;
}

function toPascalCase(str: string): string {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
    .replace(/[\s\-_]+/g, "");
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

if (require.main === module) {
  runCli();
}
