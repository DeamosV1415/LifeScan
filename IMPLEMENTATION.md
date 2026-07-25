# LifeScan AI — Implementation Walkthrough & Tech Stack

A guided tour of everything we built, every technology we used, **how** and **where** we used
it, and the concept behind each piece. Written so a backend developer who has never touched
blockchain or applied cryptography can read it top-to-bottom and understand the system.

- **Live app:** https://life-scan-web.vercel.app
- **Repo:** https://github.com/DeamosV1415/LifeScan
- **Chain:** Base Sepolia (EVM testnet, chain ID `84532`)

---

## 0. How to read this doc

The system has one big idea, and everything else follows from it:

> **The blockchain is never in the path that saves the life — only in the path that proves who
> touched the data.** A bleeding patient's blood type reaches a paramedic with *no network at
> all*. Everything with privacy weight sits behind cryptography and a permanent on-chain audit.

We split medical data into **three tiers of disclosure**:

| Tier | Contents | Where it lives | Who reads it | Network needed |
|---|---|---|---|---|
| **0** | Blood group, allergies, implant/DNR flags, one contact | Plaintext, on the card (NFC + QR + print) | Anyone with a phone | **None** |
| **1** | Full meds, conditions, implants, insurance, contacts | AES-256-GCM ciphertext (on card + server mirror) | A registered provider, after an on-chain break-glass | Yes |
| **2** | Lifetime ABDM/ABHA history | External (out of scope) | — | Yes |

Keep that table in mind — most design decisions are "which tier is this, and what does that tier
allow?"

---

## 1. The repository — a monorepo

We use a **pnpm workspace monorepo**: one Git repo containing several independently-versioned
packages that share code and tooling. This is why the *same* encryption code runs in the
patient's browser and in the Guardian servers — it's one package both import.

```
LifeScan/
├── apps/
│   └── web/                 Next.js PWA — patient app, provider app, ER dashboard, API routes
├── packages/
│   ├── crypto/              AES-256-GCM + Shamir secret sharing (browser + Node)
│   └── contracts/           Solidity contracts + Hardhat (deploy/test/verify)
├── services/
│   ├── guardian/            The 2-of-3 key-share network (3 processes)
│   └── agent/               The autonomous AI triage agent
├── scripts/                 reset-demo, seeding
├── package.json             workspace root (pnpm@10.12.4, Node >=22)
└── pnpm-workspace.yaml
```

**Concept — monorepo & workspaces.** `packages/crypto` declares itself as `@lifescan/crypto`;
the web app and both services list `"@lifescan/crypto": "workspace:*"` as a dependency. pnpm
symlinks the local package instead of downloading from npm. Change the crypto once, every
consumer sees it. That guarantee is a *security* property here: the browser that seals a record
and the service that opens it are provably running identical field arithmetic.

**Tooling choices worth knowing:**
- **Package manager:** `pnpm@10.12.4` (see [package.json](package.json)). Chosen for fast,
  disk-efficient workspaces.
- **Running TypeScript with no build step:** the services run with
  `node --experimental-strip-types src/index.ts` (see [services/agent/package.json](services/agent/package.json)).
  Node ≥22 can strip TypeScript types at load time and run the file directly — no `tsc`, no
  `ts-node`, no `dist/`. That's why the service `.ts` files import each other with explicit
  `.ts` extensions.
- **Tests:** Node's built-in test runner, `node --test --experimental-strip-types test/*.test.ts`.
  No Jest/Vitest dependency. 91 tests across the workspace.

---

## 2. The complete tech stack

| Layer | Technology | Version | Where it's used |
|---|---|---|---|
| Monorepo / pkg mgr | **pnpm workspaces** | 10.12.4 | whole repo |
| Runtime | **Node.js** | ≥22 | services, build, tests |
| Language | **TypeScript** | 5.7.3 | everything except contracts |
| Contract language | **Solidity** | ^0.8.24 (solc 0.8.28) | [packages/contracts](packages/contracts/contracts) |
| Web framework | **Next.js** (App Router) | 16.2.10 | [apps/web](apps/web) |
| UI library | **React** | 19.2.0 | [apps/web](apps/web) |
| Styling | **Tailwind CSS** | 4.3.3 | [apps/web](apps/web) |
| Fonts | **next/font** (Inter, Space Grotesk, JetBrains Mono) | — | [layout.tsx](apps/web/app/layout.tsx) |
| Wallets / auth | **Privy** (`@privy-io/react-auth`) | ^3.35.1 | [providers.tsx](apps/web/app/providers.tsx) |
| Chain client | **viem** | ^2.55.4 (web/agent), ^2.21.55 (guardian) | everywhere on-chain |
| Chain | **Base Sepolia** (EVM L2 testnet) | chain 84532 | all contracts |
| Contract tooling | **Hardhat** + `hardhat-toolbox-viem` | ^2.22.19 / ^3 | [packages/contracts](packages/contracts) |
| Symmetric crypto | **WebCrypto AES-256-GCM** | platform built-in | [aes.ts](packages/crypto/src/aes.ts) |
| Threshold crypto | **Shamir Secret Sharing** (hand-rolled, GF(2⁸)) | — | [shamir.ts](packages/crypto/src/shamir.ts) |
| AI / LLM | **OpenAI SDK** (Responses API) | ^6.9.0 | [services/agent](services/agent/src) |
| Persistence | **Upstash Redis** (`@upstash/redis`) | ^1.38.0 | mirror, cards, shares |
| SMS | **Twilio REST** (raw `fetch`, no SDK) | — | [twilio.ts](services/agent/src/twilio.ts) |
| Realtime | **Server-Sent Events (SSE)** | native `http` | agent → ER dashboard |
| Service runtime | **node:http** (no web framework) | built-in | guardian + agent |
| Config | **dotenv** | ^16.4.7 | services |
| Deploy | **Vercel** (web) + **Render** (services) | — | production |

