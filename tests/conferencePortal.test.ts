import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { enqueueConference, jobPath, readJson, writeJson, conferenceServiceDir, publishConferenceRecord, matchCompany, workerAuthorized, boundedJson, type PortalJob } from "../lib/conferencePortal";
import { loadCallRecord, loadSymbolCalls, type CallRecord } from "../lib/callsArchive";
import { unlockPortal, portalUser, PORTAL_COOKIE } from "../lib/conferencePortalAuth";

test("durable conference submission, private access, safe mapping and publication survive data refresh", async () => {
  const original = process.cwd(), dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-portal-"));
  process.chdir(dir);
  try {
    const url = "https://event.webcasts.com/viewer/agenda.jsp?ei=1769358&tp_key=test";
    const results = await Promise.all([enqueueConference(url,"owner"), enqueueConference(url,"owner")]);
    assert.equal(results[0].id, results[1].id);
    const job = (await readJson<PortalJob>(jobPath("1769358")))!;
    assert.equal(job.state, "queued");
    await assert.rejects(enqueueConference("https://event.webcasts.com@127.0.0.1/?ei=1", "owner"));
    await assert.rejects(enqueueConference("https://user:pass@event.webcasts.com/?ei=1", "owner"));
    assert.throws(() => jobPath("../secret"));
    assert.equal(await workerAuthorized("Bearer bad"), false);
    await writeJson(path.join(conferenceServiceDir(), "worker-key.json"), { token: "worker-test-token" });
    assert.equal(await workerAuthorized("Bearer worker-test-token"), true);
    assert.equal(await workerAuthorized("Bearer worker-test-tokem"), false);
    await writeJson(path.join(conferenceServiceDir(), "access.json"), { codeHash: createHash("sha256").update("test-access").digest("hex"), sessionKey: "unit-test-key" });
    assert.equal(await unlockPortal("wrong", "test"), null);
    const token = await unlockPortal("test-access", "test"); assert.ok(token);
    assert.equal(await portalUser(new Request("https://tape.test", { headers: { cookie: `${PORTAL_COOKIE}=${token}` } })), "conference-owner");
    assert.equal(await portalUser(new Request("https://tape.test", { headers: { cookie: `${PORTAL_COOKIE}=${token}x` } })), null);
    await assert.rejects(boundedJson(new Request("https://tape.test", { method: "POST", body: '"oversized"' }), 3));
    const stocks = [{ symbol: "FRPT", name: "Freshpet, Inc." }];
    assert.equal(matchCompany("Freshpet", stocks), "FRPT");
    assert.equal(matchCompany("Freshpet", [...stocks, { symbol: "FAKE", name: "Freshpet PLC" }]), undefined);
    const talk = { id: "1773017", name: "Freshpet", audio: true, transcript: true, summary: true };
    job.talks = [talk];
    const record = { symbol: "WRONG", fiscalPeriod: "conference-1769358-1773017", callDate: "2026-09-10", eventType: "conference", url: "https://event.webcasts.com/starthere.jsp?ei=1773017", title: "Freshpet", source: "Conference", transcript: { text: "Management described manufacturing productivity. ".repeat(8), chars: 1 }, digest: { tldr: "Factory productivity matters.", kpis: ["More efficient production.", "Lower capital intensity."], guidance: { action: "none", detail: "" } }, fetchedAt: "2026-09-10T12:00:00Z", digestedAt: "2026-09-10T12:00:00Z" } as CallRecord;
    assert.equal(await publishConferenceRecord(job, talk, record, stocks), true);
    assert.equal((await loadCallRecord("FRPT",record.fiscalPeriod))?.symbol, "FRPT");
    assert.equal((await loadSymbolCalls("FRPT")).length, 1);
    await fs.mkdir("data/calls", { recursive: true });
    await fs.rm("data/calls", { recursive: true }); // Simulate the hourly replace of only the data tree.
    assert.equal((await loadSymbolCalls("FRPT")).length, 1);
    const older = { ...record, digestedAt: "2026-09-09T12:00:00Z", digest: { ...record.digest!, tldr: "Stale summary" } };
    await publishConferenceRecord(job, talk, older, stocks);
    assert.equal((await loadCallRecord("FRPT",record.fiscalPeriod))?.digest?.tldr, "Factory productivity matters.");
    await assert.rejects(publishConferenceRecord(job, talk, { ...record, fiscalPeriod: "2026-Q3" }, stocks));
  } finally { process.chdir(original); await fs.rm(dir, { recursive: true, force: true }); }
});
