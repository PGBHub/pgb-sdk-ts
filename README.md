# @pgbhub/client (TypeScript & Node.js SDK)

Official TypeScript and Node.js client SDK for **PGBHub Cloud**.

## Installation

```bash
npm install @pgbhub/client
# or
pnpm add @pgbhub/client
# or
yarn add @pgbhub/client
```

## Developer Paradigms

### 1. Typed Table Models (ORM / Query Paradigm)

```typescript
import { pgb } from "@pgbhub/client";

// Access tables as first-class entity accessors
const User = pgb.user;

// Full autocomplete on parameters and return types!
const profiles = await User.find({ id: "8ef5-492a-bb81" });

// Find single record
const user = await User.findOne({ email: "alex@example.com" });

// Insert a record
const newUser = await User.create({
  email: "alex@example.com",
  name: "Alex",
});

// Update & delete
await User.update({ id: "8ef5-492a-bb81" }, { name: "Alexander" });
await User.delete({ id: "8ef5-492a-bb81" });
```

### 2. Declarative Database Actions

```typescript
// Direct invocation with automatic parameter validation
const res = await pgb.saveUser({
  username: "jdoe",
  email: "jdoe@example.com",
  preferences: { theme: "dark" },
});

console.log(res.status, res.duration_ms, res.results);
```

## Local vs. Cloud: Seamless Switching

The exact same `@pgbhub/client` code works identically against **local PostgreSQL** (Docker / offline) and **PGBHub Cloud**:

```typescript
import { createClient } from "@pgbhub/client";

// Seamless 1-env switch:
// Local:      DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myapp"
// Production: PGBHUB_ENDPOINT="https://console.pgbhub.com" PGBHUB_API_KEY="pgb_live_..."
const pgb = createClient({
  endpoint: process.env.PGBHUB_ENDPOINT,
  apiKey: process.env.PGBHUB_API_KEY,
  dbUrl: process.env.DATABASE_URL,
  database: "myapp",
});
```

Zero code rewrites are required when promoting from local testing to production cloud.

---

## Deterministic Type Generation (Zero AI Tokens)

Run the CLI in your project to pull the live schema from your local or cloud database and deterministically generate TypeScript declaration files (`pgbhub.d.ts`) without spending a single AI token:

```bash
npx pgbhub pull --db my_database --out src/types/pgbhub.d.ts
```

This generates:
- Full TypeScript interfaces for every database table.
- Autocomplete and type validation on `pgb.table('users').find({ ... })`.
- Typed parameter and return types for custom database actions.

---

## Comprehensive Developer & AI Agent Guide

For detailed documentation, architectural diagrams, LLM agent tool definitions, and copy-pastable recipes, see the **[PGBHub Master Developer & AI Agent Guide](file:///Users/alveis/Projects/Hydratik/pgbhub/PGB_DEVELOPER_GUIDE.md)**.

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

