// Round 3: production-readiness. Typed errors, the timeout/retry policy, the
// project domain, database scoping, the complete Auth surface and the Actions
// management API. Imports the real client and mocks global fetch to pin the
// exact method/path/body/headers each call sends.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, AuthClient, PGBError, createClient, errorMessageFrom } from "../src/client.js";

type FetchCall = { url: string; init: any };
type Reply = { ok: boolean; status?: number; json?: any; headers?: Record<string, string>; throws?: any };

let calls: FetchCall[] = [];
let replies: Reply[] = [];
let responder: (call: FetchCall, index: number) => Reply;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  replies = [];
  responder = (_c, i) => replies[Math.min(i, replies.length - 1)] ?? { ok: true, json: {} };
  (globalThis as any).fetch = async (url: string, init: any) => {
    const index = calls.length;
    calls.push({ url, init });
    const r = responder({ url, init }, index);
    if (r.throws) throw r.throws;
    const headerMap = r.headers || {};
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? "OK" : "Error",
      json: async () => r.json ?? {},
      text: async () => JSON.stringify(r.json ?? {}),
      headers: { get: (name: string) => headerMap[name.toLowerCase()] ?? null },
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PGBHUB_PROJECT_DOMAIN;
  delete process.env.PGBHUB_PROJECT_ID;
  delete process.env.PGBHUB_DATABASE;
});

function makeClient(extra: Record<string, unknown> = {}) {
  return new PGBHubClientCore({ endpoint: "https://acme.pgbhub.app", apiKey: "pgb_pub_key", retryDelayMs: 1, ...extra });
}

function signedIn(auth: AuthClient) {
  auth.setSession({ access_token: "user-token", refresh_token: "rt" });
}

// ─── errors ─────────────────────────────────────────────────────────────

test("errorMessageFrom reads {error}, FastAPI {detail}, and falls back sensibly", () => {
  assert.equal(errorMessageFrom({ error: "Nope." }), "Nope.");
  assert.equal(errorMessageFrom({ detail: "Action 'x' not found." }), "Action 'x' not found.");
  assert.equal(errorMessageFrom({ detail: [{ msg: "field required" }, { msg: "bad type" }] }), "field required; bad type");
  assert.equal(errorMessageFrom({ message: "m" }), "m");
  assert.equal(errorMessageFrom("plain"), "plain");
  assert.equal(errorMessageFrom(undefined, "fallback"), "fallback");
});

test("a failed call throws a PGBError carrying status, body and retryAfter", async () => {
  responder = () => ({ ok: false, status: 429, json: { error: "Too many requests." }, headers: { "retry-after": "12" } });
  const auth = new AuthClient(makeClient());
  await assert.rejects(auth.signIn({ email: "a@b.co", password: "x" }), (err: any) => {
    assert.ok(err instanceof PGBError && err instanceof Error);
    assert.equal(err.name, "PGBError");
    assert.equal(err.status, 429);
    assert.equal(err.retryAfter, 12);
    assert.deepEqual(err.body, { error: "Too many requests." });
    assert.match(err.message, /PGBHub Auth \/auth\/login failed \[429\]: Too many requests\./);
    return true;
  });
});

test("an Actions API error (FastAPI detail) surfaces the readable message", async () => {
  responder = () => ({ ok: false, status: 404, json: { detail: "Action 'ghost' not found." } });
  await assert.rejects(makeClient().actions.$get("ghost"), (err: any) => {
    assert.equal(err.status, 404);
    assert.match(err.message, /Action 'ghost' not found\./);
    return true;
  });
});

// ─── transport policy ───────────────────────────────────────────────────

test("reads are retried on 503 and succeed; Retry-After is honoured", async () => {
  replies = [
    { ok: false, status: 503, json: {} },
    { ok: false, status: 429, json: {}, headers: { "retry-after": "0" } },
    { ok: true, json: { actions: [] } },
  ];
  const out = await makeClient({ maxRetries: 2 }).actions.$list();
  assert.deepEqual(out, []);
  assert.equal(calls.length, 3);
});

