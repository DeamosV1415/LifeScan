# LifeScan — Deployment (Render + Vercel)

## Topology

| Service | Host | Count | What it does |
|---|---|---|---|
| Web PWA (`apps/web`) | **Vercel** | 1 | patient/provider/ER/admin UI + API routes |
| Guardian (`services/guardian`) | **Render** | **3** (separate services) | hold one key share each, verify chain, release |
| Agent (`services/agent`) | **Render** | 1 | watches `BreakGlassGranted`, runs triage |

**5 URLs total.** Each guardian needs its **own** public URL (the browser + agent call all three), so they are 3 separate Render services — not one. All stores are Upstash Redis, so Render's ephemeral disk is fine.

> **Prerequisite:** commit + push the agent fix (`services/agent/src/index.ts` — optional `.env.local`, binds to `$PORT`). Render builds from GitHub, so unpushed code won't deploy.

---

## Deploy order (avoids the wiring chicken-and-egg)

1. Push code.
2. Deploy the **3 guardians** → collect their URLs.
3. Deploy the **agent** (needs the guardian URLs + the existing Vercel web URL).
4. Update **Vercel** env (guardian URLs, agent URL, Upstash) → redeploy.
5. Health-check all five.

---

## Part A — 3 Guardian services on Render

For **each** of guardian-1, guardian-2, guardian-3: **New → Web Service → connect the GitHub repo**, branch `main`.

- **Root Directory:** *(leave blank = repo root; workspace deps need the whole repo)*
- **Runtime:** Node
- **Build Command:** `corepack enable && pnpm install --frozen-lockfile`
- **Start Command:** `pnpm --filter @lifescan/guardian start`
- **Instance type:** Free

**Environment variables (per guardian):**

| Key | Value |
|---|---|
| `GUARDIAN_ID` | `1` (guardian-2 → `2`, guardian-3 → `3`) |
| `NODE_VERSION` | `22` |
| `NEXT_PUBLIC_ACCESS_LOG_ADDRESS` | *(copy from your `.env.local`)* |
| `NEXT_PUBLIC_AGENT_LOG_ADDRESS` | *(copy from your `.env.local`)* |
| `BASE_SEPOLIA_RPC_URL` | your Alchemy/Infura Base Sepolia URL *(see RPC note)* |
| `UPSTASH_REDIS_REST_URL` | *(same as everywhere)* |
| `UPSTASH_REDIS_REST_TOKEN` | *(same as everywhere)* |

**Do NOT set** `PORT` (Render injects it — the guardian binds to it) or `GUARDIAN_STORE` (the default keeps the Redis namespace `shares:guardian-N`, which matches the migrated shares).

**Verify:** `GET https://<guardian>.onrender.com/health` → `{ "guardian": "1", "sharesHeld": 2, ... }` (the 2 = Ramesh + Aarv already in Redis).

Note the three URLs, e.g. `https://lifescan-guardian-1.onrender.com`.

---

## Part B — Agent service on Render

**New → Web Service → same repo/branch/root.**

- **Build Command:** `corepack enable && pnpm install --frozen-lockfile`
- **Start Command:** `pnpm --filter @lifescan/agent start`
- **Instance type:** Free (⚠ see demo-day note — consider paid for the agent)

**Environment variables:**

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `OPENAI_API_KEY` | *(copy from `.env.local`)* |
| `AGENT_PRIVATE_KEY` | *(copy from `.env.local` — already authorised on-chain)* |
| `NEXT_PUBLIC_ACCESS_LOG_ADDRESS` | *(copy)* |
| `NEXT_PUBLIC_AGENT_LOG_ADDRESS` | *(copy)* |
| `BASE_SEPOLIA_RPC_URL` | your Alchemy/Infura URL |
| `NEXT_PUBLIC_GUARDIAN_URLS` | the 3 Render guardian URLs, **comma-separated, no spaces** |
| `RECORD_API_URL` | your Vercel web URL, e.g. `https://life-scan-web.vercel.app` |
| `OPENAI_MODEL` | `gpt-5.6-luna` |
| `OPENAI_REASONING_EFFORT` | `low` |
| `TWILIO_ACCOUNT_SID` | *(copy — for the emergency SMS)* |
| `TWILIO_AUTH_TOKEN` | *(copy)* |
| `TWILIO_FROM_NUMBER` | *(copy)* |
| `TWILIO_TEST_TO_NUMBER` | *(copy — verified numbers)* |

The agent does **not** need Upstash (it fetches ciphertext via `RECORD_API_URL` and shares via the guardian URLs).

**Verify:** `GET https://<agent>.onrender.com/health` → `{ "status": "ok", "agent": "0x…", "model": "gpt-5.6-luna" }`. Check the deploy log says `on-chain authorized: true`.

---

## Part C — Vercel env to ADD / UPDATE

Project → **Settings → Environment Variables** (Production), then **redeploy** (env changes only apply on a new build).

**ADD (new — from the Redis + Render work):**

| Key | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | *(same as Render)* |
| `UPSTASH_REDIS_REST_TOKEN` | *(same as Render)* |

**ADD / UPDATE (point the browser at the Render services):**

| Key | Value |
|---|---|
| `NEXT_PUBLIC_GUARDIAN_URLS` | the 3 Render guardian URLs, comma-separated, no spaces |
| `NEXT_PUBLIC_AGENT_URL` | the Render agent URL |

**Verify these already exist (from earlier):** `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_ACCESS_LOG_ADDRESS`, `NEXT_PUBLIC_AGENT_LOG_ADDRESS`, `NEXT_PUBLIC_ESCROW_ADDRESS`, `NEXT_PUBLIC_PRIVY_APP_ID`, `DEPLOYER_PRIVATE_KEY` (faucet/admin sign server-side), `ADMIN_TOKEN`. Optional: `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` (falls back to public).

Then **Deployments → ⋯ → Redeploy**.

---

## Part D — Demo-day operating notes (free tier)

- **Free Render services sleep after ~15 min idle** (~30–50s cold start). ~10 min before judging, wake **all four** Render services by hitting each `/health`, and load the Vercel site once.
- **Keep `/er` open during the demo.** Its SSE connection to the agent's `/trace` keeps the agent awake — critical, because a sleeping agent stops watching the chain and will **miss** the `BreakGlassGranted` event (no autonomous trigger).
- **Strongly consider a paid ($7/mo) instance for the AGENT only** for the exhibition — it's the one service doing live autonomous work and must never sleep mid-demo. Guardians can stay free (a break-glass HTTP call wakes them; just pre-warm).
- **RPC:** set `BASE_SEPOLIA_RPC_URL` to a free **Alchemy/Infura Base Sepolia** endpoint (not `https://sepolia.base.org`) on agent + guardians. The public RPC is load-balanced/eventually-consistent and can make a guardian briefly refuse a fresh grant.
- **HTTPS everywhere:** Vercel + Render are both HTTPS and the services send `access-control-allow-origin: *`, so no mixed-content or CORS issues.

## Part E — Smoke test after deploy

1. Each guardian `/health` → `sharesHeld` ≥ 2.
2. Agent `/health` → `authorized: true`.
3. On the live site: sign in as provider → **Break glass** on Aarv (`0x6edf…3a7a`) → guardians release → decrypt → open `/er` → agent trace fills → SMS.
