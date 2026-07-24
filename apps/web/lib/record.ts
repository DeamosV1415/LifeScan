/**
 * The Tier-1 clinical record — the full record that sits behind break-glass.
 *
 * This is what gets AES-encrypted client-side and split across the Guardians.
 * It never travels in the clear and never touches the chain; only its key is
 * split, and only its access is logged.
 */

export interface Medication {
  name: string;
  dose: string;
  frequency: string;
}

export interface Tier1Record {
  name: string;
  dob: string;
  bloodGroup: string;
  conditions: string[];
  medications: Medication[];
  allergies: { substance: string; reaction: string; severity: string }[];
  implants: { type: string; model?: string; implanted?: string }[];
  emergencyContacts: { name: string; relation: string; phone: string }[];
  insurance?: { provider: string; policyNo: string; sumInsured?: string };
  notes?: string;
}

/**
 * The seeded demo patient. This is the persona from the deck — kept because it
 * is well constructed: the warfarin + head-trauma interaction is what makes the
 * agent's contraindication alert land in the demo.
 */
export const DEMO_PATIENT_ID = "ramesh-kumar-1989";

export const DEMO_RECORD: Tier1Record = {
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
  insurance: { provider: "Star Health", policyNo: "SH-4471-99213", sumInsured: "₹5,00,000" },
  notes: "Anticoagulated — high bleeding risk. Confirm pacemaker before any MRI.",
};
