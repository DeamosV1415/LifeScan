/**
 * Tier-0 payload — the "medic-alert bracelet" data carried on the card itself.
 *
 * Wire format (URL fragment, so it never reaches a server):
 *   #0|1|<name>|<blood>|<allergies>|<flags>|<contact>
 *
 * Example:
 *   #0|1|Ramesh%20Kumar|O+|Penicillin,Sulfa|PACEMAKER|+919876543210
 *
 * This format is FROZEN — the hardware teammate writes tags against it.
 * See HARDWARE_SPEC.md §3. Do not change field order or add fields in the
 * middle; append only, and bump the version field.
 */

export const TIER0_VERSION = "1";

/** A field that is absent must never render as blank — see `MISSING`. */
export const MISSING = "NOT RECORDED" as const;

export interface Tier0 {
  name: string;
  bloodGroup: string;
  allergies: string[];
  flags: string[];
  emergencyContact: string;
  /** True when the fragment was well-formed and version-matched. */
  valid: boolean;
  /** Human-readable reason when `valid` is false. */
  error?: string;
}

const EMPTY_MARKERS = new Set(["", "-", "none", "null", "undefined"]);

function clean(raw: string | undefined): string {
  if (raw === undefined) return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding — fall back to the raw value rather than
    // throwing. Showing something slightly wrong beats showing nothing.
  }
  const trimmed = decoded.trim();
  return EMPTY_MARKERS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function list(raw: string | undefined): string[] {
  const value = clean(raw);
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse a Tier-0 fragment. Never throws — malformed input yields
 * `valid: false` with every field falling back to MISSING at render time.
 *
 * @param fragment the `location.hash`, with or without the leading '#'
 */
export function parseTier0(fragment: string): Tier0 {
  const blank: Tier0 = {
    name: "",
    bloodGroup: "",
    allergies: [],
    flags: [],
    emergencyContact: "",
    valid: false,
  };

  const body = (fragment ?? "").replace(/^#/, "");
  if (!body) {
    return { ...blank, error: "No medical data found on this card." };
  }

  const parts = body.split("|");
  if (parts[0] !== "0") {
    return { ...blank, error: "Unrecognised card format." };
  }
  if (parts[1] !== TIER0_VERSION) {
    return {
      ...blank,
      error: `Card uses format version ${parts[1] ?? "?"}; this app reads version ${TIER0_VERSION}.`,
    };
  }

  return {
    name: clean(parts[2]),
    bloodGroup: clean(parts[3]),
    allergies: list(parts[4]),
    flags: list(parts[5]),
    emergencyContact: clean(parts[6]),
    valid: true,
  };
}

/**
 * Build a Tier-0 fragment. Used by the patient app when issuing a card, and
 * by tests. Output is the string the hardware teammate writes to the tag.
 */
export function buildTier0(input: {
  name: string;
  bloodGroup: string;
  allergies: string[];
  flags: string[];
  emergencyContact: string;
}): string {
  const field = (value: string) => encodeURIComponent(value.trim()) || "-";
  const multi = (values: string[]) =>
    values.length ? values.map((v) => encodeURIComponent(v.trim())).join(",") : "-";

  return [
    "0",
    TIER0_VERSION,
    field(input.name),
    field(input.bloodGroup),
    multi(input.allergies),
    multi(input.flags),
    field(input.emergencyContact),
  ].join("|");
}

/** Flags we render with a specific icon and caution note. */
export const FLAG_LABELS: Record<string, { label: string; caution: string }> = {
  PACEMAKER: {
    label: "Cardiac pacemaker",
    caution: "No MRI. Caution with defibrillator pad placement.",
  },
  ICD: {
    label: "Implanted defibrillator",
    caution: "No MRI. Caution with external defibrillation.",
  },
  DNR: {
    label: "Do Not Resuscitate on file",
    caution: "Verify the signed directive before acting.",
  },
  INSULIN: { label: "Insulin dependent", caution: "Check blood glucose early." },
  ANTICOAGULANT: {
    label: "On anticoagulants",
    caution: "High bleeding risk. Avoid NSAIDs.",
  },
};
