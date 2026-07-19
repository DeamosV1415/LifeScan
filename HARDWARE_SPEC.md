# LifeScan AI — Hardware Specification

**Owner:** Hardware teammate
**Deadline:** Working cards in hand by **23 July** (evening). Exhibition is **25 July**.
**Budget:** ~₹1,500
**Status of dependencies:** This document is self-contained. You do **not** need to wait for the software team to start. Read "Interface Contract" below — that is the only thing the two halves share, and it is already frozen.

---

## 1. What this project is (context you need)

LifeScan is an emergency medical ID system. If someone is unconscious after a road accident, a paramedic scans a card the victim carries and instantly sees their blood group, allergies, and implants — then, with authorisation, their full medical record.

Your job is **the card**. It is not decorative. It is the part that makes the whole system work when there is no internet, no signal, and the patient's phone is destroyed — which is the normal condition at a roadside accident in India.

### The design principle you are building to

**Three layers of redundancy, each of which works when the layer below it fails.**

| Layer | Technology | Works when... |
|---|---|---|
| 1. Printed text | Ink on plastic | Everything else has failed. No phone, no power, no signal. |
| 2. Printed QR code | Any camera phone | The phone has no NFC chip, or NFC is off. |
| 3. NFC chip | Tap against phone | Normal case — fastest, one tap, no aiming a camera. |

Most teams build only the QR. The printed layer is what an actual emergency physician will notice, because at 3am in a trauma bay nobody wants to unlock a phone. Do not skip it.

---

## 2. Shopping list

| Item | Spec | Qty | Approx cost (India) |
|---|---|---|---|
| NFC tags | **NTAG216** — 888 bytes user memory. See warning below. | 20 | ₹40–80 each → ~₹1,200 |
| Blank PVC cards | Standard credit-card size, 85.6 × 54 mm | 20 | ~₹100 |
| Sticker printing | Glossy vinyl, card-size + small round stickers | 1 sheet | ~₹200 |
| Android phone with NFC | Borrowed is fine. Needed for *writing* tags. | 1 | — |
| "NFC Tools" app | Free, Play Store, by wakdev | — | Free |

### ⚠️ Critical: tag type

| Tag | User memory | Verdict |
|---|---|---|
| NTAG213 | 144 bytes | **Usable but limited** — fits Layer-0 data only. Acceptable fallback. |
| NTAG215 | 504 bytes | Fine. |
| **NTAG216** | **888 bytes** | **Buy this.** Most headroom. |

Sellers frequently mislabel these. When the tags arrive, **verify with NFC Tools → Read → check the "Tag type" and "Data capacity" fields** before ordering more. If you receive NTAG213, the project still works — tell the software team and they will drop the optional second record (see §4).

### Form factors to produce

| Form | Qty | Why |
|---|---|---|
| Wallet card | 10 | Primary. What judges will hold. |
| Helmet sticker | 4 | Two-wheeler riders are the actual accident demographic in India. Strong visual for the pitch. |
| Keychain fob | 3 | Shows the system isn't tied to one object. |
| Phone-case sticker | 3 | Same. |

---

## 3. Interface Contract — the only thing shared with the software team

**This format is frozen. Build against it starting today. Do not wait for the app to be finished.**

Each tag holds an NDEF message. NDEF is just the standard format NFC tags use to store data — NFC Tools handles it for you; you never write raw bytes.

### Record 1 — URI record (REQUIRED)

```
https://life-scan-web.vercel.app/s/<id>#0|1|<name>|<blood>|<allergies>|<flags>|<contact>
```

**✅ LIVE TEST PAYLOAD — the app is deployed, use this exact string today:**

```
https://life-scan-web.vercel.app/s/demo01#0|1|Ramesh%20Kumar|O+|Penicillin,Sulfa|PACEMAKER|+919876543210
```

Open that URL in a browser right now to see what a successful tap should
produce. The card data is everything after the `#`.

