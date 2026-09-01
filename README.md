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

---

## Local Type Generation (`npx pgbox pull`)

Run the CLI in your project to pull the live schema from PGBox Cloud and generate local TypeScript declaration files (`pgbox.d.ts`) with full IntelliSense and autocomplete across all tables, models, and custom actions:

```bash
npx pgbox pull --db my_database
```

This generates `pgbox.d.ts` in your root directory:
- `pgb.user.find({ ... })` (and `pgb.users`, `pgb.orders`, etc.) with 100% typed columns, types, and return values
- `pgb.saveUser({ ... })` with typed action parameters

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

