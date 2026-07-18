import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../../src/lib/db/migrations/121_antigravity_client_profile.sql"),
  "utf8"
);

type ProviderRow = {
  id: string;
  provider: string;
  provider_specific_data: string | null;
};

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE provider_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_specific_data TEXT
    );
  `);
  return db;
}

function insertRow(db: Database.Database, row: ProviderRow): void {
  db.prepare(
    "INSERT INTO provider_connections (id, provider, provider_specific_data) VALUES (?, ?, ?)"
  ).run(row.id, row.provider, row.provider_specific_data);
}

function readRaw(db: Database.Database, id: string): string | null {
  return (
    db.prepare("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as {
      provider_specific_data: string | null;
    }
  ).provider_specific_data;
}

function readProfile(db: Database.Database, id: string): unknown {
  const raw = readRaw(db, id);
  if (raw === null) return null;
  return (JSON.parse(raw) as Record<string, unknown>).clientProfile;
}

test("121 migrates only Antigravity and AGY legacy client profiles to CLI", () => {
  const db = createDb();
  const rows: ProviderRow[] = [
    {
      id: "antigravity-harness",
      provider: "antigravity",
      provider_specific_data: JSON.stringify({ clientProfile: "harness", keep: true }),
    },
    {
      id: "antigravity-sdk",
      provider: "antigravity",
      provider_specific_data: JSON.stringify({ clientProfile: " SDK ", keep: true }),
    },
    {
      id: "agy-harness",
      provider: "agy",
      provider_specific_data: JSON.stringify({ clientProfile: "HARNESS" }),
    },
    {
      id: "agy-sdk",
      provider: "agy",
      provider_specific_data: JSON.stringify({ clientProfile: "sdk" }),
    },
    {
      id: "other-harness",
      provider: "github",
      provider_specific_data: JSON.stringify({ clientProfile: "harness" }),
    },
  ];
  rows.forEach((row) => insertRow(db, row));

  db.exec(MIGRATION);

  assert.equal(readProfile(db, "antigravity-harness"), "cli");
  assert.equal(readProfile(db, "antigravity-sdk"), "cli");
  assert.equal(readProfile(db, "agy-harness"), "cli");
  assert.equal(readProfile(db, "agy-sdk"), "cli");
  assert.equal(readProfile(db, "other-harness"), "harness");
  assert.deepEqual(JSON.parse(readRaw(db, "antigravity-harness")!), {
    clientProfile: "cli",
    keep: true,
  });
  db.close();
});

test("121 preserves canonical, absent, null, malformed, and non-string values", () => {
  const db = createDb();
  const rows: ProviderRow[] = [
    ["ide", JSON.stringify({ clientProfile: "ide" })],
    ["cli", JSON.stringify({ clientProfile: "cli" })],
    ["missing", JSON.stringify({ keep: true })],
    ["json-null", JSON.stringify({ clientProfile: null })],
    ["number", JSON.stringify({ clientProfile: 7 })],
    ["malformed", "{not-json"],
    ["sql-null", null],
  ].map(([id, providerSpecificData]) => ({
    id: String(id),
    provider: "antigravity",
    provider_specific_data: providerSpecificData as string | null,
  }));
  rows.forEach((row) => insertRow(db, row));
  const before = new Map(rows.map((row) => [row.id, row.provider_specific_data]));

  db.exec(MIGRATION);

  for (const row of rows) {
    assert.equal(readRaw(db, row.id), before.get(row.id));
  }
  db.close();
});

test("121 is idempotent", () => {
  const db = createDb();
  insertRow(db, {
    id: "legacy",
    provider: "antigravity",
    provider_specific_data: JSON.stringify({ clientProfile: "sdk", keep: "value" }),
  });

  db.exec(MIGRATION);
  const afterFirst = readRaw(db, "legacy");
  db.exec(MIGRATION);

  assert.equal(readRaw(db, "legacy"), afterFirst);
  assert.equal(readProfile(db, "legacy"), "cli");
  db.close();
});
