import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { keccak256, toHex, getAddress } from "viem";

const PATIENT = keccak256(toHex("patient:ramesh-kumar-1989"));
const OTHER_PATIENT = keccak256(toHex("patient:someone-else"));
const CONTEXT = keccak256(toHex("male ~35, RTA, GCS 9, BP 90/60"));

const REASON_TRAUMA = 2;
const ACTION_TRIAGE = 1;

/**
 * Deploys the full system and wires the roles, mirroring scripts/deploy.ts.
 *
 * Accounts: 0 admin/deployer, 1 registered clinician, 2 unregistered clinician,
 * 3 patient, 4 the agent, 5 a human hospital approver.
 */
async function deployFixture() {
  const [admin, doctor, stranger, patient, agent, approver] = await hre.viem.getWalletClients();

  const registry = await hre.viem.deployContract("ProviderRegistry");
  const accessLog = await hre.viem.deployContract("EmergencyAccessLog", [registry.address]);
  const agentLog = await hre.viem.deployContract("AgentActionLog");
  const escrow = await hre.viem.deployContract("EmergencyEscrow", [agentLog.address]);

  await registry.write.registerProvider([
    doctor.account.address,
    "HFR-MP-GWL-0042",
    "Dr. Sharma, Gwalior Trauma Centre",
  ]);
  await agentLog.write.authorizeAgent([agent.account.address]);
  await escrow.write.addApprover([approver.account.address]);

  const as = async <T extends { address: `0x${string}` }>(
    contract: T,
    name: string,
    wallet: (typeof admin),
  ) => hre.viem.getContractAt(name as never, contract.address, { client: { wallet } });

  return { admin, doctor, stranger, patient, agent, approver, registry, accessLog, agentLog, escrow, as };
}

describe("ProviderRegistry", () => {
  it("registers a provider and reports it active", async () => {
    const { registry, doctor } = await loadFixture(deployFixture);

    expect(await registry.read.isActive([doctor.account.address])).to.equal(true);
    expect(await registry.read.providerCount()).to.equal(1n);

    const provider = await registry.read.getProvider([doctor.account.address]);
    expect(provider.hfrId).to.equal("HFR-MP-GWL-0042");
  });

  it("reports an unknown address as inactive", async () => {
    const { registry, stranger } = await loadFixture(deployFixture);
    expect(await registry.read.isActive([stranger.account.address])).to.equal(false);
  });

  it("refuses registration from a non-admin", async () => {
    const { registry, stranger, as } = await loadFixture(deployFixture);
    const asStranger = await as(registry, "ProviderRegistry", stranger);

    await expect(
      asStranger.write.registerProvider([stranger.account.address, "FAKE", "Fake Clinic"]),
    ).to.be.rejectedWith("NotAdmin");
  });

  it("refuses duplicate registration", async () => {
    const { registry, doctor } = await loadFixture(deployFixture);

    await expect(
      registry.write.registerProvider([doctor.account.address, "HFR-2", "Again"]),
    ).to.be.rejectedWith("AlreadyRegistered");
  });

  it("deactivates a revoked provider", async () => {
    const { registry, doctor } = await loadFixture(deployFixture);

    await registry.write.revokeProvider([doctor.account.address]);
    expect(await registry.read.isActive([doctor.account.address])).to.equal(false);
  });
});

describe("EmergencyAccessLog — break glass", () => {
  it("grants access to a registered provider and records it immutably", async () => {
    const { accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);

    expect(await accessLog.read.accessCount([PATIENT])).to.equal(1n);

    const history = await accessLog.read.getAccessHistory([PATIENT]);
    expect(getAddress(history[0].provider)).to.equal(getAddress(doctor.account.address));
    expect(history[0].reasonCode).to.equal(REASON_TRAUMA);
    expect(history[0].contextHash).to.equal(CONTEXT);
  });

  it("emits BreakGlassGranted — the event the agent and guardians watch", async () => {
    const { accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);

    const events = await accessLog.getEvents.BreakGlassGranted();
    expect(events).to.have.lengthOf(1);
    expect(events[0].args.patientHash).to.equal(PATIENT);
  });

  // ---- NEGATIVE CASE 1: the registry actually gates access ----
  it("REFUSES an unregistered provider", async () => {
    const { accessLog, stranger, as } = await loadFixture(deployFixture);
    const asStranger = await as(accessLog, "EmergencyAccessLog", stranger);

    await expect(
      asStranger.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]),
    ).to.be.rejectedWith("ProviderNotActive");

    expect(await accessLog.read.accessCount([PATIENT])).to.equal(0n);
  });

  it("REFUSES a provider after the registry revokes them", async () => {
    const { registry, accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await registry.write.revokeProvider([doctor.account.address]);

    await expect(
      asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]),
    ).to.be.rejectedWith("ProviderNotActive");
  });

  it("rejects an unknown reason code", async () => {
    const { accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await expect(
      asDoctor.write.requestBreakGlass([PATIENT, 77, CONTEXT]),
    ).to.be.rejectedWith("InvalidReasonCode");
  });
});

