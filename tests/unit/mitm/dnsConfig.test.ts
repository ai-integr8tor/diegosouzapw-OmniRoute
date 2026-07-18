/**
 * Unit tests: OMNIROUTE_SKIP_DNS_WRITE guard on addDNSEntries / removeDNSEntries.
 *
 * All tests mock fs.readFileSync to avoid real /etc/hosts access.
 * Tests that proceed past the guard use a hosts content with no
 * matching entries so the functions return early before attempting
 * any child-process execution (no sudo calls).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { addDNSEntries, removeDNSEntries } = await import(
  "../../../src/mitm/dns/dnsConfig.ts"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Hosts content that already contains all test hostnames.
// When guard is OFF, functions find entries already present
// and skip the exec step — no real child-process calls.
const HOSTS_WITH_ENTRIES =
  "127.0.0.1 localhost\n" +
  "::1 localhost\n" +
  "127.0.0.1 nonexistent.example.com\n" +
  "::1 nonexistent.example.com\n";

function guardEnv(value: string | undefined): () => void {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  if (value === undefined) {
    delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
  } else {
    process.env.OMNIROUTE_SKIP_DNS_WRITE = value;
  }
  return () => {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
  };
}

function mockFs(
  t: typeof test,
  content = HOSTS_WITH_ENTRIES,
): { readMock: ReturnType<typeof t.mock.method> } {
  const readMock = t.mock.method(fs, "readFileSync", () => content);
  return { readMock };
}

// ---------------------------------------------------------------------------
// addDNSEntries guard
// ---------------------------------------------------------------------------

test("addDNSEntries: returns early when OMNIROUTE_SKIP_DNS_WRITE=1", async (t) => {
  const restore = guardEnv("1");
  try {
    const { readMock } = mockFs(t);
    await addDNSEntries(["test-host.example.com"], "fake-pw");
    assert.equal(readMock.mock.callCount(), 0);
  } finally {
    restore();
  }
});

test("addDNSEntries: proceeds when env var is unset", async (t) => {
  const restore = guardEnv(undefined);
  try {
    const { readMock } = mockFs(t);
    await addDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});

test("addDNSEntries: proceeds when OMNIROUTE_SKIP_DNS_WRITE=0", async (t) => {
  const restore = guardEnv("0");
  try {
    const { readMock } = mockFs(t);
    await addDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});

test("addDNSEntries: guard does NOT trigger for value 'true'", async (t) => {
  const restore = guardEnv("true");
  try {
    const { readMock } = mockFs(t);
    await addDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// removeDNSEntries guard
// ---------------------------------------------------------------------------

test("removeDNSEntries: returns early when OMNIROUTE_SKIP_DNS_WRITE=1", async (t) => {
  const restore = guardEnv("1");
  try {
    const { readMock } = mockFs(t);
    await removeDNSEntries(["test-host.example.com"], "fake-pw");
    assert.equal(readMock.mock.callCount(), 0);
  } finally {
    restore();
  }
});

test("removeDNSEntries: proceeds when env var is unset", async (t) => {
  const restore = guardEnv(undefined);
  try {
    const { readMock } = mockFs(t);
    await removeDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});

test("removeDNSEntries: proceeds when OMNIROUTE_SKIP_DNS_WRITE=0", async (t) => {
  const restore = guardEnv("0");
  try {
    const { readMock } = mockFs(t);
    await removeDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});

test("removeDNSEntries: guard does NOT trigger for value 'true'", async (t) => {
  const restore = guardEnv("true");
  try {
    const { readMock } = mockFs(t);
    await removeDNSEntries(["nonexistent.example.com"], "fake-pw");
    assert.ok(readMock.mock.callCount() > 0);
  } finally {
    restore();
  }
});