Everything below explains each of these in the order data actually flows.

---

## 3. Tier 0 — the offline layer (no server, no chain, no crypto)

This is the layer that "works in airplane mode," and it's deliberately the *simplest* thing in
the whole system.

**File:** [apps/web/lib/tier0.ts](apps/web/lib/tier0.ts)

**The format** is a pipe-delimited string that rides in the **URL fragment**:

```
https://lifescan.app/s/<id>#0|1|Ramesh%20Kumar|O+|Penicillin,Sulfa|PACEMAKER|+919876543210
                          └────────────────── the fragment (after #) ──────────────────┘
```

**Concept — why the URL fragment.** Everything after `#` in a URL is the *fragment*. Browsers
**never send the fragment to the server** — it exists only in the browser. So the medical data
reaches the phone (via NFC tap or QR scan) and renders **without a single network request**.
That's not a marketing line; it's a structural privacy property. The server literally cannot log
what it never receives.

**How we use it:**
- `buildTier0(...)` serialises a record into that string when a card is issued.
- `parseTier0(fragment)` runs on the scan page [apps/web/app/s/[id]](apps/web/app/s/[id]) to render it.

**Two design rules that matter for a *medical* product:**
1. **Parsing never throws.** A truncated or future-versioned tag degrades to `valid: false`
   with a readable reason, instead of crashing. A half-written NFC tag must still show what it
   has.
2. **Absent data never renders blank.** A missing allergy list shows `NOT RECORDED`
   (`MISSING` constant), never an empty space that a medic could misread as "no allergies." A
   blank field misread as "safe" could kill someone.

**Concept — PWA + service worker (the delivery mechanism).** The web app is an installable
**Progressive Web App**. A *service worker* (registered only in production, see
[layout.tsx](apps/web/app/layout.tsx)) caches the scan document so that after one online visit,
every future card tap renders offline. The `manifest.json` + `appleWebApp` metadata make it
install to the home screen and run fullscreen. This is what turns "a website" into "a thing that
works at a highway accident with no signal."

---

## 4. The cryptography — `packages/crypto`

This package is the entire Tier-1 trust model in two functions. Read
[packages/crypto/src/index.ts](packages/crypto/src/index.ts) first — it's the public surface:

```ts
sealRecord(record)              // in the patient's browser: encrypt + split the key + forget it
openRecord(ciphertext, shares)  // in the provider's browser: reassemble the key from 2 shares
```

There are two independent cryptographic primitives here. Understand them separately.

### 4a. AES-256-GCM — the encryption itself

**File:** [aes.ts](packages/crypto/src/aes.ts)

**Concept.** AES-256-GCM is *symmetric authenticated encryption*:
- **Symmetric** — one 256-bit key both encrypts and decrypts (unlike public/private key pairs).
  We call this key the **DEK** (data encryption key).
- **GCM** (Galois/Counter Mode) — provides **confidentiality *and* integrity**. It appends a
  16-byte *authentication tag*; if even one byte of ciphertext is altered, decryption **throws**
  instead of returning plausible-looking garbage. For a medical record, silently-corrupted
  plaintext is a patient-safety bug, so we chose GCM over the older CBC mode deliberately.
- **IV** (initialization vector) — a 12-byte random value, fresh per encryption, prepended to
  the output. Reusing an IV under the same key in GCM is catastrophic (it leaks the XOR of the
  plaintexts), so we generate a new one every time with `crypto.getRandomValues`.

**Payload layout we produce:** `iv (12 bytes) || ciphertext || tag (16 bytes)`, hex-encoded.

**Where it runs.** We use **WebCrypto** (`crypto.subtle`), which is built into both browsers and
Node 18+. Same code path in the patient's browser (sealing) and the Guardian/agent (opening) —
no library, no polyfill.

**The key property:** `generateDek()` mints the key inside `sealRecord`, and the `finally` block
zeroes it (`dek.fill(0)`) the moment it's split. The plaintext record and the key **never leave
the device** and are never persisted. The server only ever sees ciphertext.

### 4b. Shamir Secret Sharing — splitting the key so no one holds it

**File:** [shamir.ts](packages/crypto/src/shamir.ts)

**The problem it solves.** We have a DEK that can decrypt the record. If we store that key
*anywhere* — our server, one Guardian, a KMS — then whoever holds it can read the record. We want
a system where **no single party can decrypt, ever, including us.**

**Concept — threshold secret sharing.** Shamir's scheme splits a secret `S` into `n` shares such
that **any `t` of them reconstruct `S`, but `t-1` reveal literally nothing** (not "less info" —
*nothing*; any single share is mathematically consistent with every possible secret). We use
**`n = 3`, `t = 2`** (see `GUARDIAN_COUNT`/`GUARDIAN_THRESHOLD`).