test("a read gives up after maxRetries and returns the last response as a PGBError", async () => {
  replies = [{ ok: false, status: 503, json: { error: "down" } }];
  await assert.rejects(makeClient({ maxRetries: 1 }).actions.$list(), (err: any) => err.status === 503);
  assert.equal(calls.length, 2);
});

test("writes are never retried automatically", async () => {
  replies = [{ ok: false, status: 503, json: { error: "down" } }];
  const auth = new AuthClient(makeClient({ maxRetries: 5 }));
  await assert.rejects(auth.requestOtp({ email: "a@b.co" }));
  assert.equal(calls.length, 1);
});

test("a network failure on a read is retried, then thrown as a network_error PGBError", async () => {
  responder = () => ({ ok: false, throws: new TypeError("fetch failed") });
  await assert.rejects(makeClient({ maxRetries: 1 }).actions.$list(), (err: any) => {
    assert.ok(err instanceof PGBError);
    assert.equal(err.code, "network_error");
    assert.match(err.message, /fetch failed/);
    return true;
  });
  assert.equal(calls.length, 2);
});

test("a timeout is a timeout PGBError", async () => {
  const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  responder = () => ({ ok: false, throws: abort });
  await assert.rejects(makeClient({ maxRetries: 0, timeoutMs: 50 }).actions.$list(), (err: any) => err.code === "timeout" && /timed out after 50ms/.test(err.message));
});

test("every request carries a timeout signal unless the caller disabled it", async () => {
  await makeClient().actions.$list();
  assert.ok(calls[0].init.signal, "default timeout is applied");
  calls = [];
  await makeClient({ timeoutMs: 0 }).actions.$list();
  assert.equal(calls[0].init.signal, undefined);
});

test("a custom fetch can be injected", async () => {
  let used = 0;
  const custom = (async () => {
    used++;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ actions: [] }) };
  }) as any;
  await makeClient({ fetch: custom }).actions.$list();
  assert.equal(used, 1);
  assert.equal(calls.length, 0);
});

// ─── project address and database scoping ───────────────────────────────

test("a bare project name resolves to <name>.pgbhub.app, not .pgbhub.dev", () => {
  assert.equal(createClient("acme-app").endpoint, "https://acme-app.pgbhub.app");
  assert.equal(createClient("https://custom.example.com/").endpoint, "https://custom.example.com");
});

test("projectId alone selects the project's own address, and the domain is overridable", () => {
  assert.equal(new PGBHubClientCore({ projectId: "ridemesh-dev" }).endpoint, "https://ridemesh-dev.pgbhub.app");
  process.env.PGBHUB_PROJECT_DOMAIN = "pgb.example.org";
  assert.equal(new PGBHubClientCore({ projectId: "ridemesh-dev" }).endpoint, "https://ridemesh-dev.pgb.example.org");
  assert.equal(createClient("x").endpoint, "https://x.pgb.example.org");
  assert.equal(new PGBHubClientCore({ projectId: "p", endpoint: "http://localhost:4000" }).endpoint, "http://localhost:4000");
});

test("no database is sent unless one was configured (so a project key uses its own)", async () => {
  await makeClient().invokeAction("saveUser", { a: 1 });
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "saveUser", params: { a: 1 }, dry_run: false });
  calls = [];
  await makeClient({ database: "appdb" }).invokeAction("saveUser", {});
  assert.equal(JSON.parse(calls[0].init.body).dbname, "appdb");
  calls = [];
  await makeClient({ database: "appdb" }).actions.$list();
  assert.match(calls[0].url, /\/v1\/actions\?dbname=appdb$/);
  calls = [];
  await makeClient().actions.$list();
  assert.equal(calls[0].url, "https://acme.pgbhub.app/v1/actions");
});

// ─── Auth ───────────────────────────────────────────────────────────────

