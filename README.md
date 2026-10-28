# @pgb/sdk

The official TypeScript / Node.js SDK for **PGBHub Cloud**: database, authentication, storage, mail, functions, cron, jobs, queues, realtime and actions, from one typed client.

- Works in Node 18+, Bun, Deno and edge runtimes (it only needs `fetch`).
- Zero runtime dependencies.
- Typed errors, request timeouts and safe retries built in.

```bash
npm install @pgb/sdk
```

## Create a client

```ts
import { createClient } from "@pgb/sdk";

// In a browser or mobile app: your project's PUBLISHABLE key (pgb_pub_...).
const pgb = createClient("my-project", { key: "pgb_pub_..." });

// On a server: a SECRET key (pgb_sec_...). Never ship a secret key to a browser.
const admin = createClient({ projectId: "my-project", apiKey: process.env.PGBHUB_SECRET_KEY });
```

`createClient("my-project")` talks to `https://my-project.pgbhub.app`. You can also pass `endpoint` (any URL, such as `http://localhost:4000`), or set the environment variables `PGBHUB_PROJECT_ID`, `PGBHUB_ENDPOINT`, `PGBHUB_API_KEY` / `PGBHUB_PUBLISHABLE_KEY`, `PGBHUB_DATABASE`.

| Option | Default | Meaning |
|---|---|---|
| `endpoint` | `https://<projectId>.pgbhub.app` | Base URL of your project |
| `apiKey` | env | Project API key |
| `projectId` | env | Your project; also used for queues and the default endpoint |
| `database` | the key's own database | Only set this to target a specific database |
| `timeoutMs` | `30000` | Per-request timeout (`0` turns it off) |
| `maxRetries` | `2` | Retries for **reads** after a network error, timeout, 429, 502, 503 or 504 |
| `retryDelayMs` | `300` | Base back-off, doubled each attempt; a `Retry-After` header wins |
| `fetch` | global `fetch` | Your own fetch (tests, edge runtimes) |

Writes (POST, PUT, DELETE) are **never retried automatically**, because repeating one could repeat its effect. Retry them yourself when you know it is safe.

## Authentication

```ts
// Sign up. With a password the user also gets a verification email.
const result = await pgb.auth.signUp({ email: "alex@example.com", password: "a long passphrase" });
if (result.session) {
  // signed in
} else if (result.verification_required) {
  // The project requires a verified email (or the sign-up had no password):
  // the user finishes by redeeming the code/link we emailed them.
}

// Sign in. Two-factor accounts get a challenge instead of a session.
const login = await pgb.auth.signIn({ email: "alex@example.com", password: "..." });
if (login.mfa_required) {
  await pgb.auth.verifyMfa({ challengeToken: login.challenge_token!, code: "123456" });
}

const user = await pgb.auth.getUser();
await pgb.auth.refreshSession();   // rotates the refresh token
await pgb.auth.signOut();
```

Everything else a sign-in page needs:

```ts
// Passwordless (the code/link is only ever EMAILED; it is never in the response)
await pgb.auth.requestOtp({ email });                     await pgb.auth.verifyOtp({ email, token: "123456" });
await pgb.auth.sendMagicLink({ email, redirectTo });      await pgb.auth.verifyMagicLink({ token });

// Recovery and verification
await pgb.auth.forgotPassword({ email, redirectTo });     await pgb.auth.resetPassword({ token, password });
await pgb.auth.resendVerification({ email });

// The signed-in user
await pgb.auth.changePassword({ currentPassword, newPassword });
await pgb.auth.updateUser({ metadata: { name: "Alex" } });   // merged; null removes a key
await pgb.auth.deleteAccount({ password });
await pgb.auth.getEvents();

// Sessions (devices)
await pgb.auth.listSessions();   await pgb.auth.revokeSession(id);   await pgb.auth.revokeOtherSessions();

// Two-factor (authenticator app)
const { secret, provisioning_uri } = await pgb.auth.enrollMfa();      // show as a QR code
const { backup_codes } = await pgb.auth.confirmMfa({ code });          // shown once
await pgb.auth.disableMfa({ code });

// Social login (Google, GitHub)
const { authorize_url, state } = await pgb.auth.oauthStart({ provider: "google", redirectUri });
// ...send the user to authorize_url; on return:
await pgb.auth.oauthCallback({ provider: "google", code, state, redirectUri });

// What does this project allow? (methods on, password rules, social providers)
const settings = await pgb.auth.getSettings();
```

The SDK keeps the current session in memory (`getSession()` / `setSession()` let you persist it wherever suits your app). A revoked or signed-out session stops working immediately. With a **secret key** you also get user administration: `pgb.auth.admin.listUsers()`, `createUser()`, `getUser()`, `updateUser()`, `deleteUser()`.