**The math, intuitively.** A polynomial of degree `t-1` is uniquely pinned down by `t` points.
For `t = 2` that's a straight line: `f(x) = secret + a·x` with `a` random.
- Each Guardian gets one point `(x, f(x))` for `x ∈ {1,2,3}`.
- **Any 2 points** define the line → evaluate it at `x = 0` → recover `f(0) = secret`.
- **1 point** lies on infinitely many lines, each with a different `f(0)` → reveals nothing.

We do this **per byte** of the key, so a 32-byte DEK is just 32 independent instances of the same
tiny problem. Reconstruction (`combine`) is **Lagrange interpolation** evaluated at `x = 0`.

**Why we hand-rolled it** (rather than an npm package): every Node Shamir library is `Buffer`-based
and Node-only, but sealing must happen **in the browser**. Sealing server-side would mean we
briefly held the plaintext — which destroys the entire claim. So the secret-sharing is ours
(exhaustively tested); the cipher underneath is standard WebCrypto.

### 4c. GF(2⁸) — the arithmetic Shamir runs on

**File:** [gf256.ts](packages/crypto/src/gf256.ts)

**Concept — a finite field.** You can't do Shamir with ordinary integer math — the numbers grow
unbounded and division isn't exact. Instead we work in **GF(2⁸)**, the finite field of exactly 256
elements (one per byte value), where add/multiply/divide are all defined, closed (stay within a
byte), and invertible:
- **Addition = XOR** (`a ^ b`).
- **Multiplication** = carry-less multiply, reduced modulo the AES irreducible polynomial
  `x⁸+x⁴+x³+x+1` (`0x11b`).

We precompute **log/exponent tables** (using generator `3`) once at module load so that `mul` and
`div` are O(1) table lookups instead of bit loops. This is the same field AES itself is built on —
handy, because our security story only depends on one well-understood algebraic structure.

> **Mental model for the whole package:** encrypt the record with a random key (AES-GCM) → split
> that key into 3 line-points (Shamir over GF(2⁸)) → hand one point to each Guardian → throw the
> key away. To read the record you must convince **two independent Guardians** to hand their
> points back.

---

## 5. The smart contracts — `packages/contracts`

**Language:** Solidity `^0.8.24`. **Tooling:** Hardhat (`hardhat compile/test`, deploy + Basescan
verify). **Chain:** Base Sepolia.

**Concept — what a smart contract *is*.** A contract is code + persistent state that lives at an
address on a public blockchain. Two kinds of functions:
- **Transactions** (state-changing, e.g. `requestBreakGlass`) — must be mined into a block, cost
  **gas** (a small fee), and are **permanent and public**.
- **Views** (read-only, e.g. `hasRecentGrant`) — free, instant, no transaction.

Contracts also emit **events** — cheap, append-only log entries that off-chain code can subscribe
to. Events are how our agent knows a break-glass happened (§9).

**Concept — why a blockchain and not a database?** Three properties a database can't give:
1. The party most likely to be liable in a dispute (the hospital, or us) **cannot alter the audit
   log** after the fact.
2. The patient can **verify their own access history** without trusting our server.
3. The three Guardians need a **neutral source of truth** each can independently check.

**Critically: no PHI ever touches the chain.** A patient is only ever a `keccak256` hash (§6).

We deployed **four** contracts. Here's each, what it enforces, and the concept it teaches.

### 5a. ProviderRegistry — *who is allowed to break glass*

**File:** [ProviderRegistry.sol](packages/contracts/contracts/ProviderRegistry.sol)

The permissioning layer. An admin (in production, a health authority; for us, the deployer key)
registers clinicians keyed to a Health Facility Registry ID. `isActive(address) → bool` is the
question everyone else asks.

- `registerProvider` / `revokeProvider` / `reinstateProvider` — admin-only (the `onlyAdmin`
  *modifier*, a reusable guard prepended to a function).
- **Concept — custom errors** (`revert NotAdmin()`): a gas-efficient, typed way to fail a
  transaction. Cheaper than string messages and machine-readable by the frontend.

Design note in the code: the security model does **not** rest on this registry alone. Emergency
access can't be blocked pending verification (a paramedic can't wait for an approval workflow), so
prevention is only half the design — the other half is permanent attribution (next contract).

### 5b. EmergencyAccessLog — *the accountability core*

**File:** [EmergencyAccessLog.sol](packages/contracts/contracts/EmergencyAccessLog.sol)

This is the most important contract. It governs Tier-1 access and gives the patient the only veto.

- `registerPatient(patientHash)` — a patient claims ownership of their record hash. **First claim
  wins**; only the owner can later freeze or revoke.
- `requestBreakGlass(patientHash, reasonCode, contextHash)` — the heart. It checks, in order:
  valid reason code → caller `isActive` in the registry → record **not frozen** → provider **not
  blocked**. If all pass, it appends an immutable `AccessRecord` and emits **`BreakGlassGranted`**.
  - **Concept — "granted, not requested-and-approved."** There's no approval queue. An authorised
    clinician gets access *immediately* — because a patient is bleeding. Deterrence is
    **permanent attribution**, not prevention. This is exactly how real hospital EHRs (e.g. Epic)
    implement "break-glass."
- `freezeRecord` / `unfreezeRecord` / `blockProvider` — **patient-owner-only** kill switches.
- **`hasRecentGrant(patientHash, provider, window) → bool`** — the single view each Guardian calls
  before releasing a key share. It returns false for frozen records, blocked/revoked providers,
  and grants older than `window`. **This is what makes the on-stage revoke real** — it's enforced
  by the chain, so a frozen record stays shut even if all of *our* servers are compromised or
  lying.
  - **Concept — time-boxing.** A grant is only valid for a window (the Guardians pass 15 minutes,
    §7). A break-glass from last month can't silently unlock the record today.