describe("EmergencyAccessLog — patient control", () => {
  async function withPatientOwning() {
    const fixture = await loadFixture(deployFixture);
    const asPatient = await fixture.as(fixture.accessLog, "EmergencyAccessLog", fixture.patient);
    await asPatient.write.registerPatient([PATIENT]);
    return { ...fixture, asPatient };
  }

  // ---- NEGATIVE CASE 2: the on-stage revoke moment ----
  it("REFUSES break glass on a frozen record", async () => {
    const { accessLog, doctor, asPatient, as } = await withPatientOwning();
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    // Works before the freeze...
    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);

    await asPatient.write.freezeRecord([PATIENT]);

    // ...and is refused by the chain after it.
    await expect(
      asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]),
    ).to.be.rejectedWith("RecordIsFrozen");

    expect(await accessLog.read.accessCount([PATIENT])).to.equal(1n);
  });

  it("keeps prior access records after a freeze — history is immutable", async () => {
    const { accessLog, doctor, asPatient, as } = await withPatientOwning();
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);
    await asPatient.write.freezeRecord([PATIENT]);

    const history = await accessLog.read.getAccessHistory([PATIENT]);
    expect(history).to.have.lengthOf(1);
  });

  it("lets the patient block one provider without freezing everything", async () => {
    const { accessLog, doctor, asPatient, as } = await withPatientOwning();
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asPatient.write.blockProvider([PATIENT, doctor.account.address]);

    await expect(
      asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]),
    ).to.be.rejectedWith("ProviderIsBlocked");

    // A different patient's record is unaffected.
    await asDoctor.write.requestBreakGlass([OTHER_PATIENT, REASON_TRAUMA, CONTEXT]);
    expect(await accessLog.read.accessCount([OTHER_PATIENT])).to.equal(1n);
  });

  it("refuses a freeze from anyone but the record owner", async () => {
    const { accessLog, doctor, as } = await withPatientOwning();
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await expect(asDoctor.write.freezeRecord([PATIENT])).to.be.rejectedWith("NotPatientOwner");
  });

  it("can be unfrozen by the patient", async () => {
    const { accessLog, doctor, asPatient, as } = await withPatientOwning();
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asPatient.write.freezeRecord([PATIENT]);
    await asPatient.write.unfreezeRecord([PATIENT]);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);
    expect(await accessLog.read.accessCount([PATIENT])).to.equal(1n);
  });

  it("refuses a second claim on an already-registered patient hash", async () => {
    const { asPatient } = await withPatientOwning();
    await expect(asPatient.write.registerPatient([PATIENT])).to.be.rejectedWith(
      "PatientAlreadyRegistered",
    );
  });
});

describe("EmergencyAccessLog — hasRecentGrant (the guardian's check)", () => {
  const WINDOW = 900n; // 15 minutes

  it("returns true immediately after a grant", async () => {
    const { accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);

    expect(
      await accessLog.read.hasRecentGrant([PATIENT, doctor.account.address, WINDOW]),
    ).to.equal(true);
  });

  it("returns false with no grant at all", async () => {
    const { accessLog, doctor } = await loadFixture(deployFixture);

    expect(
      await accessLog.read.hasRecentGrant([PATIENT, doctor.account.address, WINDOW]),
    ).to.equal(false);
  });

  it("expires — a stale grant does not unlock a record later", async () => {
    const { accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);
    await time.increase(Number(WINDOW) + 60);

    expect(
      await accessLog.read.hasRecentGrant([PATIENT, doctor.account.address, WINDOW]),
    ).to.equal(false);
  });

  it("returns false once the record is frozen, even with a fresh grant", async () => {
    // This is what makes the on-stage revoke real: guardians consult this
    // view, so a frozen record cannot be opened even if our servers lie.
    const { accessLog, doctor, patient, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);
    const asPatient = await as(accessLog, "EmergencyAccessLog", patient);

    await asPatient.write.registerPatient([PATIENT]);
    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);
    await asPatient.write.freezeRecord([PATIENT]);

    expect(
      await accessLog.read.hasRecentGrant([PATIENT, doctor.account.address, WINDOW]),
    ).to.equal(false);
  });

  it("returns false for a provider revoked from the registry after granting", async () => {
    const { registry, accessLog, doctor, as } = await loadFixture(deployFixture);
    const asDoctor = await as(accessLog, "EmergencyAccessLog", doctor);

    await asDoctor.write.requestBreakGlass([PATIENT, REASON_TRAUMA, CONTEXT]);
    await registry.write.revokeProvider([doctor.account.address]);

    expect(
      await accessLog.read.hasRecentGrant([PATIENT, doctor.account.address, WINDOW]),
    ).to.equal(false);
  });
});

