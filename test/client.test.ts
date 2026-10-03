// Regression tests for the Round 0 bug fixes in src/client.ts.
// These import the real compiled client (not a reimplementation) and
// mock global.fetch to pin the exact HTTP method/path/body each client
// method sends, matching the real backend route handlers in pgb-cloud.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, AuthClient, StorageClient, MailClient } from "../src/client.js";

type FetchCall = { url: string; init: any };

let calls: FetchCall[] = [];
let responder: (call: FetchCall) => { ok: boolean; status?: number; json?: any; text?: string };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responder = () => ({ ok: true, json: {} });
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responder({ url, init });
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? "OK" : "Error",
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient() {
  return new PGBHubClientCore({ endpoint: "https://test.pgbhub.dev", apiKey: "pgb_sec_test", database: "appdb" });
}

test("MailClient.send: single string `to` sends one request with `to` as a plain string", async () => {
  const client = makeClient();
  const mail = new MailClient(client);
  responder = () => ({ ok: true, json: { success: true, message_id: "m1" } });

  const result = await mail.send({ to: "user@test.com", subject: "hi", text: "body" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/mail/send");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(typeof body.to, "string");
  assert.equal(body.to, "user@test.com");
  assert.equal(result.success, true);
  assert.equal(result.message_id, "m1");
});

test("MailClient.send: single-element array `to` is unwrapped to a plain string", async () => {
  const client = makeClient();
  const mail = new MailClient(client);
  responder = () => ({ ok: true, json: { success: true } });

  await mail.send({ to: ["user@test.com"], subject: "hi" });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "user@test.com");
});

test("MailClient.send: multi-recipient array sends one request per recipient and aggregates results", async () => {
  const client = makeClient();
  const mail = new MailClient(client);
  responder = ({ init }) => {
    const body = JSON.parse(init.body);
    return { ok: true, json: { success: true, message_id: `id-${body.to}` } };
  };

  const result = await mail.send({ to: ["a@test.com", "b@test.com"], subject: "hi" });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const body = JSON.parse(call.init.body);
    assert.equal(typeof body.to, "string", "each request's `to` must be a plain string, not an array");
  }
  assert.equal(result.success, true);
  assert.equal(result.results?.length, 2);
  assert.deepEqual(
    result.results?.map((r) => r.to).sort(),
    ["a@test.com", "b@test.com"]
  );
});

test("StorageClient.list: reads `data.objects`, not `data.files`", async () => {
  const client = makeClient();
  const storage = new StorageClient(client);
  responder = () => ({
    ok: true,
    json: { objects: [{ path: "avatars/pic.png", size: 10, updated_at: "now" }], count: 1 },
  });

  const files = await storage.list("avatars");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/storage/list?prefix=avatars");
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "avatars/pic.png");
});

test("StorageClient.list: falls back to [] (not throwing) when the response has neither field", async () => {
  const client = makeClient();
  const storage = new StorageClient(client);
  responder = () => ({ ok: true, json: { files: [{ path: "should-be-ignored" }] } });

  const files = await storage.list();
  assert.deepEqual(files, [], "must not read the old, wrong `files` field");
});

test("StorageClient.delete: POSTs to /storage/delete with a JSON body, not DELETE /storage/{path}", async () => {
  const client = makeClient();
  const storage = new StorageClient(client);
  responder = () => ({ ok: true });

  const ok = await storage.delete("/avatars/pic.png");

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/storage/delete");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.path, "avatars/pic.png");
});

test("AuthClient: every network method throws a clear 'not implemented' error without calling fetch", async () => {
  const client = makeClient();
  const auth = new AuthClient(client);

  await assert.rejects(() => auth.signUp({ email: "a@test.com" }), /not implemented/i);
  await assert.rejects(() => auth.signIn({ email: "a@test.com" }), /not implemented/i);
  await assert.rejects(() => auth.signOut(), /not implemented/i);
  await assert.rejects(() => auth.getUser(), /not implemented/i);
  await assert.rejects(() => auth.verifyOtp({ email: "a@test.com", token: "123" }), /not implemented/i);
  await assert.rejects(() => auth.sendMagicLink({ email: "a@test.com" }), /not implemented/i);

  assert.equal(calls.length, 0, "no AuthClient method should call a nonexistent backend route");
});

test("AuthClient: getSession/setSession remain functional local state (no network call)", () => {
  const client = makeClient();
  const auth = new AuthClient(client);

  assert.equal(auth.getSession(), null);
  const session = { access_token: "t", refresh_token: "r" };
  auth.setSession(session);
  assert.deepEqual(auth.getSession(), session);
  assert.equal(calls.length, 0);
});