### 5c. AgentActionLog — *accountability for the AI*

**File:** [AgentActionLog.sol](packages/contracts/contracts/AgentActionLog.sol)

Answers "who is accountable when the AI is wrong?" The agent cannot act without leaving a record.

- `authorizeAgent(address)` — admin marks an address as an agent (`isAgent` mapping).
- `logAction(patientHash, actionType, payloadHash)` — callable **only by an authorised agent**.
  Stores the **hash** of the action's full payload (7 action types: triage, SBAR, notify, ER
  push, pre-auth, flag-for-human).
- **Concept — anchoring/commitment.** We store only the `keccak256` hash of the reasoning, not the
  reasoning itself. The chain proves the payload *existed*, *when*, and that it *hasn't changed
  since* — without putting clinical text on a public ledger. `verifyPayload` lets anyone later
  check an off-chain payload against its anchored hash.

### 5d. EmergencyEscrow — *where the agent's authority deliberately stops*

**File:** [EmergencyEscrow.sol](packages/contracts/contracts/EmergencyEscrow.sol)

This contract exists to make a boundary **enforceable**, not just stated on a slide.

- `preparePreAuth(...)` — the agent **prepares** an insurance pre-authorisation and anchors its
  hash. This is the honest version of "instant cashless payout": the claim is *filed* in second
  10, not day 3.
- `release(id)` — releasing funds is gated to a **human approver**, and **the agent address is
  rejected even if it somehow holds the approver role** (`if (agentLog.isAgent(msg.sender)) revert
  AgentsCannotRelease();`).
- **Concept — defence in depth.** The human/agent money boundary doesn't rest on one access-control
  line being configured correctly; it's a second, independent gate. There's a unit test for
  exactly this. When a judge asks "who's liable if the agent pays the wrong hospital?", the answer
  is: *the agent never pays — it prepares and proves; a human releases. We drew that line in the
  contract.*

**Deployed addresses (Base Sepolia, all source-verified on Basescan):**

| Contract | Address |
|---|---|
| ProviderRegistry | `0x0a5e65d94c8bc2c5e46cd2fafeede36fe000de8a` |
| EmergencyAccessLog | `0x1c9c012799fe26fcafc50cc45d4f4f1c2b30a847` |
| AgentActionLog | `0xd6e1bbb5f92d817ad63075322c719e74d7cac6bf` |
| EmergencyEscrow | `0x37be02feb0e249c4d5589f18e6ba1538ce3b6831` |

**Concept — Base / L2 / testnet.** *Base* is an Ethereum **Layer 2** (an "L2" — a faster, cheaper
chain that settles to Ethereum). *Sepolia* is its **testnet**: real infrastructure, fake money
("testnet ETH" from a faucet). ~2-second blocks and a free block explorer (**Basescan**) we can
project on stage. Our whole four-contract deploy cost ~`0.0000121 ETH` of gas.

---

## 6. The chain client layer — viem

