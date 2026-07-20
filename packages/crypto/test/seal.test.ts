import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, generateDek } from "../src/aes.ts";
import { fromHex, toHex } from "../src/hex.ts";
import { openRecord, sealRecord } from "../src/index.ts";

/** The seeded demo patient. Kept realistic so the tests exercise real sizes. */
const RECORD = {
  name: "Ramesh Kumar",
  dob: "1989-03-14",
  bloodGroup: "O+",
  conditions: ["Type 2 diabetes mellitus", "Atrial fibrillation"],
  medications: [
    { name: "Warfarin", dose: "5 mg", frequency: "once daily" },
    { name: "Metformin", dose: "500 mg", frequency: "twice daily" },
  ],
  allergies: [{ substance: "Penicillin", reaction: "Anaphylaxis", severity: "severe" }],
  implants: [{ type: "Pacemaker", model: "Medtronic Azure XT DR", implanted: "2021-06-02" }],
  emergencyContacts: [{ name: "Sunita Kumar", relation: "spouse", phone: "+919876543210" }],
  insurance: { provider: "Star Health", policyNo: "SH-4471-99213" },
};

test("AES round-trips a string", async () => {
  const dek = generateDek();
  const payload = await encrypt(dek, "GCS 9, BP 90/60");
  assert.equal(await decrypt(dek, payload), "GCS 9, BP 90/60");
});

test("AES produces a different ciphertext each time (fresh IV)", async () => {
  const dek = generateDek();
  const a = await encrypt(dek, "same plaintext");
  const b = await encrypt(dek, "same plaintext");
  assert.notDeepEqual(a, b);
});

test("AES rejects a tampered ciphertext rather than returning garbage", async () => {
  const dek = generateDek();
  const payload = await encrypt(dek, "Allergy: Penicillin");

  payload[payload.length - 1] ^= 0xff;

  await assert.rejects(() => decrypt(dek, payload));
});

test("AES rejects the wrong key", async () => {
  const payload = await encrypt(generateDek(), "Allergy: Penicillin");
  await assert.rejects(() => decrypt(generateDek(), payload));
});

test("AES rejects a truncated payload", async () => {
  const dek = generateDek();
  await assert.rejects(() => decrypt(dek, new Uint8Array(5)), /too short/);
});

test("AES rejects a key of the wrong size", async () => {
  await assert.rejects(() => encrypt(new Uint8Array(16), "x"), /32 bytes/);
});

test("seal → any 2 of 3 guardian shares → open returns the original record", async () => {
  // This is the end-to-end property the entire break-glass model rests on.
  const sealed = await sealRecord(RECORD);

  assert.equal(sealed.shares.length, 3);

  for (const [i, j] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    const opened = await openRecord<typeof RECORD>(sealed.ciphertext, [
      sealed.shares[i],
      sealed.shares[j],
    ]);
    assert.deepEqual(opened, RECORD, `guardians ${i}+${j} failed`);
  }
});

test("one guardian share alone cannot open a record", async () => {
  const sealed = await sealRecord(RECORD);
  await assert.rejects(
    () => openRecord(sealed.ciphertext, [sealed.shares[0]]),
    /need 2 shares/,
  );
});

test("shares from a different patient's seal do not open this record", async () => {
  const mine = await sealRecord(RECORD);
  const theirs = await sealRecord({ name: "Someone Else" });

  await assert.rejects(() =>
    openRecord(mine.ciphertext, [theirs.shares[0], theirs.shares[1]]),
  );
});

test("the ciphertext does not contain the plaintext", async () => {
  const sealed = await sealRecord(RECORD);
  const asText = Buffer.from(fromHex(sealed.ciphertext)).toString("latin1");

  for (const secret of ["Ramesh", "Penicillin", "Warfarin", "Pacemaker"]) {
    assert.ok(!asText.includes(secret), `plaintext "${secret}" leaked into ciphertext`);
  }
});

test("hex round-trips and rejects malformed input", () => {
  const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0xa5]);
  assert.equal(toHex(bytes), "000fffa5");
  assert.deepEqual(fromHex("000fffa5"), bytes);
  assert.deepEqual(fromHex("0x000fffa5"), bytes);

  assert.throws(() => fromHex("abc"), /odd-length/);
  assert.throws(() => fromHex("zz"), /non-hex/);
});
