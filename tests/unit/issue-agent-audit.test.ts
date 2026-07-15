import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendIssueAgentAuditRecord } from "../../src/lib/issueAgent/audit.ts";
import { createRecordedTriageRun } from "../../src/lib/issueAgent/recordedTriage.ts";

test("appendIssueAgentAuditRecord writes redacted JSONL under explicit data dir", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "issue-agent-audit-"));
  const run = createRecordedTriageRun({
    issueUrl: "https://github.com/KooshaPari/OmniRoute/issues/42",
    recordedContext: {
      title: "Need fix",
      body: "Authorization: Bearer sk-secret1234567890abcd",
    },
  });

  const result = await appendIssueAgentAuditRecord(run, { dataDir });
  const payload = readFileSync(result.path, "utf8");
  const row = JSON.parse(payload.trim()) as Record<string, unknown>;

  assert.equal(result.path, join(dataDir, "issue-agent", "audit.jsonl"));
  assert.equal(row.runId, run.runId);
  assert.equal(row.repository, "KooshaPari/OmniRoute");
  assert.equal(row.issueNumber, 42);
  assert.equal(row.dryRun, true);
  assert.doesNotMatch(payload, /sk-secret/);
  assert.match(payload, /\[REDACTED\]/);
  assert.equal(row.state, "accepted");
});

test("appendIssueAgentAuditRecord supports explicit terminal lifecycle metadata", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "issue-agent-audit-terminal-"));
  const run = createRecordedTriageRun({
    issueUrl: "https://github.com/KooshaPari/OmniRoute/issues/77",
    recordedContext: {
      title: "Need timing fix",
      body: "timed out",
    },
  });

  await appendIssueAgentAuditRecord(run, { dataDir, state: "running" });
  const terminal = await appendIssueAgentAuditRecord(run, {
    dataDir,
    state: "timed_out",
    terminalState: "timed_out",
    terminalError: "Execution timed out",
    durationMs: 120,
    completionStatus: "timed_out",
  });

  const payload = readFileSync(terminal.path, "utf8").trim().split("\n");
  const last = JSON.parse(payload[payload.length - 1]!) as Record<string, unknown>;

  assert.equal(payload.length, 2);
  assert.equal(last.state, "timed_out");
  assert.equal(last.terminalState, "timed_out");
  assert.equal(last.completionStatus, "timed_out");
  assert.equal(last.durationMs, 120);
  assert.equal(last.terminalError, "Execution timed out");
});
