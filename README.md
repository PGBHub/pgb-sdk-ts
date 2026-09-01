# @pgbox/client (TypeScript & Node.js SDK)

Official TypeScript and Node.js client SDK for **PGBox Cloud**.

## Installation

```bash
npm install @pgbox/client
# or
pnpm add @pgbox/client
# or
yarn add @pgbox/client
```

## Quick Start

```typescript
import { createClient } from "@pgbox/client";

// Initialize client
const pgbox = createClient({
  apiKey: process.env.PGBOX_API_KEY,
  endpoint: "https://cloud.pgboxhub.com",
  database: "my_database",
});

// Dynamic Action Invocation (Mapped directly to your declarative actions)
const res = await pgbox.actions.approveOrder({
  orderId: "ord_9843",
  approvedBy: "admin_user",
});

console.log(res.status, res.duration_ms, res.results);
```

## Local Type Generation (`npx pgbox pull`)

Run the CLI in your project to pull `/schema.json` and generate local TypeScript declaration files with autocomplete for all tables and actions:

```bash
npx pgbox pull --db my_database
```

This generates `pgbox.d.ts` in your root directory, providing full IntelliSense in VS Code and Cursor!

## License

MIT © [Hydratik](https://github.com/Hydratik)
