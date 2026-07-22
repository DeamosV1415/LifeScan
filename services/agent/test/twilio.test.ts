import { test } from "node:test";
import assert from "node:assert/strict";
import { createSmsSender } from "../src/twilio.ts";

test("reports not-configured and never throws when creds are missing", async () => {
  const sms = createSmsSender({});
  assert.equal(sms.configured, false);

  const result = await sms.send("+919876543210", "test");
  assert.equal(result.configured, false);
  assert.equal(result.sent, false);
  // With no test-number override, it falls back to the intended recipient.
  assert.equal(result.to, "+919876543210");
});

test("the test-number override wins over the record's contact (trial-account safety)", async () => {
  // configured=false so no network call is made; we only assert routing.
  const sms = createSmsSender({ TWILIO_TEST_TO_NUMBER: "+911112223334" });
  const result = await sms.send("+919876543210", "test");
  assert.equal(result.to, "+911112223334");
});

test("configured requires SID, token and from-number together", () => {
  assert.equal(createSmsSender({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" }).configured, false);
  assert.equal(
    createSmsSender({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" }).configured,
    true,
  );
});