Field meanings (you don't need to generate these — software supplies the final string — but understanding them helps you debug):

| Position | Field | Example |
|---|---|---|
| 1 | Format marker | `0` (tier zero) |
| 2 | Version | `1` |
| 3 | Name | `Ramesh%20Kumar` (spaces as `%20`) |
| 4 | Blood group | `O+` |
| 5 | Allergies, comma-separated | `Penicillin,Sulfa` |
| 6 | Flags | `PACEMAKER`, `DNR`, or `-` |
| 7 | Emergency contact | `+919876543210` |

**Why the `#`:** everything after `#` in a URL is called the *fragment*, and browsers never send it to the server. The medical data therefore reaches the phone but never reaches anyone's server logs. This is a genuine privacy property and worth mentioning if a judge asks you about the card.

**Size:** keep the whole URL under **220 characters**.

### Record 2 — external record (OPTIONAL — skip unless you have spare time)

Type: `lifescan.app:enc` — contains encrypted full-record data, supplied by software as a hex string.

**This is genuinely optional.** Reading the encrypted record always requires an internet connection anyway (the authorisation happens over the network), so there is no offline benefit to storing it on the tag. If it does not fit, or NFC Tools makes it awkward, **drop it and lose nothing.** Only Record 1 matters.

---

## 4. Tasks, in order

### Task 1 — Verify your tags (30 min, do first)
1. Install **NFC Tools** on an Android phone.
2. Open → **READ** tab → tap a blank tag.
3. Confirm: tag type is NTAG216 (or 215/213), and note the writable capacity.
4. Report the actual type to the team. This determines whether Record 2 is possible.

### Task 2 — Write your first tag with the dummy payload (30 min)
1. NFC Tools → **WRITE** tab → **Add a record** → **URL/URI**.
2. Paste the test URL from §3 exactly.
3. **Write** → hold the tag to the phone until it confirms.
4. Go back to **READ** and verify the URL came back byte-identical.
5. Tap the tag with a *different* phone — the browser should open the URL. It will show an error page (the site doesn't exist yet). **That is expected and correct.** You are testing the tap, not the page.

### Task 3 — Card design and printing (3–4 hours)

**Front — the printed layer.** Must be readable by a human with no device, in bad light, in a hurry.

```
┌──────────────────────────────────────┐
│  🔴 LIFESCAN  EMERGENCY MEDICAL ID   │
│                                      │
│  RAMESH KUMAR                        │
│                                      │
│  BLOOD GROUP        O+          ← biggest text on the card
│  ALLERGIC TO        PENICILLIN       │
│  IMPLANT            PACEMAKER        │
│                                      │
│  ICE  +91 98765 43210                │
│  TAP OR SCAN REVERSE FOR FULL RECORD │
└──────────────────────────────────────┘
```

Design rules:
- **Blood group is the largest element on the card.** Bigger than the name. It is the single most time-critical fact.
- High contrast only — black on white, red accents. No gradients, no light grey text.
- Red cross or equivalent medical symbol top-left so it's identifiable at a glance in a wallet.
- "ICE" = In Case of Emergency, a convention paramedics already recognise.

**Back — the scannable layer.**
- QR code encoding **the same URL** as Record 1. Generate at any QR generator; use high error correction (level H) so it still scans when scratched or bloodied.
- Minimum QR size **25 × 25 mm**. Smaller fails on cheap phone cameras.
- Small text: "NFC enabled — tap phone here" with an arrow to where the chip sits.

**Assembly:** print the design on vinyl sticker sheet, stick to a blank PVC card, and stick the NFC tag to the inside/back. Or use pre-printable NFC PVC cards if your print shop supports them.

### Task 4 — ⚠️ THE OFFLINE TAP TEST (blocking — do by 21 July)

**This is the one task that can hurt the project if left late.** The opening 15 seconds of our demo is: phone in airplane mode → tap card → medical data appears. That depends on Android opening a locally-cached web app from an NFC tap while offline, and that behaviour varies by phone and Android version.

**✅ UNBLOCKED — the app is live, you can run this test now.**

1. On the test phone, open **https://life-scan-web.vercel.app** in Chrome.
2. Menu → **Install app** / **Add to Home screen**.
3. **Open the installed app once, while online**, and tap "Open a demo card".
   This is what primes the offline cache — skipping it makes the test fail
   for reasons that have nothing to do with your tag.
4. **Turn on airplane mode.** Confirm the airplane icon is showing.
5. Tap the NFC card.
6. **Does the app open and show the medical data?**

The status pill at the top right should read **"Offline · working"** in green.
That is the app telling you it knows it has no network and does not care.

| Result | What to do |
|---|---|
| App opens offline with content | Perfect. Demo confirmed. Document which phone. |
| Browser opens but shows offline error | Software-side service-worker config issue. Report immediately — it is fixable, but only with lead time. |
| Nothing happens at all | NFC off, or tag written wrong. Re-check Task 2. |

**Fallback if it stays flaky:** demo with the page already open in the browser and let the tap navigate within the cached scope. Slightly less dramatic, still fully offline. Decide this by 22 July, not on demo day.

### Task 5 — Multi-device test matrix (1 hour)

Test **read** on as many phones as you can borrow. Judges may tap with their own phone; you must know what happens.

| Phone | NFC read | QR scan | Notes |
|---|---|---|---|
| Android (yours) | | | |
| Android (other) | | | |
| iPhone XS or newer | | | iPhones read NDEF URLs with no app — confirm it works |
| iPhone (older) | | | May not read. QR is the fallback — verify. |
| Budget Android | | | Cheap cameras struggle with small QR — verify size |

Note: **writing** tags is easiest on Android. iPhones read fine but are awkward for writing. Do all writing on Android.

### Task 6 — Final tag write (23 July, ~30 min)

Software hands you the real URL(s). Rewrite all 20 tags with NFC Tools. Verify each one by reading it back. Then re-run Task 4 once on the final URL.

### Task 7 — Optional polish if you have spare time
- Lock the tags read-only in NFC Tools (**Other → Make read-only**). ⚠️ **Irreversible.** Only do this after final write, and leave at least 3 tags writable in case of a last-minute change.
- Make one deliberately damaged card (scratched, marked) to demonstrate the printed layer still works — this is a strong live moment if a judge asks about durability.
- A small acrylic or card stand to display the cards at your table.

---

## 5. Definition of done

- [ ] Tag type verified and reported to the team
- [ ] 20 tags written and each verified by read-back
- [ ] Cards printed: blood group is the largest element; QR ≥ 25 mm, error correction H
- [ ] **Airplane-mode tap tested and working — confirmed by 21 July**
- [ ] Test matrix filled in for ≥ 4 phones including at least one iPhone
- [ ] 3 tags left writable as spares
- [ ] All four form factors produced (card, helmet sticker, keychain, phone sticker)

---

## 6. Questions to send back to the software team

- ~~What is the test PWA URL for Task 4?~~ **Answered:** `https://life-scan-web.vercel.app` — live now, nothing blocking you.
- Final per-patient URLs for Task 6? (needed 23 July — the domain will not change, only the `/s/<id>` and the fragment)
- Do you want Record 2 (encrypted blob) on the tag, and if so what hex string? (optional — confirm whether to skip)
- Should the printed card show a real person's name or an obvious demo persona?

### Report back after Task 4

This is the one result the software side is waiting on. Send:

- Phone model + Android version
- Did the app install to the home screen? (yes / no)
- Did the airplane-mode tap show medical data? (yes / no)
- If no — what appeared instead? (browser error page / nothing / blank app)

---

## 7. Notes for an AI assistant helping with this task

This document is complete and self-contained; the payload format in §3 is frozen and must not be redesigned. Constraints worth restating if you are advising on this build:

- The target is a **physical NFC card**, not an app. NTAG21x passive tags, written via NDEF using the NFC Tools Android app. No microcontroller, no battery, no soldering, no ESP32 — those were considered and deliberately excluded from scope.
- **Offline operation is the whole point.** Any suggestion that requires network access at scan time defeats the design. The plaintext tier is intentional, mirrors how medic-alert bracelets have worked for decades, and is not a security oversight.
- Keep Record 1 under 220 characters.
- Record 2 is optional and should be dropped if it complicates anything.
- The highest-risk item is Task 4 (offline tap into an installed PWA). Prioritise de-risking that over polish.
