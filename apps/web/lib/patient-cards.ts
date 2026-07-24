import { useCallback, useEffect, useState } from "react";
import { buildTier0 } from "./tier0";
import { DEMO_FLAGS, DEMO_PATIENT_ID, DEMO_RECORD } from "./record";

/**
 * The one place that answers "which patient cards does this login have?".
 *
 * Every surface that lists patients — the /patient hub and the /patient/audit
 * selector — reads from here, so "the seeded demo patient plus your real cards"
 * is defined once. The demo card is synthesised from DEMO_RECORD (no hardcoded
 * literals scattered across pages) and always carries `demo: true` so the UI can
 * tag it. Real cards come from the email→cards index.
 */

export interface PatientCard {
  id: string;
  name: string;
  bloodGroup: string;
  /** Full Tier-0 card URL, when known (for Copy URL / preview). */
  url?: string;
  createdAt: number;
  /** True only for the seeded demo patient. */
  demo?: boolean;
}

/** The seeded demo patient as a card, with a previewable Tier-0 URL. */
export function demoCard(): PatientCard {
  const fragment = buildTier0({
    name: DEMO_RECORD.name,
    bloodGroup: DEMO_RECORD.bloodGroup,
    allergies: DEMO_RECORD.allergies.map((a) => a.substance),
    flags: DEMO_FLAGS,
    emergencyContact: DEMO_RECORD.emergencyContacts[0]?.phone ?? "",
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    id: DEMO_PATIENT_ID,
    name: DEMO_RECORD.name,
    bloodGroup: DEMO_RECORD.bloodGroup,
    url: origin ? `${origin}/s/${DEMO_PATIENT_ID}#${fragment}` : undefined,
    createdAt: 0,
    demo: true,
  };
}

/**
 * Returns the demo card followed by every card linked to `email`, newest first.
 * The fetch only overwrites state on a successful response, so a transient
 * server error still leaves at least the demo card visible.
 */
export function usePatientCards(email: string) {
  const [cards, setCards] = useState<PatientCard[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    const demo = demoCard();
    if (!email) {
      setCards([demo]);
      setLoading(false);
      return;
    }
    fetch(`/api/my-cards?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { cards?: PatientCard[] } | null) => {
        setCards([demo, ...(data?.cards ?? [])]);
      })
      .catch(() => setCards([demo]))
      .finally(() => setLoading(false));
  }, [email]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cards, loading, refresh };
}
