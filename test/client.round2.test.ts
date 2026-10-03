// Regression tests for Round 2: CronClient, JobsClient, QueuesClient,
// RealtimeClient.broadcast. These import the real compiled client and
// mock global.fetch to pin the exact HTTP method/path/body each method
// sends, matching the real backend route handlers in pgb-cloud.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGBHubClientCore, CronClient, JobsClient, QueuesClient, RealtimeClient } from "../src/client.js";

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
      json: async () => r.json ?? {},
      text: async () => JSON.stringify(r.json ?? {}),
    } as any;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient(extra: Record<string, unknown> = {}) {
  return new PGBHubClientCore({ endpoint: "https://test.pgbhub.dev", apiKey: "pgb_sec_test", database: "appdb", ...extra });
}

// ─── CronClient ─────────────────────────────────────────────────────────

test("CronClient.create: POSTs to the crons collection with target_type/target_config in the body", async () => {
  const client = makeClient();
  const cron = new CronClient(client);
  responder = () => ({ ok: true, status: 201, json: { id: "cron_1", name: "nightly" } });

  await cron.create("nightly", "0 0 * * *", "function", { function_name: "cleanup" }, { timeoutSeconds: 60 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.target_type, "function");
  assert.deepEqual(body.target_config, { function_name: "cleanup" });
  assert.equal(body.timeout_seconds, 60);
});

test("CronClient.list: reads the `crons` field", async () => {
  const client = makeClient();
  const cron = new CronClient(client);
  responder = () => ({ ok: true, json: { crons: [{ id: "cron_1" }], total: 1 } });

  const jobs = await cron.list();
  assert.equal(jobs.length, 1);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons");
});

test("CronClient.toggle/run/delete: hit the right sub-paths with the right methods", async () => {
  const client = makeClient();
  const cron = new CronClient(client);
  responder = () => ({ ok: true, json: {} });

  await cron.toggle("cron_1", false);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons/cron_1/toggle");
  assert.equal(JSON.parse(calls[0].init.body).enabled, false);

  await cron.run("cron_1");
  assert.equal(calls[1].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons/cron_1/run");
  assert.equal(calls[1].init.method, "POST");

  await cron.delete("cron_1");
  assert.equal(calls[2].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons/cron_1");
  assert.equal(calls[2].init.method, "DELETE");
});

test("CronClient.listRuns: passes limit as a query param and reads `runs`", async () => {
  const client = makeClient();
  const cron = new CronClient(client);
  responder = () => ({ ok: true, json: { runs: [{ id: "run_1" }], total: 1 } });

  const runs = await cron.listRuns("cron_1", 10);
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/crons/cron_1/runs?limit=10");
  assert.equal(runs.length, 1);
});

// ─── JobsClient ─────────────────────────────────────────────────────────

test("JobsClient.enqueue: POSTs job_type/target_type/target_config and unwraps `job`", async () => {
  const client = makeClient();
  const jobs = new JobsClient(client);
  responder = () => ({ ok: true, status: 201, json: { success: true, job: { id: 1, status: "pending" } } });

  const job = await jobs.enqueue("send-report", "sql", { sql: "select 1" }, { maxAttempts: 3 });

  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/jobs");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.job_type, "send-report");
  assert.equal(body.target_type, "sql");
  assert.equal(body.max_attempts, 3);
  assert.equal(job.id, 1);
});

test("JobsClient.get: returns null on 404 instead of throwing", async () => {
  const client = makeClient();
  const jobs = new JobsClient(client);
  responder = () => ({ ok: false, status: 404, json: { error: "Job not found" } });

  const job = await jobs.get(999);
  assert.equal(job, null);
});

test("JobsClient.list: sends status/limit as query params", async () => {
  const client = makeClient();
  const jobs = new JobsClient(client);
  responder = () => ({ ok: true, json: { success: true, jobs: [], total: 0 } });

  await jobs.list({ status: "failed", limit: 5 });
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/databases/appdb/jobs?status=failed&limit=5");
});

test("JobsClient.cancel: returns false on 409 instead of throwing", async () => {
  const client = makeClient();
  const jobs = new JobsClient(client);
  responder = () => ({ ok: false, status: 409, json: { error: "Job cannot be cancelled" } });

  const cancelled = await jobs.cancel(1);
  assert.equal(cancelled, false);
});

// ─── QueuesClient ───────────────────────────────────────────────────────

test("QueuesClient: throws a clear error when no projectId is configured", async () => {
  const client = makeClient();
  const queues = new QueuesClient(client);

  await assert.rejects(() => queues.send("my-queue", { hello: "world" }), /requires a projectId/i);
});

test("QueuesClient.send: hits the project-scoped URL and unwraps `message`", async () => {
  const client = makeClient({ projectId: "prj_1" });
  const queues = new QueuesClient(client);
  responder = () => ({ ok: true, json: { ok: true, message: { message_id: "msg_1", queue_name: "my-queue", status: "sent", deduplicated: false } } });

  const msg = await queues.send("my-queue", { hello: "world" }, { delaySeconds: 5 });

  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/projects/prj_1/queues/my-queue/send");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.payload, { hello: "world" });
  assert.equal(body.delay_seconds, 5);
  assert.equal(msg.message_id, "msg_1");
});

test("QueuesClient.receive/ack/nack: hit the right sub-paths", async () => {
  const client = makeClient({ projectId: "prj_1" });
  const queues = new QueuesClient(client);

  responder = () => ({ ok: true, json: { ok: true, count: 1, messages: [{ message_id: "msg_1", payload: {} }] } });
  const msgs = await queues.receive("my-queue", { maxMessages: 1 });
  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/projects/prj_1/queues/my-queue/receive");
  assert.equal(msgs.length, 1);

  responder = () => ({ ok: true, json: { ok: true } });
  await queues.ack("my-queue", "msg_1");
  assert.equal(calls[1].url, "https://test.pgbhub.dev/api/v1/projects/prj_1/queues/my-queue/ack");
  assert.equal(JSON.parse(calls[1].init.body).message_id, "msg_1");

  await queues.nack("my-queue", "msg_1", "boom");
  assert.equal(calls[2].url, "https://test.pgbhub.dev/api/v1/projects/prj_1/queues/my-queue/nack");
  assert.equal(JSON.parse(calls[2].init.body).error, "boom");
});

// ─── RealtimeClient ──────────────────────────────────────────────────────

test("RealtimeClient.broadcast: POSTs to the channel's broadcast endpoint", async () => {
  const client = makeClient();
  const realtime = new RealtimeClient(client);
  responder = () => ({ ok: true, json: { ok: true, broadcast: { delivered_to: 2 } } });

  const result = await realtime.broadcast("general", { text: "hi" }, { event: "chat" });

  assert.equal(calls[0].url, "https://test.pgbhub.dev/api/v1/realtime/channels/general/broadcast");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event, "chat");
  assert.deepEqual(body.payload, { text: "hi" });
  assert.equal(result.broadcast.delivered_to, 2);
});