test("signUp: a verification-required result does not pretend to be signed in", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { verification_required: true, user: { id: "u1", email: "a@b.co" }, message: "We emailed a code." } });
  const result = await auth.signUp({ email: "a@b.co", redirectTo: "https://app.acme.dev/welcome" });
  assert.equal((result as any).verification_required, true);
  assert.equal(auth.getSession(), null);
  assert.equal(JSON.parse(calls[0].init.body).redirect_to, "https://app.acme.dev/welcome");
});

test("signIn returns an MFA challenge without a session, and verifyMfa completes it", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { mfa_required: true, challenge_token: "ch1", expires_in: 300 } });
  const first = await auth.signIn({ email: "a@b.co", password: "pw" });
  assert.equal(first.mfa_required, true);
  assert.equal(auth.getSession(), null);
  const session = { access_token: "at", refresh_token: "rt" };
  responder = () => ({ ok: true, json: { user: { id: "u1", email: "a@b.co" }, session } });
  await auth.verifyMfa({ challengeToken: "ch1", code: "123456" });
  assert.equal(calls[1].url, "https://acme.pgbhub.app/auth/mfa/verify");
  assert.deepEqual(JSON.parse(calls[1].init.body), { challenge_token: "ch1", code: "123456" });
  assert.deepEqual(auth.getSession(), session);
});

test("requestOtp, sendMagicLink and resendVerification send only what they need; secrets are never expected back", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { message: "sent", expires_in: 600 } });
  const otp = await auth.requestOtp({ email: "a@b.co" });
  assert.deepEqual(Object.keys(otp).sort(), ["expires_in", "message"]);
  await auth.sendMagicLink({ email: "a@b.co", redirectTo: "https://app.acme.dev/in" });
  await auth.resendVerification({ email: "a@b.co" });
  assert.deepEqual(calls.map((c) => c.url.replace("https://acme.pgbhub.app", "")), ["/auth/otp", "/auth/magic", "/auth/resend-verification"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { email: "a@b.co", redirect_to: "https://app.acme.dev/in" });
  assert.deepEqual(JSON.parse(calls[2].init.body), { email: "a@b.co" });
});

test("forgotPassword and resetPassword", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { message: "ok" } });
  await auth.forgotPassword({ email: "a@b.co", redirectTo: "https://app.acme.dev/new" });
  await auth.resetPassword({ token: "tok", password: "NewPassword1!" });
  assert.equal(calls[0].url, "https://acme.pgbhub.app/auth/forgot-password");
  assert.equal(JSON.parse(calls[0].init.body).redirect_to, "https://app.acme.dev/new");
  assert.deepEqual(JSON.parse(calls[1].init.body), { token: "tok", password: "NewPassword1!" });
});

test("methods that act as the user send the user's token, and refuse when nobody is signed in", async () => {
  const auth = new AuthClient(makeClient());
  await assert.rejects(auth.changePassword({ currentPassword: "a", newPassword: "b" }), (err: any) => err instanceof PGBError && err.code === "not_signed_in");
  await assert.rejects(auth.listSessions(), (err: any) => err.status === 401);
  assert.equal(calls.length, 0, "nothing is sent without a user");

  signedIn(auth);
  responder = () => ({ ok: true, json: { message: "ok", sessions_revoked: 2, user: { id: "u1", email: "a@b.co" }, sessions: [], events: [], revoked: 1, enabled: true, backup_codes: [] } });
  await auth.changePassword({ currentPassword: "old", newPassword: "NewPassword1!" });
  await auth.updateUser({ metadata: { name: "Alex", plan: null } });
  await auth.enrollMfa();
  await auth.confirmMfa({ code: "123456" });
  await auth.disableMfa({ code: "654321" });
  for (const c of calls) {
    assert.equal(c.init.headers["X-PGB-User-Token"], "user-token", c.url);
    assert.equal(c.init.headers.Authorization, "Bearer pgb_pub_key", "the project key still identifies the project");
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), { current_password: "old", new_password: "NewPassword1!" });
  assert.deepEqual(JSON.parse(calls[1].init.body), { user_metadata: { name: "Alex", plan: null } });
});