**File:** [apps/web/lib/contracts.ts](apps/web/lib/contracts.ts) (browser),
[services/*/src/chain.ts](services/agent/src/chain.ts) (services)

**Concept — viem.** A modern TypeScript library for talking to EVM chains. Two client types:
- **`publicClient`** — reads (`readContract`), watches events, fetches balances/receipts. Safe in
  the browser; no key.
- **`walletClient`** — *signs and sends* transactions. Needs an account (a key or a wallet
  provider).

**Concept — the ABI.** An **A**pplication **B**inary **I**nterface is the typed description of a
contract's functions and events. viem uses it to encode calls and decode results with full
TypeScript types. Notice we hand-write **only the fragments the app actually calls** (in
`contracts.ts`) rather than importing the full compiled ABI — it keeps the bundle small and makes
the contract surface the app depends on explicit.

**Concept — `patientHash` (the one identifier on-chain):**

```ts
patientHash(id) = keccak256(toHex(`lifescan:patient:${id.trim().toLowerCase()}`))
```

- **keccak256** is the hash function Ethereum uses (a SHA-3 variant), 256-bit output.
- It's **one-way** (you can't recover the id from the hash) and **deterministic** (same id →
  same hash). Both the patient app (sealing) and provider app (break-glass) derive it identically,
  so a card sealed here resolves to the same on-chain hash broken-glass there.
- This is our **pseudonymisation**: the chain sees `0x9f3c…`, never "Ramesh Kumar." (Consequence:
  a `p-…` id can't be recovered from its hash — which is *why* issued cards are indexed by email
  server-side, §8.)

Addresses come from `NEXT_PUBLIC_*` env vars (set by the deploy script and in Vercel), so there's
no hand-copied address to drift out of sync.

---

## 7. Wallets & authentication — Privy

**File:** [apps/web/app/providers.tsx](apps/web/app/providers.tsx),
[apps/web/lib/useProviderWallet.ts](apps/web/lib/useProviderWallet.ts)

**The problem.** Every on-chain write needs a *wallet* to sign it. Making a paramedic install
MetaMask and manage a seed phrase on stage is exactly the kind of avoidable failure that sinks a
live demo.

**Concept — Privy embedded wallets.** The user logs in with **email only**. Privy provisions a
non-custodial **embedded wallet** whose private key lives in a secure Privy iframe — the app never
sees it. The wallet is **deterministic per email** (same login → same address every time), which
is what lets us register a provider's address on-chain once, ahead of time.

**Concept — EIP-1193.** That's the standard JavaScript interface every Ethereum wallet exposes
(`request({ method, params })`). Privy hands us an EIP-1193 provider; `useProviderWallet` wraps it
in a viem `walletClient` so the rest of the app uses **one** chain library for both reads (viem
public client) and writes (viem over Privy). The key never leaves Privy; we only ever get "please
sign this" access.

Config (in `providers.tsx`): `loginMethods: ["email"]`, embedded wallets created for
users-without-wallets, chain pinned to `baseSepolia`.

### The faucet (a demo-only crutch)

**File:** [apps/web/app/api/faucet/route.ts](apps/web/app/api/faucet/route.ts)

A fresh Privy wallet has **0 ETH**, so its first transaction (claiming a record, or breaking
glass) would revert for lack of gas. The faucet tops it up `0.001 ETH` from the deployer key,
server-side. It's **bounded** (skips wallets already funded, refuses if the deployer is low, can
be disabled with `FAUCET_ENABLED=false`) — but note it is **not rate-limited** (see §12).

**Concept for Q&A — gas sponsorship.** In production you'd never make users hold crypto; you'd
sponsor gas via a paymaster / ERC-4337 / relayer. The faucet is a demo artifact standing in for
that.

---

## 8. The web app — `apps/web`

**Stack:** Next.js 16 (App Router) + React 19 + Tailwind 4. Fonts via `next/font` (Space Grotesk
for display/numbers, Inter for body, JetBrains Mono for addresses/IDs). See
[layout.tsx](apps/web/app/layout.tsx).

**Concept — Next.js App Router & where code runs.** Files under `app/` are React components.
`"use client"` at the top means the component runs in the browser (needed for anything using
wallets, state, effects). Files named `route.ts` under `app/api/` are **server-side HTTP handlers**
(our backend endpoints). This single app serves three audiences: patient, provider, ER.

**The surfaces (routes):**

| Route | Who | What it does |
|---|---|---|
| [/s/[id]](apps/web/app/s/[id]) | anyone | Offline Tier-0 scan render |
| [/patient](apps/web/app/patient/page.tsx) | patient | Card hub — every card the login owns |
| [/patient/new](apps/web/app/patient/new/page.tsx) | patient | Create a card — the seal pipeline |
| [/patient/audit](apps/web/app/patient/audit/page.tsx) | patient | Live on-chain access log + Freeze/Revoke |
| [/provider/break-glass](apps/web/app/provider/break-glass) | clinician | Break glass → collect shares → decrypt |
| [/er](apps/web/app/er) | ER | Live agent trace + incoming-patient board (SSE) |
| [/admin](apps/web/app/admin) | hospital admin | Register/revoke providers on-chain |

### 8a. The seal pipeline (the most important frontend flow)

**File:** [apps/web/app/patient/new/page.tsx](apps/web/app/patient/new/page.tsx) → the `seal()` callback

This is where §4 (crypto), §5 (contracts), §6 (viem) and §7 (Privy) come together. Step by step:

1. **Build the record** from the form into a `Tier1Record` object.
2. **`sealRecord(record)`** → AES-GCM ciphertext + 3 Shamir shares (all client-side; the plaintext
   never leaves the browser).
3. **Mirror the ciphertext** — `POST /api/records` stores the *encrypted* blob server-side
   (§8b). The server holds something it cannot read.
4. **`distributeShares(patientHash, shares)`** — hand **one share to each Guardian** over HTTP
   ([lib/guardians.ts](apps/web/lib/guardians.ts)).
5. **Claim on-chain** — `registerPatient(patientHash)` via the Privy wallet, so only this patient
   can later freeze the record. (Idempotent: if `ownerOf` is already set, skip.)
6. **Build the Tier-0 card URL** (`buildTier0`) for writing to an NFC tag.
7. **Index the card by email** — `POST /api/my-cards` so the card follows the login across
   browsers (§8b).

**Concept — idempotent resume.** Before re-encrypting, the flow checks `GET /api/records?hash=…`.
If the record is already mirrored, it skips straight to the claim. This is why a run that failed
only for gas can be retried with one click without producing *new* ciphertext and orphaning the
Guardians' old shares.

**Concept — a React hydration footgun we handled.** The fresh `p-…` id is generated in a
`useEffect`, not in `useState`/`useMemo`. If we generated it during render it would produce one
value on the server and a different one in the browser → a hydration mismatch. Generating it in an
effect keeps server and first client render identical (empty), then fills it in.

### 8b. API routes (the web backend)

- **[/api/records](apps/web/app/api/records)** — stores/serves the Tier-1 **ciphertext mirror**.
  Backed by [record-store.ts](apps/web/lib/record-store.ts).
- **[/api/my-cards](apps/web/app/api/my-cards/route.ts)** — the **email → issued-cards index**, so
  a patient's cards aren't stranded in one browser's localStorage. Backed by
  [card-index.ts](apps/web/lib/card-index.ts). (Stores only non-clinical labels + the card URL.)
- **[/api/faucet](apps/web/app/api/faucet/route.ts)** — the gas top-up (§7).
- **[/api/admin/providers](apps/web/app/api/admin)** — register/revoke clinicians on-chain, signed
  server-side with the deployer key, gated by an `x-admin-token` header (the key never reaches the
  browser).

---

## 9. Persistence — Upstash Redis (dual-mode)

**Files:** [redis.ts](apps/web/lib/redis.ts), [record-store.ts](apps/web/lib/record-store.ts),
[card-index.ts](apps/web/lib/card-index.ts), [services/guardian/src/store.ts](services/guardian/src/store.ts)

**Concept — why Redis at all.** Vercel and Render run on **ephemeral filesystems** — anything
written to disk vanishes on redeploy/restart. So durable state needs an external store. We use
**Upstash Redis**, a serverless Redis accessed over a REST API (no persistent TCP connection,
which suits serverless).

**Concept — dual-mode with graceful fallback.** `redis()` returns a client **only if**
`UPSTASH_REDIS_REST_URL`/`_TOKEN` are set; otherwise `null`. Every store checks that: Redis when
configured (production), a local JSON file otherwise (local dev, on-stage demo). Same interface,
zero external dependencies to run locally.

**The data model — five Redis hashes** (a hash = a map of field→value):

| Key | Field | Value | Written by |
|---|---|---|---|
| `records` | patientHash | `{ ciphertext, label, updatedAt }` | patient app (seal) |
| `cards` | email | `IndexedCard[]` | patient app (seal) |
| `shares:guardian-1` | patientHash | one Shamir share | Guardian 1 |
| `shares:guardian-2` | patientHash | one Shamir share | Guardian 2 |
| `shares:guardian-3` | patientHash | one Shamir share | Guardian 3 |

**Concept — independence preserved in a shared store.** Each Guardian namespaces its shares under
its *own* key (`shares:guardian-N`), so even sharing one Redis database, no process can read
another Guardian's shares. The property that matters — "no single process holds enough material to
reconstruct a key" — still holds in the cloud.

Capacity (for reference): all reads/writes are single-field `hget`/`hset` (O(1)); ~3–6 KB per
patient; the free tier comfortably holds tens of thousands of patients. Redis is **not** the
scaling bottleneck — see §12.

---

## 10. The Guardian network — `services/guardian`

**Stack:** plain **`node:http`** (no framework), viem, `@upstash/redis`, run with Node's
type-stripping. Three processes, selected by `GUARDIAN_ID` (1/2/3), each with its own port and its
own share store.

**Concept — this is the load-bearing trust component.** A Guardian releases its key share only if
it **independently verifies, by reading the chain itself**, that access is warranted. It never
takes our word, or another Guardian's word.

**File:** [services/guardian/src/server.ts](services/guardian/src/server.ts) — four endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness + how many shares held |
| `GET /challenge` | issue a single-use nonce for the caller to sign |
| `POST /shares` | accept a share at seal time |
| `POST /release` | release a share **iff the chain permits** |

**`/release` is the whole product.** Four checks, all must pass:

1. **Single-use nonce** — the `nonce` is one this Guardian issued and hasn't been used
   ([store.ts](services/guardian/src/store.ts) `createNonceStore`).
2. **Signature recovers to the provider** — `verifyProviderSignature` confirms the caller
   actually controls the provider key *right now* (they signed this Guardian's fresh nonce).
3. **+ 4. On-chain grant** — `chain.isReleasePermitted` reads `hasRecentGrant` from
   `EmergencyAccessLog` over **this Guardian's own RPC connection**. That single call also covers
   frozen records and blocked/revoked/expired grants.

**File:** [services/guardian/src/chain.ts](services/guardian/src/chain.ts) — the independent read.

**Concept — replay resistance.** Break-glass transactions are *public*. Without step 1+2, anyone
watching the chain could replay a provider's request and harvest shares. The nonce is single-use
and in-memory (a nonce that survives a restart is a nonce that can be replayed); the signature
proves liveness.

**Concept — why "read, not reported" is the security crux.** Because each Guardian reads the
contract itself, **compromising our servers doesn't compromise a record**, and a patient's freeze
holds *even if all of our own infrastructure is lying*. That sentence is the pitch, and it's
literally true of this code.

**Two engineering details worth knowing:**
- **`GRANT_WINDOW_SECONDS = 900n`** (15 min) — grants are time-boxed here.
- **RPC lag retry** — Base's public RPC is load-balanced and eventually-consistent. A read moments
  after the grant tx can hit a node that hasn't seen the block yet and wrongly refuse. We retry a
  false result 3×1s to absorb propagation lag. This only adds latency — a genuinely frozen record
  still returns false after the retries, so the patient's revoke stays enforced.
- **`/release-agent`** — a parallel path for the AI agent (§11): released only if the agent is
  `isAgent` on-chain **and** any real, unexpired, unfrozen grant exists. A freeze locks the agent
  out identically to a human.

---

## 11. The AI triage agent — `services/agent`

**Stack:** **OpenAI SDK** (`openai@^6.9.0`, the **Responses API**), viem, Twilio-over-REST, run
with Node type-stripping. Model `gpt-5.6-luna`, reasoning effort `low` (both env-tunable via
`OPENAI_MODEL` / `OPENAI_REASONING_EFFORT`).

> **Note on the model:** the triage reasoning uses **OpenAI** (a deliberate team decision). The
> reasoning layer is model-agnostic — it's a standard function-calling loop, swappable by changing
> the client + model env, and nothing else in the system depends on the provider.

**Concept — "autonomous," precisely.** The agent is triggered by an **on-chain event**, not a
button.

**File:** [services/agent/src/chain.ts](services/agent/src/chain.ts) → `watchBreakGlass`:

```ts
publicClient.watchContractEvent({ ..., eventName: "BreakGlassGranted", onLogs })
```

**Concept — `watchContractEvent`.** viem polls the chain's logs under the hood and fires a
callback when a matching event appears. So the moment any provider breaks glass, the agent wakes
on its own — "genuinely autonomous," not "we clicked run." (A `handled` set de-dupes redelivered
logs.)

### The Perceive → Reason → Act loop

**File:** [services/agent/src/index.ts](services/agent/src/index.ts) (`handleBreakGlass`) +
[reason.ts](services/agent/src/reason.ts) (`runTriage`).

1. **Perceive** — fetch the ciphertext from `/api/records`, then
   [collect.ts](services/agent/src/collect.ts) `collectAndDecrypt` gathers **2 shares** from the
   Guardians' `/release-agent` path and `openRecord`s the plaintext (in memory, never persisted).
2. **Reason + Act** — the OpenAI **tool-calling loop**.

**Concept — LLM tool/function calling.** We give the model a set of **tools**, each described by a
**JSON Schema** of its parameters. The model responds with `function_call` outputs — structured
requests to run a tool. We execute them, feed the results back, and **loop until the model stops
calling tools** (capped at 8 turns). This is the manual version of an agent loop — we own every
turn.

The six tools (in `reason.ts`):
`record_triage_assessment` → `generate_sbar_handoff` → `notify_emergency_contacts` →
`push_to_er_dashboard` → `generate_preauth_packet` → `flag_for_human_review`.

- **Concept — `strict: true` structured output.** Each tool sets `strict: true` with
  `additionalProperties: false`, forcing the model's arguments to **exactly** match the schema —
  no hallucinated fields, no missing required ones. Critical when the output drives real actions.
- **Concept — reasoning effort.** `reasoning: { effort: "low" }` tunes how much the model
  "thinks" before answering. Triage is recognition, not derivation, and stage latency matters, so
  we keep it low.
- **SBAR** (Situation / Background / Assessment / Recommendation) is the actual clinical handoff
  standard — using it signals real domain homework.

**The money shot — every tool call is anchored on-chain.** Inside `execute()`, each tool:
1. emits a **trace event** (→ the ER dashboard, §12b/SSE),
2. calls `chain.logAction(patientHash, actionType, args)` — a real transaction to
   `AgentActionLog`, so the action's payload hash is **permanently on-chain**,
3. performs its real side effect (e.g. the notify tool actually sends the SMS).

So a single agent action is simultaneously **"autonomous AI workflow," "smart contract
execution," and "real-time transaction log"** — the jury's three grading criteria satisfied by one
live artifact.

**Concept — local nonce management.** The agent fires several `logAction` txs back-to-back. Each
Ethereum tx from an account needs a sequential **nonce**; if two txs grab the same nonce, one is
rejected. `nextNonce()` tracks it locally (`pending` count, then +1 per tx) so rapid-fire actions
don't collide.

### Cost accounting & SMS

- **[cost.ts](services/agent/src/cost.ts)** — every run reads the API's real `usage` and prices it
  against the published rate card. "It costs pennies" is a *measured* claim (a full run ≈ $0.0146),
  printed per turn, not a hope.
- **[twilio.ts](services/agent/src/twilio.ts)** — SMS via a **raw `fetch`** to Twilio's REST
  Messages endpoint (a single Basic-auth POST), so we add no SDK to the type-stripped runtime. It
  **degrades gracefully**: if Twilio isn't configured, the run still anchors and traces the
  notification — a missing credential never breaks the demo. (It also formats messages as plain
  GSM-7, no emoji, ≤260 chars — a trial-account deliverability constraint we hit and fixed.)

---

## 12. Real-time & the ER dashboard — Server-Sent Events

**Files:** agent [index.ts](services/agent/src/index.ts) (`GET /trace`) +
[trace.ts](services/agent/src/trace.ts); consumer [apps/web/app/er](apps/web/app/er).

**Concept — SSE (Server-Sent Events).** A one-way, server→client stream over a single long-lived
HTTP response with `Content-Type: text/event-stream`. The server writes `data: {...}\n\n` frames;
the browser consumes them with the native `EventSource` API. It's simpler than WebSockets when you
only need to *push* (which is all a live dashboard needs) and it rides ordinary HTTP.

How ours works:
- Every meaningful agent step is emitted to a `TraceBus` (a Node `EventEmitter`) with a short
  **backlog** so a dashboard that connects mid-run still catches up.
- The `/trace` SSE endpoint replays the backlog, then streams new events, filtered by patient. A
  `: ping` heartbeat every 15s keeps the connection alive through proxies.
- The ER dashboard's `EventSource` renders the incoming-patient card, SBAR, and live trace as they
  arrive — so the "hospital sees the patient before the ambulance arrives" beat is genuine, not
  scripted.

---

## 13. End-to-end: the three flows in one place

**① Issue a card (patient).**
`/patient/new` form → `sealRecord` (AES-GCM + Shamir, in-browser) → `POST /api/records` (mirror
ciphertext) → `distributeShares` (one per Guardian) → `registerPatient` on-chain (Privy wallet) →
build Tier-0 URL → `POST /api/my-cards` (index by email). *Plaintext never left the device.*

**② Break glass (provider).**
`/provider/break-glass` → `requestBreakGlass` tx (viem + Privy) → `BreakGlassGranted` event →
`collectShares`: for each Guardian, `GET /challenge` → sign nonce → `POST /release`; Guardian runs
its 4 checks (nonce, signature, on-chain `hasRecentGrant`) and releases → **2 shares** →
`openRecord` decrypts Tier 1 in the browser.

**③ Autonomous triage (agent).**
`watchContractEvent(BreakGlassGranted)` fires → fetch ciphertext → `collectAndDecrypt` via
`/release-agent` (2 shares) → OpenAI tool loop → each tool traces (SSE → ER board) + anchors on
`AgentActionLog` + does its side effect (SMS, pre-auth) → done, cost printed.

**④ Accountability (patient, live).**
`/patient/audit` polls `getAccessHistory` every 4s → the break-glass appears in real time →
`freezeRecord` or `blockProvider` tx → the next break-glass **fails at the Guardians**, because
`hasRecentGrant` now returns false. The chain enforced it, not our UI.

---

## 14. Honest boundaries — what's demo-scale (and what's missing)

Being explicit about limits reads as strength, not weakness. For the full scaling analysis see the
conversation notes; the headline items:

- **No rate limiting anywhere.** No throttle on any route. The sharpest gap is `/api/faucet`,
  which spends real testnet ETH from one shared deployer wallet and is only bounded per-address,
  not per-caller — a loop with fresh addresses can drain it. `/api/my-cards` trusts a
  self-asserted email (the code flags it should verify a Privy session token). **First hardening
  move:** `@upstash/ratelimit` on the faucet (it rides the Redis we already have) + a Privy
  session gate on `my-cards`.
- **Concurrency ceiling is the single free Render instance** hosting the 3 Guardians + agent
  (512 MB, 0.1 CPU, sleeps after 15 min idle). Fine for the live demo; the real product would run
  the Guardians as three separately-operated services off free tier.
- **Total gas-funded signups ≈ 6** — the shared deployer wallet, not Redis, is the hard cap.
  Production replaces the faucet with gas sponsorship.
- **All three Guardians are ours.** In production they'd be a hospital federation, a state health
  authority, and an independent auditor. The architecture doesn't change — only who holds the keys.
- **One non-atomic write:** `putCard` does read-modify-write on the `cards` hash, so two cards
  sealed for the *same email* in the same instant could lose one. Rare, but real.

---

## 15. Concept glossary (quick reference)

| Term | One-line meaning |
|---|---|
| **Tier 0 / 1 / 2** | Our disclosure model: offline plaintext / encrypted break-glass / external history |
| **URL fragment** | The part after `#`; never sent to a server → offline privacy |
| **AES-256-GCM** | Symmetric authenticated encryption; tamper → decrypt fails |
| **DEK** | Data encryption key — the one AES key we split and throw away |
| **IV / nonce (crypto)** | Unique-per-encryption random value; never reuse under one key |
| **Shamir Secret Sharing** | Split a secret into n shares; any t reconstruct, t−1 reveal nothing |
| **Threshold (2-of-3)** | Two of three Guardians must cooperate to decrypt; none alone can |
| **GF(2⁸)** | Finite field over bytes (XOR add, poly-mod multiply) Shamir runs on |
| **Lagrange interpolation** | Reconstructs the secret from t share-points at x=0 |
| **keccak256** | Ethereum's one-way hash; turns a patient id into an on-chain pseudonym |
| **Smart contract** | Code + state at a chain address; tx (writes, costs gas) vs view (reads, free) |
| **Event / log** | Cheap append-only contract output that off-chain code subscribes to |
| **Custom error** | Gas-cheap typed revert reason (`revert NotAdmin()`) |
| **Gas** | The fee to run a state-changing transaction |
| **L2 / Base / Sepolia** | Cheap fast chain / our chain / its testnet (fake money) |
| **viem** | TS library for EVM reads (publicClient) and writes (walletClient) |
| **ABI** | Typed description of a contract's functions & events |
| **Privy embedded wallet** | Email-login non-custodial wallet; key stays in Privy's iframe |
| **EIP-1193** | Standard JS interface every Ethereum wallet exposes |
| **watchContractEvent** | viem log-polling that fires a callback → the agent's autonomy |
| **Tool / function calling** | LLM returns structured requests to run your functions; you loop |
| **strict output** | Forces the model's args to exactly match the JSON Schema |
| **SBAR** | Situation/Background/Assessment/Recommendation clinical handoff format |
| **Anchoring** | Storing a payload's hash on-chain to prove it existed & is unchanged |
| **Break-glass** | Real EHR pattern: emergency access you can't block, so you deter via audit |
| **SSE** | One-way server→client HTTP stream; powers the live ER dashboard |
| **PWA / service worker** | Installable web app + cache layer that makes the scan work offline |
| **Dual-mode store** | Redis when configured, local file otherwise — same interface |

---

*Every file referenced above is a clickable link in the IDE. Start with
[packages/crypto/src/index.ts](packages/crypto/src/index.ts) and
[packages/contracts/contracts/EmergencyAccessLog.sol](packages/contracts/contracts/EmergencyAccessLog.sol)
— those two files are the heart of the whole system.*