describe("AgentActionLog", () => {
  it("lets an authorized agent anchor an action", async () => {
    const { agentLog, agent, as } = await loadFixture(deployFixture);
    const asAgent = await as(agentLog, "AgentActionLog", agent);
    const payload = toHex("warfarin + head trauma: ICH risk");

    await asAgent.write.logAction([PATIENT, ACTION_TRIAGE, keccak256(payload)]);

    expect(await agentLog.read.actionCount([PATIENT])).to.equal(1n);
    expect(await agentLog.read.verifyPayload([PATIENT, 0n, payload])).to.equal(true);
  });

  it("detects a payload that does not match what was anchored", async () => {
    const { agentLog, agent, as } = await loadFixture(deployFixture);
    const asAgent = await as(agentLog, "AgentActionLog", agent);

    await asAgent.write.logAction([PATIENT, ACTION_TRIAGE, keccak256(toHex("original"))]);

    expect(await agentLog.read.verifyPayload([PATIENT, 0n, toHex("revised")])).to.equal(false);
  });

  it("refuses an unauthorized address", async () => {
    const { agentLog, stranger, as } = await loadFixture(deployFixture);
    const asStranger = await as(agentLog, "AgentActionLog", stranger);

    await expect(
      asStranger.write.logAction([PATIENT, ACTION_TRIAGE, keccak256(toHex("x"))]),
    ).to.be.rejectedWith("NotAuthorizedAgent");
  });

  it("refuses an out-of-range action type", async () => {
    const { agentLog, agent, as } = await loadFixture(deployFixture);
    const asAgent = await as(agentLog, "AgentActionLog", agent);

    await expect(
      asAgent.write.logAction([PATIENT, 99, keccak256(toHex("x"))]),
    ).to.be.rejectedWith("InvalidActionType");
  });
});

describe("EmergencyEscrow — the agent/human boundary", () => {
  const PACKET = keccak256(toHex("preauth packet v1"));
  const AMOUNT = 50000n;

  async function withPreAuth() {
    const fixture = await loadFixture(deployFixture);
    const asAgent = await fixture.as(fixture.escrow, "EmergencyEscrow", fixture.agent);
    await asAgent.write.preparePreAuth([PATIENT, PACKET, AMOUNT]);
    return { ...fixture, asAgent };
  }

  it("lets the agent prepare a pre-auth packet", async () => {
    const { escrow } = await withPreAuth();

    expect(await escrow.read.preAuthCount()).to.equal(1n);

    const preAuth = await escrow.read.getPreAuth([0n]);
    expect(preAuth.packetHash).to.equal(PACKET);
    expect(preAuth.amount).to.equal(AMOUNT);
    expect(preAuth.released).to.equal(false);
  });

  // ---- The answer to "who is liable if the AI pays the wrong hospital?" ----
  it("REFUSES to let the agent release funds", async () => {
    const { asAgent } = await withPreAuth();

    await expect(asAgent.write.release([0n])).to.be.rejectedWith("AgentsCannotRelease");
  });

  it("REFUSES the agent even if it is mistakenly granted the approver role", async () => {
    // Defence in depth: the boundary must not depend on one access-control
    // line being configured correctly.
    const { escrow, agent, asAgent } = await withPreAuth();

    await escrow.write.addApprover([agent.account.address]);

    await expect(asAgent.write.release([0n])).to.be.rejectedWith("AgentsCannotRelease");
  });

  it("lets a human approver release", async () => {
    const { escrow, approver, as } = await withPreAuth();
    const asApprover = await as(escrow, "EmergencyEscrow", approver);

    await asApprover.write.release([0n]);

    const preAuth = await escrow.read.getPreAuth([0n]);
    expect(preAuth.released).to.equal(true);
    expect(getAddress(preAuth.releasedBy)).to.equal(getAddress(approver.account.address));
  });

  it("refuses a release from someone with no approver role", async () => {
    const { escrow, stranger, as } = await withPreAuth();
    const asStranger = await as(escrow, "EmergencyEscrow", stranger);

    await expect(asStranger.write.release([0n])).to.be.rejectedWith("NotHumanApprover");
  });

  it("refuses a double release", async () => {
    const { escrow, approver, as } = await withPreAuth();
    const asApprover = await as(escrow, "EmergencyEscrow", approver);

    await asApprover.write.release([0n]);
    await expect(asApprover.write.release([0n])).to.be.rejectedWith("AlreadyReleased");
  });

  it("refuses a pre-auth from a non-agent", async () => {
    const { escrow, stranger, as } = await loadFixture(deployFixture);
    const asStranger = await as(escrow, "EmergencyEscrow", stranger);

    await expect(
      asStranger.write.preparePreAuth([PATIENT, PACKET, AMOUNT]),
    ).to.be.rejectedWith("NotAuthorizedAgent");
  });
});
