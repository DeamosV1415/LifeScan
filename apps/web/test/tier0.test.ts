import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTier0, buildTier0, TIER0_VERSION } from "../lib/tier0.ts";

test("round-trips a full record", () => {
  const input = {
    name: "Ramesh Kumar",
    bloodGroup: "O+",
    allergies: ["Penicillin", "Sulfa"],
    flags: ["PACEMAKER", "ANTICOAGULANT"],
    emergencyContact: "+91 98765 43210",
  };

  const parsed = parseTier0("#" + buildTier0(input));

  assert.equal(parsed.valid, true);
  assert.equal(parsed.name, input.name);
  assert.equal(parsed.bloodGroup, input.bloodGroup);
  assert.deepEqual(parsed.allergies, input.allergies);
  assert.deepEqual(parsed.flags, input.flags);
  assert.equal(parsed.emergencyContact, input.emergencyContact);
});

test("parses the exact fragment printed in HARDWARE_SPEC.md", () => {
  // If this test breaks, tags already written in the field stop working.
  const fragment =
    "#0|1|Ramesh%20Kumar|O+|Penicillin,Sulfa|PACEMAKER|+919876543210";
  const parsed = parseTier0(fragment);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.name, "Ramesh Kumar");
  assert.equal(parsed.bloodGroup, "O+");
  assert.deepEqual(parsed.allergies, ["Penicillin", "Sulfa"]);
  assert.equal(parsed.emergencyContact, "+919876543210");
});

test("treats empty markers as absent, never as 'none'", () => {
  const parsed = parseTier0(`#0|${TIER0_VERSION}|Asha|B-|-|-|-`);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.name, "Asha");
  // An allergy list that is absent must be empty so the UI can say
  // "NOT RECORDED" rather than implying the patient has no allergies.
  assert.deepEqual(parsed.allergies, []);
  assert.deepEqual(parsed.flags, []);
  assert.equal(parsed.emergencyContact, "");
});

test("rejects an unknown format marker", () => {
  const parsed = parseTier0("#9|1|X|O+|-|-|-");
  assert.equal(parsed.valid, false);
  assert.match(parsed.error ?? "", /format/i);
});

test("rejects a future version rather than mis-reading fields", () => {
  const parsed = parseTier0("#0|99|X|O+|-|-|-");
  assert.equal(parsed.valid, false);
  assert.match(parsed.error ?? "", /version/i);
});

test("handles an empty fragment", () => {
  const parsed = parseTier0("");
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.allergies, []);
});

test("survives malformed percent-encoding without throwing", () => {
  const parsed = parseTier0(`#0|${TIER0_VERSION}|Bad%ZZName|A+|-|-|-`);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.name, "Bad%ZZName");
});

test("tolerates a truncated fragment", () => {
  // A partially-written tag must degrade, not crash.
  const parsed = parseTier0(`#0|${TIER0_VERSION}|Ramesh|O+`);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.bloodGroup, "O+");
  assert.deepEqual(parsed.allergies, []);
  assert.equal(parsed.emergencyContact, "");
});

test("stays within the 220-character URL budget for a realistic record", () => {
  const fragment = buildTier0({
    name: "Lakshmi Venkataraman",
    bloodGroup: "AB-",
    allergies: ["Penicillin", "Sulfonamides", "Latex"],
    flags: ["PACEMAKER", "ANTICOAGULANT", "INSULIN"],
    emergencyContact: "+91 98765 43210",
  });

  const url = `https://lifescan.app/s/demo01#${fragment}`;
  assert.ok(
    url.length <= 220,
    `URL is ${url.length} chars; NTAG budget in HARDWARE_SPEC.md is 220`,
  );
});
