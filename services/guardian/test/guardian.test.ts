import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { challengeMessage } from "../src/chain.ts";
import { createGuardianServer } from "../src/server.ts";
import { createNonceStore, createShareStore } from "../src/store.ts";
import { openRecord, sealRecord } from "../../../packages/crypto/src/index.ts";

const PATIENT = keccak256(toHex("patient:ramesh"));

// Well-known Hardhat test keys. Never used outside tests.
const DOCTOR = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const IMPOSTOR = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

/** A chain whose verdict the test controls, so refusal paths are deterministic. */
function fakeChain(verdict: { permitted: boolean }) {
  return {
    isReleasePermitted: async () => verdict.permitted,
    isFrozen: async () => !verdict.permitted,
    blockNumber: async () => 1n,
  };
}

const verdict = { permitted: true };
let baseUrl: string;
let server: ReturnType<typeof createGuardianServer>;
let storeFile: string;

before(async () => {
  storeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guardian-")), "shares.json");

  server = createGuardianServer({
    id: "test",
    chain: fakeChain(verdict),
    shares: createShareStore(storeFile),
    nonces: createNonceStore(),
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
  verdict.permitted = true;
});

async function challenge(): Promise<string> {
  const res = await fetch(`${baseUrl}/challenge`);
  return (await res.json()).nonce;
}

async function requestRelease(options: {
  patientHash?: string;
  account?: typeof DOCTOR;
  nonce?: string;
  signWith?: typeof DOCTOR;
}) {
  const patientHash = options.patientHash ?? PATIENT;
  const account = options.account ?? DOCTOR;
  const nonce = options.nonce ?? (await challenge());
  const signer = options.signWith ?? account;

  const signature = await signer.signMessage({
    message: challengeMessage(patientHash, nonce),
  });

  const res = await fetch(`${baseUrl}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patientHash, provider: account.address, nonce, signature }),
  });

  return { status: res.status, body: await res.json() };
}

test("reports health", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
});

test("issues unique single-use challenges", async () => {
  const a = await challenge();
  const b = await challenge();
  assert.notEqual(a, b);
});

test("accepts a share and refuses to overwrite it", async () => {
  const store = async (share: string) =>
    fetch(`${baseUrl}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientHash: PATIENT, share }),
    });

  assert.equal((await store("aabbcc")).status, 201);

  // Overwriting would silently invalidate the other Guardians' shares.
  assert.equal((await store("ddeeff")).status, 409);
});

test("rejects a malformed patient hash", async () => {
  const res = await fetch(`${baseUrl}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patientHash: "nope", share: "aabb" }),
  });
  assert.equal(res.status, 400);
});

test("releases a share when the chain permits it", async () => {
  const { status, body } = await requestRelease({});

  assert.equal(status, 200);
  assert.equal(body.released, true);
  assert.equal(body.share, "aabbcc");
});

test("REFUSES when the chain says no — frozen, revoked, blocked or expired", async () => {
  // The on-stage revoke moment. The Guardian does not take our word for it.
  verdict.permitted = false;

  const { status, body } = await requestRelease({});

  assert.equal(status, 403);
  assert.equal(body.released, false);
  assert.match(body.reason, /no active on-chain grant/);
});

test("REFUSES a signature from someone other than the claimed provider", async () => {
  const { status, body } = await requestRelease({ account: DOCTOR, signWith: IMPOSTOR });

  assert.equal(status, 401);
  assert.match(body.reason, /signature/);
});

test("REFUSES a replayed challenge", async () => {
  // Break-glass transactions are public. Without single-use nonces, anyone
  // watching the chain could replay a request and collect shares.
  const nonce = await challenge();

  assert.equal((await requestRelease({ nonce })).status, 200);
  assert.equal((await requestRelease({ nonce })).status, 401);
});

test("REFUSES an unknown challenge", async () => {
  const { status } = await requestRelease({ nonce: crypto.randomUUID() });
  assert.equal(status, 401);
});

test("reports honestly when it holds no share for a patient", async () => {
  const { status, body } = await requestRelease({ patientHash: keccak256(toHex("unknown")) });

  assert.equal(status, 404);
  assert.equal(body.released, false);
});

test("END TO END: seal, distribute to 3 guardians, open with 2", async () => {
  // The full Tier-1 path, minus the real chain. Three independent stores stand
  // in for three independent Guardians.
  const record = { name: "Ramesh Kumar", allergies: ["Penicillin"], meds: ["Warfarin"] };
  const sealed = await sealRecord(record);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guardians-"));
  const guardians = await Promise.all(
    [1, 2, 3].map(async (id) => {
      const instance = createGuardianServer({
        id: String(id),
        chain: fakeChain(verdict),
        shares: createShareStore(path.join(dir, `g${id}.json`)),
        nonces: createNonceStore(),
      });
      await new Promise<void>((resolve) => instance.listen(0, resolve));
      const url = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;

      // Each Guardian receives exactly one share and never sees the others.
      await fetch(`${url}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientHash: PATIENT, share: sealed.shares[id - 1] }),
      });

      return { instance, url };
    }),
  );

  try {
    // Collect from only two of the three — the threshold.
    const collected: string[] = [];
    for (const { url } of guardians.slice(0, 2)) {
      const nonce = (await (await fetch(`${url}/challenge`)).json()).nonce;
      const signature = await DOCTOR.signMessage({
        message: challengeMessage(PATIENT, nonce),
      });

      const res = await fetch(`${url}/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientHash: PATIENT,
          provider: DOCTOR.address,
          nonce,
          signature,
        }),
      });

      const body = await res.json();
      assert.equal(body.released, true);
      collected.push(body.share);
    }

    assert.equal(collected.length, 2);
    assert.deepEqual(await openRecord(sealed.ciphertext, collected), record);
  } finally {
    for (const { instance } of guardians) instance.close();
  }
});
