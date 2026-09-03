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

## Developer Paradigms

### 1. Typed Table Models (ORM / Query Paradigm)

```typescript
import { pgb } from "@pgbox/client";

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

The exact same `@pgbox/client` code works identically against **local PostgreSQL** (Docker / offline) and **PGBox Cloud**:

```typescript
import { createClient } from "@pgbox/client";

// Seamless 1-env switch:
// Local:      DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myapp"
// Production: PGBOX_ENDPOINT="https://pgbox.motoriqhub.com" PGBOX_API_KEY="pgb_live_..."
const pgb = createClient({
  endpoint: process.env.PGBOX_ENDPOINT,
  apiKey: process.env.PGBOX_API_KEY,
  dbUrl: process.env.DATABASE_URL,
  database: "myapp",
});
```

Zero code rewrites are required when promoting from local testing to production cloud.

---

## Deterministic Type Generation (Zero AI Tokens)

Run the CLI in your project to pull the live schema from your local or cloud database and deterministically generate TypeScript declaration files (`pgbox.d.ts`) without spending a single AI token:

```bash
npx pgbox pull --db my_database --out src/types/pgbox.d.ts
```

This generates:
- Full TypeScript interfaces for every database table.
- Autocomplete and type validation on `pgb.table('users').find({ ... })`.
- Typed parameter and return types for custom database actions.

---

## Comprehensive Developer & AI Agent Guide

For detailed documentation, architectural diagrams, LLM agent tool definitions, and copy-pastable recipes, see the **[PGBox Master Developer & AI Agent Guide](file:///Users/alveis/Projects/Hydratik/pgbox/PGB_DEVELOPER_GUIDE.md)**.

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

