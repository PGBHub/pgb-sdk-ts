# Changelog

## 1.1.0

**Fixes (these affect existing apps)**
- `createClient("my-project")` now targets `https://my-project.pgbhub.app` (it built `.pgbhub.dev`, which does not exist). Override with `PGBHUB_PROJECT_DOMAIN`.
- A database name is only sent when you configure one. Before, every call named `postgres`, which a project-scoped key is not allowed to use. Projects keys now work without setting `database`.
- `sendMagicLink()` and `requestOtp()` no longer type a `token`/`otp` in the response. The platform never returns it: it is only emailed.
- `signUp()` returns a union: it has no session when the project requires verification or the sign-up had no password. Check `result.session`.

**New**
- `PGBError` with `status`, `code`, `body` and `retryAfter`; messages are unchanged.
- Per-request timeout, and automatic retries for reads (never for writes). Configurable with `timeoutMs`, `maxRetries`, `retryDelayMs`, or your own `fetch`.
- Auth: `forgotPassword`, `resetPassword`, `resendVerification`, `changePassword`, `updateUser`, `deleteAccount`, `getEvents`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `enrollMfa`, `confirmMfa`, `disableMfa`, `verifyMfa`, `oauthStart`, `oauthCallback`, `getSettings`; `redirectTo` on sign-up, magic link, reset and resend.
- Actions: effects (`function`, `queue`, `mail`, `event`, `job`, `realtime`, `container`, `action`, `webhook`), dry-run previews, and the `$list` / `$get` / `$register` / `$delete` / `$run` / `$deliveries` / `$retryDelivery` management methods.
- `projectId` alone now selects the project's address.

**Packaging**
- Published as `@pgbhub/client` (the name the documentation uses). The manifest previously said `@pgb/sdk`.
