import { test } from "node:test";
import assert from "node:assert/strict";
import { createSmsSender, formatEmergencySms } from "../src/twilio.ts";

test("reports not-configured and never throws when creds are missing", async () => {
  const sms = createSmsSender({});
  assert.equal(sms.configured, false);

  const result = await sms.send("+919876543210", "test");
  assert.equal(result.configured, false);
  assert.equal(result.sentCount, 0);
  // With no override, it falls back to the intended recipient.
  assert.deepEqual(result.recipients.map((r) => r.to), ["+919876543210"]);
});

test("the test-number override wins over the record's contact (trial-account safety)", async () => {
  // configured=false so no network call is made; we only assert routing.
  const sms = createSmsSender({ TWILIO_TEST_TO_NUMBER: "+911112223334" });
  const result = await sms.send("+919876543210", "test");
  assert.deepEqual(result.recipients.map((r) => r.to), ["+911112223334"]);
});

test("a comma-separated override fans out to every verified number", async () => {
  const sms = createSmsSender({ TWILIO_TEST_TO_NUMBER: "+911112223334, +919998887776 , +14155550100" });
  const result = await sms.send("+919876543210", "test");
  assert.deepEqual(result.recipients.map((r) => r.to), [
    "+911112223334",
    "+919998887776",
    "+14155550100",
  ]);
});

test("formats a prose alert into a scannable header/sentences/footer", () => {
  const out = formatEmergencySms(
    "Ramesh Kumar has been in a road accident.  He is being treated at Gwalior Trauma Centre. Please come to the ER.",
  );
  const lines = out.split("\n");
  assert.equal(lines[0], "🚑 LifeScan · Emergency Alert");
  assert.equal(lines[1], "");
  // Each sentence lands on its own line.
  assert.ok(lines.includes("Ramesh Kumar has been in a road accident."));
  assert.ok(lines.includes("He is being treated at Gwalior Trauma Centre."));
  assert.ok(lines.includes("Please come to the ER."));
  assert.equal(lines[lines.length - 1], "Automated message — please do not reply.");
});

test("configured requires SID, token and from-number together", () => {
  assert.equal(createSmsSender({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" }).configured, false);
  assert.equal(
    createSmsSender({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" }).configured,
    true,
  );
});
