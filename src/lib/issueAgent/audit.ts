import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import type { RecordedTriageRun } from "./recordedTriage";
import type { IssueAgentTerminalState } from "@/lib/issueAgent/execution";

export type IssueAgentAuditState =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "budget_stopped";

export interface IssueAgentAuditOptions {
  dataDir?: string;
  now?: Date;
  state?: IssueAgentAuditState;
  terminalState?: IssueAgentTerminalState;
  completionStatus?: string;
  durationMs?: number;
  terminalError?: string;
  error?: string;
}

export interface IssueAgentAuditResult {
  path: string;
}

function defaultDataDir(): string {
  return process.env.DATA_DIR || join(homedir(), ".omniroute");
}

export async function appendIssueAgentAuditRecord(
  run: RecordedTriageRun,
  options: IssueAgentAuditOptions = {}
): Promise<IssueAgentAuditResult> {
  const dataDir = options.dataDir || defaultDataDir();
  const auditDir = join(dataDir, "issue-agent");
  const auditPath = join(auditDir, "audit.jsonl");
  const row = {
    ts: (options.now ?? new Date()).toISOString(),
    state: options.state ?? "accepted",
    runId: run.runId,
    mode: run.mode,
    repository: run.repository,
    issueNumber: run.issueNumber,
    issueUrl: run.issueUrl,
    dryRun: run.dryRun,
    runner: run.runner,
    context: run.context,
    steps: run.steps,
    terminalState: options.terminalState,
    completionStatus: options.completionStatus,
    durationMs: options.durationMs,
    terminalError: options.terminalError,
    error: options.error,
  };

  await mkdir(auditDir, { recursive: true });
  await appendFile(auditPath, `${JSON.stringify(row)}\n`, "utf8");
  return { path: auditPath };
}