Full guide: [Authentication developer guide](https://github.com/PGBHub/pgb-docs/blob/main/AUTHENTICATION_GUIDE.md).

## Actions

An **action** is a named, parameterised SQL transaction that runs atomically, optionally followed by **effects** that run reliably after it commits.

```ts
// Call an action
const res = await pgb.actions.saveUser({ name: "Alex", email: "alex@example.com" });
console.log(res.status, res.results, res.effects_queued);

// Simulate without changing anything. Effects are previewed, not run.
const preview = await pgb.actions.saveUser({ name: "Alex" }, { dryRun: true });
console.log(preview.effects_preview);
```

Define one, with effects that reach any PGBHub feature:

```ts
await admin.actions.$register({
  name: "saveUser",
  sql: "INSERT INTO users (name, email) VALUES (%(name)s, %(email)s) RETURNING id, name",
  effects: [
    { type: "queue",    queue: "welcome", payload: { user: "{{results.0.id}}" } },
    { type: "mail",     to: "{{params.email}}", subject: "Welcome, {{params.name}}", text: "Thanks for joining." },
    { type: "realtime", channel: "users", event: "created", payload: { id: "{{results.0.id}}" } },
    { type: "function", name: "syncCrm", payload: { id: "{{results.0.id}}" } },
  ],
});
```

Effect types: `function`, `queue`, `mail`, `event`, `job`, `realtime`, `container`, `action`, `webhook`. In string values, `{{params.x}}` is an input and `{{results.0.id}}` is a value the SQL returned; a value that is only a placeholder keeps its type. Effects are delivered at least once and retried with back-off, so keep them safe to repeat.

Manage and observe (methods are `$`-prefixed so they never collide with an action's name):

```ts
await admin.actions.$list();                                  // definitions, with their effects
await admin.actions.$get("saveUser");
await admin.actions.$deliveries({ status: "failed" });         // what each effect did, and why one failed
await admin.actions.$retryDelivery(42);
await admin.actions.$delete("saveUser");
```

## Mail

```ts
import { PGBError, MAIL_PROVIDER_UNAVAILABLE } from "@pgb/sdk";

try {
  const sent = await admin.mail.send({
    to: "alex@example.com",
    subject: "Your receipt",
    text: "Thanks for your order.",
    html: "<p>Thanks for your order.</p>",
    replyTo: "support@acme.dev",   // optional: one address for the Reply-To header
  });
  console.log(sent.message_id);
} catch (err) {
  if (err instanceof PGBError && err.code === MAIL_PROVIDER_UNAVAILABLE) {
    // 503: the platform has no mail provider configured right now; retry later
  }
}
```

Sending needs the project's **secret key**. `replyTo` is a single address: line breaks, commas and semicolons are refused with a 400. `message_id` identifies the sent message (on an older server it is filled from `mail_id`). An array `to` sends one message per recipient and returns per-recipient `results`.

## Errors

Every failed request throws a `PGBError`:

```ts
import { PGBError } from "@pgb/sdk";

try {
  await pgb.auth.signIn({ email, password });
} catch (err) {
  if (err instanceof PGBError) {
    err.status;       // HTTP status (undefined for network errors and timeouts)
    err.code;         // "network_error" | "timeout" | the server's code
    err.retryAfter;   // seconds, on a 429
    err.body;         // the server's response body
    err.message;      // readable, safe to show
  }
}
```

## Storage: private buckets and signed URLs

Buckets are **public** by default. A **private** bucket's objects are readable only with the project's
**secret** key (`pgb_sec_...`), by project members in the console, or through a signed URL. Publishable
keys (`pgb_pub_...`) never read private objects, because they ship inside frontends. `getPublicUrl()` does
not work for objects in a private bucket; mint a signed URL instead.

These calls need the secret key, so make them on a server and hand only the URL to the browser:

```ts
const pgb = createClient("my-project", { key: process.env.PGB_SECRET_KEY });

await pgb.storage.createBucket("receipts", { visibility: "private" }); // visibility defaults to "public"

// A 15-minute download link for one object (at most 24 hours for GET).
const { url } = await pgb.storage.createSignedUrl("receipts", "2026/inv-1.pdf", { expiresIn: 900 });

// An upload link (at most 1 hour). With contentType, the upload must use exactly that type.
const put = await pgb.storage.createSignedUrl("receipts", "2026/inv-2.pdf", { method: "PUT", contentType: "application/pdf" });
await pgb.storage.uploadToSignedUrl(put.url, fileBytes, "application/pdf"); // no API key needed: the URL is the credential

await pgb.storage.setBucketVisibility("receipts", "private");
await pgb.storage.setBucketVisibility("assets", "public", { confirmPublic: true }); // throws without confirmPublic
```

- `createSignedUrl` calls `POST /storage/sign` on the project's address, so the client must point at it
  (`createClient("my-project")` or `projectId`). `createBucket` and `setBucketVisibility` address the project by
  `projectId`, or by the slug in a `https://<slug>.pgbhub.app` endpoint.
- Anyone holding a signed URL can use it until it expires. A GET URL also answers HEAD.
- Without a bound `contentType`, a signed PUT refuses HTML, SVG, XML and JavaScript (415).
- Making a bucket private takes effect within seconds, but copies a browser or the CDN already fetched are not
  recalled.

## Other clients

| Namespace | Methods |
|---|---|
| `pgb.table(name)` / `pgb.<table>` | `find`, `findFirst`, `findOne`, `findUnique`, `create`, `insertOne`, `update`, `updateOne`, `delete`, `deleteOne`, `count` |
| `pgb.db` | `query` (HTTP SQL gateway) |
| `pgb.storage` | `upload`, `getPublicUrl` (public buckets only), `getFile`, `getMedia`, `list`, `delete`, `createSignedUrl`, `uploadToSignedUrl`, `createBucket`, `setBucketVisibility` |
| `pgb.mail` | `send` |
| `pgb.functions` | `invoke`, `list`, `deploy`, `delete` |
| `pgb.cron` | `list`, `create`, `update`, `toggle`, `run`, `listRuns`, `delete` |
| `pgb.jobs` | `enqueue`, `get`, `list`, `cancel` |
| `pgb.queues` | `send`, `receive`, `ack`, `nack` |
| `pgb.realtime` | `broadcast`, `subscribe` |

`pgb.createDatabase(name)` provisions a database (needs an account-level key) and `pgb.getSchema()` returns the schema for type generation.

## Local development and types

```bash
npx pgb pull --db my_database --out src/types/pgbhub.d.ts   # generate types from your schema
npx pgb dev                                                 # run a local mock gateway
```

## Versioning

Semantic versioning. See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT © Hydratik
