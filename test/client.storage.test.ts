// Storage: signed URLs (POST /storage/sign), uploads to a signed URL, and
// private buckets (create with a visibility, change visibility with an
// explicit confirmation to go public).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, StorageClient, PGBError } from "../src/client.js";

type FetchCall = { url: string; init: any };

let calls: FetchCall[] = [];
let responder: (call: FetchCall) => { ok: boolean; status?: number; json?: any };
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
      text: async () => JSON.stringify(r.json ?? {}),
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PGBHUB_PROJECT_DOMAIN;
});

function storage(extra: Record<string, unknown> = {}) {
  return new StorageClient(new PGBHubClientCore({ endpoint: "https://acme.pgbhub.app", apiKey: "pgb_sec_test", ...extra }));
}

const body = (i = 0) => JSON.parse(calls[i].init.body);

test("createSignedUrl: POST /storage/sign with the secret key, GET by default", async () => {
  const signed = { url: "https://acme.pgbhub.app/storage/_signed/tok", path: "/storage/_signed/tok", method: "GET", expires_in: 900, expires_at: 1, bucket_visibility: "private" };
  responder = () => ({ ok: true, json: signed });
  const out = await storage().createSignedUrl("receipts", "/2026/inv-1.pdf");
  assert.equal(calls[0].url, "https://acme.pgbhub.app/storage/sign");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pgb_sec_test");
  assert.deepEqual(body(), { bucket: "receipts", path: "2026/inv-1.pdf", method: "GET" });
  assert.equal(out.url, signed.url);
});

test("createSignedUrl: PUT sends expires_in and content_type", async () => {
  await storage().createSignedUrl("uploads", "a.png", { method: "PUT", expiresIn: 600, contentType: "image/png" });
  assert.deepEqual(body(), { bucket: "uploads", path: "a.png", method: "PUT", expires_in: 600, content_type: "image/png" });
});

test("createSignedUrl: refuses contentType on GET and unknown methods without a request", async () => {
  await assert.rejects(storage().createSignedUrl("b", "a", { contentType: "image/png" }), /only to PUT/);
  await assert.rejects(storage().createSignedUrl("b", "a", { method: "DELETE" as any }), /GET" or "PUT/);
  assert.equal(calls.length, 0);
});

test("createSignedUrl: a server refusal is a PGBError with the message", async () => {
  responder = () => ({ ok: false, status: 400, json: { error: "Bucket 'nope' not found." } });
  await assert.rejects(storage().createSignedUrl("nope", "a"), (err: any) => {
    assert.ok(err instanceof PGBError);
    assert.equal(err.status, 400);
    assert.match(err.message, /Bucket 'nope' not found\./);
    return true;
  });
});

test("uploadToSignedUrl: PUTs the bytes with the Content-Type and no API key", async () => {
  responder = () => ({ ok: true, json: { success: true, bucket: "uploads", file_path: "a.png", size_bytes: 3 } });
  const out = await storage().uploadToSignedUrl("https://acme.pgbhub.app/storage/_signed/tok", new Uint8Array([1, 2, 3]), "image/png");
  assert.equal(calls[0].url, "https://acme.pgbhub.app/storage/_signed/tok");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["Content-Type"], "image/png");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(out.size_bytes, 3);
});

test("uploadToSignedUrl: a relative URL is resolved against the endpoint; a refusal throws", async () => {
  responder = () => ({ ok: false, status: 415, json: { error: "This content type can only be uploaded through a signed URL minted for it (content_type)." } });
  await assert.rejects(storage().uploadToSignedUrl("/storage/_signed/tok", "<svg/>", "image/svg+xml"), (err: any) => {
    assert.ok(err instanceof PGBError);
    assert.equal(err.status, 415);
    return true;
  });
  assert.equal(calls[0].url, "https://acme.pgbhub.app/storage/_signed/tok");
});

test("createBucket: visibility defaults to public; the project comes from the endpoint slug", async () => {
  responder = () => ({ ok: true, status: 201, json: { success: true, bucket: "assets", visibility: "public" } });
  await storage().createBucket("assets");
  assert.equal(calls[0].url, "https://acme.pgbhub.app/api/v1/projects/acme/storage/buckets");
  assert.deepEqual(body(), { name: "assets", visibility: "public" });
});

test("createBucket: private, addressed by projectId when configured", async () => {
  await storage({ projectId: "prj_1" }).createBucket("receipts", { visibility: "private" });
  assert.equal(calls[0].url, "https://acme.pgbhub.app/api/v1/projects/prj_1/storage/buckets");
  assert.deepEqual(body(), { name: "receipts", visibility: "private" });
});

test("createBucket: without a project it explains what to configure", async () => {
  const s = new StorageClient(new PGBHubClientCore({ endpoint: "https://console.pgbhub.com", apiKey: "k" }));
  await assert.rejects(s.createBucket("x"), /projectId/);
  assert.equal(calls.length, 0);
});

test("setBucketVisibility: private needs no confirmation", async () => {
  responder = () => ({ ok: true, json: { success: true, bucket: "receipts", visibility: "private", previous_visibility: "public", note: "n" } });
  const out = await storage().setBucketVisibility("receipts", "private");
  assert.equal(calls[0].url, "https://acme.pgbhub.app/api/v1/projects/acme/storage/buckets/receipts/visibility");
  assert.deepEqual(body(), { visibility: "private" });
  assert.equal(out.previous_visibility, "public");
});

test("setBucketVisibility: public is refused without confirmPublic, and nothing is sent", async () => {
  await assert.rejects(storage().setBucketVisibility("receipts", "public"), /confirmPublic: true/);
  await assert.rejects(storage().setBucketVisibility("receipts", "public", { confirmPublic: false }), /confirmPublic/);
  assert.equal(calls.length, 0);
});

test("setBucketVisibility: public with confirmPublic sends confirm_public", async () => {
  await storage().setBucketVisibility("assets", "public", { confirmPublic: true });
  assert.deepEqual(body(), { visibility: "public", confirm_public: true });
});