test("sessions: list, revoke one (URL-encoded), revoke the others", async () => {
  const auth = new AuthClient(makeClient());
  signedIn(auth);
  responder = (c) =>
    c.init.method === "GET"
      ? { ok: true, json: { sessions: [{ id: "ses_1", device_label: "Chrome on macOS", is_current: true }] } }
      : c.url.endsWith("revoke-all")
        ? { ok: true, json: { revoked: 3 } }
        : { ok: true, json: { success: true } };
  const sessions = await auth.listSessions();
  assert.equal(sessions[0].is_current, true);
  await auth.revokeSession("ses/1 x");
  assert.equal(await auth.revokeOtherSessions(), 3);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[1].url, "https://acme.pgbhub.app/auth/sessions/ses%2F1%20x");
  assert.equal(calls[2].url, "https://acme.pgbhub.app/auth/sessions/revoke-all");
});

test("getEvents returns the list; getSettings needs no sign-in", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { signups_enabled: true, methods: { password: true, otp: true, magic_link: false }, oauth_providers: ["google"] } });
  const settings = await auth.getSettings();
  assert.equal(settings.methods.magic_link, false);
  assert.equal(calls[0].init.headers["X-PGB-User-Token"], undefined);
  signedIn(auth);
  responder = () => ({ ok: true, json: { events: [{ event_type: "login_success" }] } });
  assert.equal((await auth.getEvents())[0].event_type, "login_success");
});

test("deleteAccount clears the local session", async () => {
  const auth = new AuthClient(makeClient());
  signedIn(auth);
  responder = () => ({ ok: true, json: { message: "deleted" } });
  await auth.deleteAccount({ password: "pw" });
  assert.deepEqual(JSON.parse(calls[0].init.body), { password: "pw" });
  assert.equal(auth.getSession(), null);
});

test("a wrong current password surfaces the server's message", async () => {
  const auth = new AuthClient(makeClient());
  signedIn(auth);
  responder = () => ({ ok: false, status: 400, json: { error: "Your current password is incorrect." } });
  await assert.rejects(auth.changePassword({ currentPassword: "x", newPassword: "y" }), /current password is incorrect/);
  assert.ok(auth.getSession(), "a failed change does not sign the user out locally");
});

test("social login: oauthStart builds an encoded URL, oauthCallback stores the session", async () => {
  const auth = new AuthClient(makeClient());
  responder = () => ({ ok: true, json: { authorize_url: "https://accounts.google.com/x", state: "st" } });
  const start = await auth.oauthStart({ provider: "google", redirectUri: "https://app.acme.dev/cb?x=1&y=2" });
  assert.equal(start.state, "st");
  assert.equal(calls[0].url, "https://acme.pgbhub.app/auth/oauth/google/start?redirect_uri=https%3A%2F%2Fapp.acme.dev%2Fcb%3Fx%3D1%26y%3D2");
  const session = { access_token: "at", refresh_token: "rt" };
  responder = () => ({ ok: true, json: { user: { id: "u", email: "a@b.co" }, session } });
  await auth.oauthCallback({ provider: "github", code: "c", state: "st", redirectUri: "https://app.acme.dev/cb" });
  assert.equal(calls[1].url, "https://acme.pgbhub.app/auth/oauth/github/callback");
  assert.deepEqual(JSON.parse(calls[1].init.body), { code: "c", state: "st", redirect_uri: "https://app.acme.dev/cb" });
  assert.deepEqual(auth.getSession(), session);
});

// ─── Actions ────────────────────────────────────────────────────────────

