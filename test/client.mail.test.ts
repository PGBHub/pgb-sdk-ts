// Mail: reply_to on the wire, message_id (with the mail_id fallback) and
// the typed 503 MAIL_PROVIDER_UNAVAILABLE error.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, MailClient, PGBError, MAIL_PROVIDER_UNAVAILABLE } from "../src/client.js";

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
      headers: new Headers(),
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mail() {
  return new MailClient(new PGBHubClientCore({ endpoint: "https://test.pgbhub.dev", apiKey: "pgb_sec_test" }));
}

test("mail.send: replyTo is sent as reply_to", async () => {
  responder = () => ({ ok: true, json: { success: true, message_id: "m1", mail_id: "m1" } });
  const result = await mail().send({ to: "a@test.com", subject: "hi", text: "body", replyTo: "support@acme.dev" });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.reply_to, "support@acme.dev");
  assert.equal("replyTo" in body, false);
  assert.equal(result.message_id, "m1");
});

test("mail.send: without replyTo no reply_to key is sent", async () => {
  responder = () => ({ ok: true, json: { success: true, message_id: "m1" } });
  await mail().send({ to: "a@test.com", subject: "hi", text: "body" });
  const body = JSON.parse(calls[0].init.body);
  assert.equal("reply_to" in body, false);
  assert.equal(body.to, "a@test.com");
});

test("mail.send: message_id falls back to mail_id from an older server", async () => {
  responder = () => ({ ok: true, json: { success: true, mail_id: "old1" } });
  const result = await mail().send({ to: "a@test.com", subject: "hi", text: "body" });
  assert.equal(result.message_id, "old1");
  assert.equal(result.mail_id, "old1");
});

test("mail.send: multi-recipient results carry the mail_id fallback", async () => {
  responder = () => ({ ok: true, json: { success: true, mail_id: "old2" } });
  const result = await mail().send({ to: ["a@test.com", "b@test.com"], subject: "hi", text: "body" });
  assert.deepEqual(result.results?.map((r) => r.message_id), ["old2", "old2"]);
});

test("mail.send: 503 MAIL_PROVIDER_UNAVAILABLE throws a PGBError with the code", async () => {
  responder = () => ({ ok: false, status: 503, json: { error: "Email dispatch failed: no provider", code: "MAIL_PROVIDER_UNAVAILABLE" } });
  await assert.rejects(mail().send({ to: "a@test.com", subject: "hi", text: "body" }), (err: any) => {
    assert.ok(err instanceof PGBError);
    assert.equal(err.status, 503);
    assert.equal(err.code, MAIL_PROVIDER_UNAVAILABLE);
    assert.equal((err.body as any).code, "MAIL_PROVIDER_UNAVAILABLE");
    assert.match(err.message, /no provider/);
    return true;
  });
});

test("mail.send: 400 for a bad reply_to keeps the server message", async () => {
  responder = () => ({ ok: false, status: 400, json: { error: "Invalid reply_to email address: 'a@b.co, c@d.co'" } });
  await assert.rejects(mail().send({ to: "a@test.com", subject: "hi", text: "b", replyTo: "a@b.co, c@d.co" }), (err: any) => {
    assert.ok(err instanceof PGBError);
    assert.equal(err.status, 400);
    assert.equal(err.code, undefined);
    assert.match(err.message, /Invalid reply_to/);
    return true;
  });
});

test("mail.send: multi-recipient failure records the error code per recipient", async () => {
  responder = () => ({ ok: false, status: 503, json: { error: "down", code: "MAIL_PROVIDER_UNAVAILABLE" } });
  const result = await mail().send({ to: ["a@test.com", "b@test.com"], subject: "hi", text: "body" });
  assert.equal(result.success, false);
  assert.deepEqual(result.results?.map((r) => r.code), ["MAIL_PROVIDER_UNAVAILABLE", "MAIL_PROVIDER_UNAVAILABLE"]);
});
