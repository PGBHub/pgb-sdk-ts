// Regression tests for Round 1: the real AuthClient (backed by
// pgb-cloud's new /auth/* ingress router), StorageClient.getFile/getMedia,
// FunctionsClient.deploy/delete, and PGBHubClientCore.createDatabase.
// These import the real compiled client and mock global.fetch to pin the
// exact HTTP method/path/body/headers each method sends.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, AuthClient, StorageClient, FunctionsClient } from "../src/client.js";

type FetchCall = { url: string; init: any };

let calls: FetchCall[] = [];
let responder: (call: FetchCall) => { ok: boolean; status?: number; json?: any; headers?: Record<string, string>; arrayBuffer?: ArrayBuffer };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responder = () => ({ ok: true, json: {} });
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responder({ url, init });
    const headerMap = r.headers || {};
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? "OK" : "Error",
      json: async () => r.json ?? {},
      text: async () => JSON.stringify(r.json ?? {}),
      arrayBuffer: async () => r.arrayBuffer ?? new ArrayBuffer(0),
      headers: { get: (name: string) => headerMap[name.toLowerCase()] ?? null },
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient() {
  return new PGBHubClientCore({ endpoint: "https://test.pgbhub.dev", apiKey: "pgb_sec_test", database: "appdb" });
}

// ─── AuthClient ─────────────────────────────────────────────────────────

test("AuthClient.signUp: POSTs /auth/signup and stores the returned session", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);
  const user = { id: "usr_1", email: "a@test.com" };
  const session = { access_token: "at1", refresh_token: "rt1" };
  responder = () => ({ ok: true, json: { user, session } });

  const result = await auth.signUp({ email: "a@test.com", password: "pw" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/auth/signup");
  assert.deepEqual(result.session, session);
  assert.deepEqual(auth.getSession(), session);
});

test("AuthClient.signIn: on failure, throws with the server's error message and does not set a session", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);
  responder = () => ({ ok: false, status: 400, json: { error: "Invalid email or password." } });

  await assert.rejects(() => auth.signIn({ email: "a@test.com", password: "wrong" }), /Invalid email or password/);
  assert.equal(auth.getSession(), null);
});

test("AuthClient.signOut: sends the session's access_token as X-PGB-User-Token to /auth/logout, then clears local state", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);
  auth.setSession({ access_token: "at1", refresh_token: "rt1" });
  responder = () => ({ ok: true, json: { success: true } });

  await auth.signOut();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/auth/logout");
  assert.equal(calls[0].init.headers["X-PGB-User-Token"], "at1");
  assert.equal(auth.getSession(), null);
});

test("AuthClient.getUser: returns null without a network call when there is no active session", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);

  const user = await auth.getUser();

  assert.equal(user, null);
  assert.equal(calls.length, 0);
});

test("AuthClient.getUser: sends X-PGB-User-Token and returns the resolved user", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);
  auth.setSession({ access_token: "at1", refresh_token: "rt1" });
  const user = { id: "usr_1", email: "a@test.com" };
  responder = () => ({ ok: true, json: { user } });

  const result = await auth.getUser();

  assert.equal(calls[0].url, "https://test.pgbhub.dev/auth/user");
  assert.equal(calls[0].init.headers["X-PGB-User-Token"], "at1");
  assert.deepEqual(result, user);
});

test("AuthClient.admin.createUser/listUsers/deleteUser: hit the admin endpoints", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);

  responder = () => ({ ok: true, json: { user: { id: "usr_2", email: "b@test.com" } } });
  const created = await auth.admin.createUser({ email: "b@test.com" });
  assert.equal(calls[0].url, "https://test.pgbhub.dev/auth/admin/users");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(created.email, "b@test.com");

  responder = () => ({ ok: true, json: { users: [{ id: "usr_2", email: "b@test.com" }] } });
  const users = await auth.admin.listUsers();
  assert.equal(calls[1].init.method, "GET");
  assert.equal(users.length, 1);

  responder = () => ({ ok: true, json: { success: true } });
  const deleted = await auth.admin.deleteUser("usr_2");
  assert.equal(calls[2].url, "https://test.pgbhub.dev/auth/admin/users/usr_2");
  assert.equal(calls[2].init.method, "DELETE");
  assert.equal(deleted, true);
});

// ─── StorageClient.getFile / getMedia ───────────────────────────────────

test("StorageClient.getFile: GETs /storage/{path} and returns the raw bytes + content-type", async () => {
  const client = makeClient();
  const storage = new StorageClient(client);
  const bytes = new TextEncoder().encode("hello").buffer;
  responder = () => ({ ok: true, arrayBuffer: bytes, headers: { "content-type": "text/plain", etag: '"abc"' } });

  const file = await storage.getFile("/notes/hello.txt");

  assert.equal(calls[0].url, "https://test.pgbhub.dev/storage/notes/hello.txt");
  assert.equal(file.contentType, "text/plain");
  assert.equal(file.etag, '"abc"');
  assert.equal(new TextDecoder().decode(file.data), "hello");
});

test("StorageClient.getMedia: is a thin alias over getFile and does not forward transform params to the server", async () => {
  const client = makeClient();
  const storage = new StorageClient(client);
  responder = () => ({ ok: true, arrayBuffer: new ArrayBuffer(0), headers: { "content-type": "image/png" } });

  await storage.getMedia("/avatars/pic.png", { width: 200, height: 200 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/storage/avatars/pic.png");
  assert.ok(!calls[0].url.includes("width"), "transform params must not be sent — the server does not support them yet");
});

// ─── FunctionsClient.deploy / delete ─────────────────────────────────────

test("FunctionsClient.deploy: POSTs to the functions collection with name in the body (not the URL)", async () => {
  const client = makeClient();
  const functions = new FunctionsClient(client);
  responder = () => ({ ok: true, json: { success: true, function: { name: "send-welcome" } } });

  const fn = await functions.deploy("send-welcome", "export default () => {}", { runtime: "javascript", timeoutMs: 8000 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/functions");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "send-welcome");
  assert.equal(body.code, "export default () => {}");
  assert.equal(body.timeout_ms, 8000);
  assert.equal(fn.name, "send-welcome");
});

test("FunctionsClient.delete: DELETEs the function by name in the URL", async () => {
  const client = makeClient();
  const functions = new FunctionsClient(client);
  responder = () => ({ ok: true, json: { success: true, name: "send-welcome" } });

  const ok = await functions.delete("send-welcome");

  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/functions/send-welcome");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(ok, true);
});

// ─── PGBHubClientCore.createDatabase ──────────────────────────────────────

test("PGBHubClientCore.createDatabase: POSTs /api/v1/databases with the given name and defaults pg_version to 17", async () => {
  const client = makeClient();
  responder = () => ({
    ok: true,
    json: { success: true, database: "newdb", pg_version: "17", user: "u", password: "p", public_host: "h", public_port: 5433, url: "postgres://...", message: "ready" },
  });

  const result = await client.createDatabase("newdb");

  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "newdb");
  assert.equal(body.pg_version, "17");
  assert.equal(result.database, "newdb");
});

test("PGBHubClientCore.createDatabase: surfaces a 403 (project-scoped key) as a clear error", async () => {
  const client = makeClient();
  responder = () => ({ ok: false, status: 403, json: { error: "This API key is scoped to a single project and cannot provision new databases." } });

  await assert.rejects(() => client.createDatabase("newdb"), /scoped to a single project/);
});
