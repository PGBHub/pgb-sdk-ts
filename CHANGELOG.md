# Changelog

## 0.2.0 (unreleased)

**New**
- Storage: private buckets and signed URLs. `storage.createSignedUrl(bucket, path, { method, expiresIn, contentType })` mints a GET or PUT URL for one object (`POST /storage/sign`, secret key). `storage.uploadToSignedUrl(url, body, contentType)` uploads to a signed PUT URL without an API key. `storage.createBucket(name, { visibility })` creates a public (default) or private bucket. `storage.setBucketVisibility(name, visibility, { confirmPublic })` changes it; going public throws unless `confirmPublic: true`.
- Types: `BucketVisibility`, `CreateSignedUrlOptions`, `SignedUrl`, `SignedUploadResult`, `BucketVisibilityChange`.
- `getPublicUrl()` is documented as public-bucket only: a private bucket's objects need the secret key or a signed URL.

## 0.1.0 (unreleased)

First release; not yet published.

- Mail: `replyTo` on `mail.send()` is sent as `reply_to` (and only when set). `MailSendResult.message_id` is filled from `mail_id` when an older server returns only that; `mail_id`, `to`, `from`, `provider` and `status` are typed.
- Mail: a failed send throws `PGBError` with `status`, the server's `code` and `body`. With no mail provider configured that is HTTP 503 and `MAIL_PROVIDER_UNAVAILABLE` (exported as a constant). Multi-recipient `results` carry the `code` too.
- `AuthSettings.signup_fields` (the `SignupField` type): the extra sign-up fields a project asks for. Send their values as `metadata` on `signUp()`; the server checks them.

**Fixes**
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
- Published as `@pgb/sdk`, matching the manifest and the documentation.