test("pgb.actions.$list / $get map to the API and unwrap the response", async () => {
  const def = { name: "saveUser", title: "Save", description: "", input_schema: {}, output_schema: {}, sample_params: {}, effects: [], has_webhook: false };
  responder = (c) => ({ ok: true, json: c.url.includes("/v1/actions/saveUser") ? def : { actions: [def] } });
  const client = makeClient();
  assert.equal((await client.actions.$list())[0].name, "saveUser");
  assert.equal((await client.actions.$get("saveUser")).name, "saveUser");
  assert.equal(calls[1].url, "https://acme.pgbhub.app/v1/actions/saveUser");
});

test("pgb.actions.$register sends the SQL and typed effects in the API's shape", async () => {
  responder = () => ({ ok: true, json: { status: "registered", action: "saveUser", effects: [] } });
  await makeClient().actions.$register({
    name: "saveUser",
    sql: "INSERT INTO users (name) VALUES (%(name)s) RETURNING id",
    title: "Save user",
    sampleParams: { name: "A" },
    effects: [
      { type: "queue", queue: "welcome", payload: { id: "{{results.0.id}}" } },
      { type: "mail", to: "{{params.email}}", subject: "Hi", text: "Welcome" },
    ],
  });
  assert.equal(calls[0].url, "https://acme.pgbhub.app/v1/actions/register");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.sql_template, "INSERT INTO users (name) VALUES (%(name)s) RETURNING id");
  assert.equal(body.effects.length, 2);
  assert.equal(body.effects[0].payload.id, "{{results.0.id}}");
});

test("a rejected effect comes back as a 400 PGBError with the reason", async () => {
  responder = () => ({ ok: false, status: 400, json: { detail: "A 'queue' target needs 'queue'." } });
  await assert.rejects(
    makeClient().actions.$register({ name: "x", sql: "SELECT 1", effects: [{ type: "queue" } as any] }),
    (err: any) => err.status === 400 && /needs 'queue'/.test(err.message),
  );
});

test("$run, $delete, $deliveries and $retryDelivery", async () => {
  responder = (c) => ({
    ok: true,
    json: c.url.includes("/deliveries") && c.init.method === "GET" ? { deliveries: [{ id: 5, status: "failed", error: "boom" }] } : { success: true, status: "completed", action: "x", results: [], dry_run: true, duration_ms: 1 },
  });
  const client = makeClient();
  await client.actions.$run("saveUser", { name: "A" }, { dryRun: true });
  assert.equal(JSON.parse(calls[0].init.body).dry_run, true);
  const deliveries = await client.actions.$deliveries({ action: "saveUser", status: "failed", limit: 10 });
  assert.equal(deliveries[0].error, "boom");
  assert.equal(calls[1].url, "https://acme.pgbhub.app/v1/actions/deliveries?action=saveUser&status=failed&limit=10");
  await client.actions.$retryDelivery(5);
  assert.equal(calls[2].url, "https://acme.pgbhub.app/v1/actions/deliveries/5/retry");
  assert.equal(calls[2].init.method, "POST");
  await client.actions.$delete("saveUser");
  assert.equal(calls[3].init.method, "DELETE");
});

test("an action can be named anything without colliding with the management methods", async () => {
  responder = () => ({ ok: true, json: { action: "list", status: "completed", dry_run: false, duration_ms: 1, results: [] } });
  const client = makeClient();
  await client.actions.list({ a: 1 });
  await client.actions.get();
  await client.actions.register({});
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).action), ["list", "get", "register"]);
  assert.ok(calls.every((c) => c.url.endsWith("/v1/actions/invoke")));
});

test("the dynamic client still calls an action by name", async () => {
  responder = () => ({ ok: true, json: { action: "saveUser", status: "completed", dry_run: false, duration_ms: 1, results: [], effects_queued: 2 } });
  const pgb: any = createClient({ endpoint: "https://acme.pgbhub.app", apiKey: "k" });
  const res = await pgb.saveUser({ name: "A" });
  assert.equal(res.effects_queued, 2);
  assert.equal(calls[0].url, "https://acme.pgbhub.app/v1/actions/invoke");
});
