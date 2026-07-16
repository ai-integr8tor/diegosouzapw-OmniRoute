/**
 * Unit tests: OMNIROUTE_SKIP_DNS_WRITE guard on addDNSEntries / removeDNSEntries.
 *
 * When the env flag is set to "1", both functions must return immediately
 * without reading /etc/hosts or spawning any child process.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Import the module under test.
const { addDNSEntries, removeDNSEntries } = await import("../../../src/mitm/dns/dnsConfig.ts");

// ---------------------------------------------------------------------------
// addDNSEntries guard
// ---------------------------------------------------------------------------

test("addDNSEntries: returns early when OMNIROUTE_SKIP_DNS_WRITE=1", async () => {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  process.env.OMNIROUTE_SKIP_DNS_WRITE = "1";
  try {
    const readSpy = test.mock.method(fs, "readFileSync");

    await addDNSEntries(["daily-cloudcode-pa.googleapis.com"], "fake-password");

    // Guard returns before readHostsFile() which calls fs.readFileSync.
    // Filter out any calls that are not from dnsConfig (e.g. test harness reads).
    // The key assertion: the function resolved without error and no /etc/hosts
    // read happened inside the guarded code path.
    assert.equal(
      readSpy.mock.callCount(),
      0,
      "fs.readFileSync must not be called when guard is active"
    );
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
    test.mock.restoreAll();
  }
});

test("addDNSEntries: OMNIROUTE_SKIP_DNS_WRITE=0 does NOT trigger guard", async () => {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  process.env.OMNIROUTE_SKIP_DNS_WRITE = "0";
  try {
    const readSpy = test.mock.method(fs, "readFileSync");

    // With guard OFF, the function reads /etc/hosts (readFileSync is called).
    // We pass a host that likely exists so it skips the exec step.
    await addDNSEntries(["localhost"], "fake-password");

    assert.ok(readSpy.mock.callCount() > 0, "fs.readFileSync should be called when guard is OFF");
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
    test.mock.restoreAll();
  }
});

// ---------------------------------------------------------------------------
// removeDNSEntries guard
// ---------------------------------------------------------------------------

test("removeDNSEntries: returns early when OMNIROUTE_SKIP_DNS_WRITE=1", async () => {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  process.env.OMNIROUTE_SKIP_DNS_WRITE = "1";
  try {
    const readSpy = test.mock.method(fs, "readFileSync");

    await removeDNSEntries(["daily-cloudcode-pa.googleapis.com"], "fake-password");

    assert.equal(
      readSpy.mock.callCount(),
      0,
      "fs.readFileSync must not be called when guard is active"
    );
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
    test.mock.restoreAll();
  }
});

test("removeDNSEntries: OMNIROUTE_SKIP_DNS_WRITE=0 does NOT trigger guard", async () => {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  process.env.OMNIROUTE_SKIP_DNS_WRITE = "0";
  try {
    const readSpy = test.mock.method(fs, "readFileSync");

    // With guard OFF, the function reads /etc/hosts.
    await removeDNSEntries(["localhost"], "fake-password");

    assert.ok(readSpy.mock.callCount() > 0, "fs.readFileSync should be called when guard is OFF");
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
    test.mock.restoreAll();
  }
});

// ---------------------------------------------------------------------------
// Guard value boundary
// ---------------------------------------------------------------------------

test("addDNSEntries: guard does NOT trigger for values other than '1'", async () => {
  const prev = process.env.OMNIROUTE_SKIP_DNS_WRITE;
  process.env.OMNIROUTE_SKIP_DNS_WRITE = "true";
  try {
    const readSpy = test.mock.method(fs, "readFileSync");

    await addDNSEntries(["localhost"], "fake-password");

    assert.ok(readSpy.mock.callCount() > 0, "guard must only trigger for exact value '1'");
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_SKIP_DNS_WRITE;
    else process.env.OMNIROUTE_SKIP_DNS_WRITE = prev;
    test.mock.restoreAll();
  }
});
