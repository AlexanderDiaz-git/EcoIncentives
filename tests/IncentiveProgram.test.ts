// IncentiveProgram.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Program {
  name: string;
  description: string;
  admin: string;
  budget: number;
  rewardPerUser: number;
  startBlock: number;
  endBlock: number;
  active: boolean;
  verifiedCount: number;
  totalParticipants: number;
  tags: string[];
  requiredCommitmentType: string;
}

interface Participant {
  commitment: string; // Simplified as string for mock
  joinBlock: number;
  verified: boolean;
  verificationBlock: number | null;
  rewardClaimed: boolean;
  proofSubmitted: boolean;
}

interface Proof {
  proofData: string; // Simplified
  submissionBlock: number;
  oracleVerified: boolean;
  verificationNotes: string | null;
}

interface RewardHistory {
  amount: number;
  claimBlock: number;
}

interface ContractState {
  programs: Map<number, Program>;
  participants: Map<string, Participant>; // Key: `${programId}-${user}`
  proofs: Map<string, Proof>; // Same key format
  rewardsHistory: Map<string, RewardHistory>; // Same key format
  paused: boolean;
  admin: string;
  programCounter: number;
  currentBlock: number; // Mock block height
}

// Mock contract implementation
class IncentiveProgramMock {
  private state: ContractState = {
    programs: new Map(),
    participants: new Map(),
    proofs: new Map(),
    rewardsHistory: new Map(),
    paused: false,
    admin: "deployer",
    programCounter: 0,
    currentBlock: 1000,
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_PROGRAM_NOT_FOUND = 101;
  private ERR_ALREADY_JOINED = 102;
  private ERR_NOT_VERIFIED = 103;
  private ERR_ALREADY_VERIFIED = 104;
  private ERR_INVALID_PROOF = 105;
  private ERR_PROGRAM_EXPIRED = 106;
  private ERR_INSUFFICIENT_BUDGET = 107;
  private ERR_INVALID_AMOUNT = 108;
  private ERR_NOT_ADMIN = 109;
  private ERR_PAUSED = 110;
  private ERR_INVALID_PARAM = 111;
  private ERR_ALREADY_EXISTS = 112;
  private ERR_NOT_STARTED = 113;

  private MAX_COMMITMENT_LEN = 256;
  private MAX_PROOF_LEN = 512;
  private MAX_TAGS = 10;

  // Simulate block increase
  advanceBlock(blocks: number = 1): void {
    this.state.currentBlock += blocks;
  }

  createProgram(
    caller: string,
    name: string,
    description: string,
    budget: number,
    rewardPerUser: number,
    durationBlocks: number,
    tags: string[],
    commitmentType: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (budget <= 0 || rewardPerUser <= 0 || durationBlocks <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (tags.length > this.MAX_TAGS) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    const newId = this.state.programCounter + 1;
    this.state.programs.set(newId, {
      name,
      description,
      admin: caller,
      budget,
      rewardPerUser,
      startBlock: this.state.currentBlock,
      endBlock: this.state.currentBlock + durationBlocks,
      active: true,
      verifiedCount: 0,
      totalParticipants: 0,
      tags,
      requiredCommitmentType: commitmentType,
    });
    this.state.programCounter = newId;
    return { ok: true, value: newId };
  }

  joinProgram(caller: string, programId: number, commitment: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const program = this.state.programs.get(programId);
    if (!program) {
      return { ok: false, value: this.ERR_PROGRAM_NOT_FOUND };
    }
    if (this.state.currentBlock < program.startBlock) {
      return { ok: false, value: this.ERR_NOT_STARTED };
    }
    if (this.state.currentBlock > program.endBlock) {
      return { ok: false, value: this.ERR_PROGRAM_EXPIRED };
    }
    if (!program.active) {
      return { ok: false, value: this.ERR_PROGRAM_NOT_FOUND };
    }
    const key = `${programId}-${caller}`;
    if (this.state.participants.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_JOINED };
    }
    if (commitment.length > this.MAX_COMMITMENT_LEN) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    this.state.participants.set(key, {
      commitment,
      joinBlock: this.state.currentBlock,
      verified: false,
      verificationBlock: null,
      rewardClaimed: false,
      proofSubmitted: false,
    });
    program.totalParticipants += 1;
    return { ok: true, value: true };
  }

  submitProof(caller: string, programId: number, proofData: string, notes: string | null): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const program = this.state.programs.get(programId);
    if (!program || this.state.currentBlock > program.endBlock || this.state.currentBlock < program.startBlock || !program.active) {
      return { ok: false, value: this.ERR_PROGRAM_NOT_FOUND }; // Simplified
    }
    const key = `${programId}-${caller}`;
    const participant = this.state.participants.get(key);
    if (!participant) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (participant.proofSubmitted) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (proofData.length > this.MAX_PROOF_LEN) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    this.state.proofs.set(key, {
      proofData,
      submissionBlock: this.state.currentBlock,
      oracleVerified: false,
      verificationNotes: notes,
    });
    participant.proofSubmitted = true;
    return { ok: true, value: true };
  }

  verifyProof(caller: string, programId: number, user: string, isValid: boolean, notes: string | null): ClarityResponse<boolean> {
    // Assume caller is oracle for mock
    if (caller !== "oracle") {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const key = `${programId}-${user}`;
    const proof = this.state.proofs.get(key);
    if (!proof) {
      return { ok: false, value: this.ERR_PROGRAM_NOT_FOUND }; // Simplified
    }
    if (proof.oracleVerified) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    proof.oracleVerified = isValid;
    proof.verificationNotes = notes;
    const participant = this.state.participants.get(key);
    if (participant) {
      participant.verified = isValid;
      participant.verificationBlock = isValid ? this.state.currentBlock : null;
    }
    const program = this.state.programs.get(programId);
    if (program && isValid) {
      program.verifiedCount += 1;
    }
    return { ok: isValid, value: isValid ? true : this.ERR_INVALID_PROOF };
  }

  claimReward(caller: string, programId: number): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const program = this.state.programs.get(programId);
    if (!program || this.state.currentBlock > program.endBlock || this.state.currentBlock < program.startBlock || !program.active) {
      return { ok: false, value: this.ERR_PROGRAM_NOT_FOUND }; // Simplified
    }
    const key = `${programId}-${caller}`;
    const participant = this.state.participants.get(key);
    if (!participant) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (!participant.verified) {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    if (participant.rewardClaimed) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (program.budget < program.rewardPerUser) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BUDGET };
    }
    participant.rewardClaimed = true;
    program.budget -= program.rewardPerUser;
    this.state.rewardsHistory.set(key, {
      amount: program.rewardPerUser,
      claimBlock: this.state.currentBlock,
    });
    return { ok: true, value: program.rewardPerUser };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  updateProgramBudget(caller: string, programId: number, newBudget: number): ClarityResponse<boolean> {
    const program = this.state.programs.get(programId);
    if (!program || program.admin !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newBudget <= program.budget) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    program.budget = newBudget;
    return { ok: true, value: true };
  }

  deactivateProgram(caller: string, programId: number): ClarityResponse<boolean> {
    const program = this.state.programs.get(programId);
    if (!program || program.admin !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    program.active = false;
    return { ok: true, value: true };
  }

  getProgramDetails(programId: number): ClarityResponse<Program | null> {
    return { ok: true, value: this.state.programs.get(programId) ?? null };
  }

  getParticipantStatus(programId: number, user: string): ClarityResponse<Participant | null> {
    const key = `${programId}-${user}`;
    return { ok: true, value: this.state.participants.get(key) ?? null };
  }

  getProofDetails(programId: number, user: string): ClarityResponse<Proof | null> {
    const key = `${programId}-${user}`;
    return { ok: true, value: this.state.proofs.get(key) ?? null };
  }

  getRewardHistory(programId: number, user: string): ClarityResponse<RewardHistory | null> {
    const key = `${programId}-${user}`;
    return { ok: true, value: this.state.rewardsHistory.get(key) ?? null };
  }

  getContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getProgramCount(): ClarityResponse<number> {
    return { ok: true, value: this.state.programCounter };
  }

  isUserVerified(programId: number, user: string): ClarityResponse<boolean> {
    const key = `${programId}-${user}`;
    return { ok: true, value: this.state.participants.get(key)?.verified ?? false };
  }

  calculateRemainingBudget(programId: number): ClarityResponse<number> {
    return { ok: true, value: this.state.programs.get(programId)?.budget ?? 0 };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  admin: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
  oracle: "oracle",
};

describe("IncentiveProgram Contract", () => {
  let contract: IncentiveProgramMock;

  beforeEach(() => {
    contract = new IncentiveProgramMock();
  });

  it("should create a new program", () => {
    const createResult = contract.createProgram(
      accounts.deployer,
      "Test Program",
      "Description",
      10000,
      100,
      1000,
      ["sustainable", "green"],
      "trees-planted"
    );
    expect(createResult).toEqual({ ok: true, value: 1 });

    const details = contract.getProgramDetails(1);
    expect(details.ok).toBe(true);
    expect(details.value).toEqual(
      expect.objectContaining({
        name: "Test Program",
        budget: 10000,
        rewardPerUser: 100,
        active: true,
      })
    );
  });

  it("should prevent program creation when paused", () => {
    contract.pauseContract(accounts.deployer);
    const createResult = contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      1000,
      10,
      100,
      [],
      "type"
    );
    expect(createResult).toEqual({ ok: false, value: 110 });
  });

  it("should allow user to join program", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    const joinResult = contract.joinProgram(accounts.user1, 1, "commitment-data");
    expect(joinResult).toEqual({ ok: true, value: true });

    const status = contract.getParticipantStatus(1, accounts.user1);
    expect(status.value).toEqual(
      expect.objectContaining({
        commitment: "commitment-data",
        verified: false,
      })
    );
  });

  it("should prevent duplicate joins", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    contract.joinProgram(accounts.user1, 1, "commit");
    const secondJoin = contract.joinProgram(accounts.user1, 1, "commit");
    expect(secondJoin).toEqual({ ok: false, value: 102 });
  });

  it("should allow proof submission", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    contract.joinProgram(accounts.user1, 1, "commit");
    const submitResult = contract.submitProof(accounts.user1, 1, "proof-data", "notes");
    expect(submitResult).toEqual({ ok: true, value: true });

    const proof = contract.getProofDetails(1, accounts.user1);
    expect(proof.value).toEqual(
      expect.objectContaining({
        proofData: "proof-data",
        oracleVerified: false,
      })
    );
  });

  it("should allow oracle to verify proof", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    contract.joinProgram(accounts.user1, 1, "commit");
    contract.submitProof(accounts.user1, 1, "proof", null);
    const verifyResult = contract.verifyProof(accounts.oracle, 1, accounts.user1, true, "valid");
    expect(verifyResult).toEqual({ ok: true, value: true });

    const status = contract.getParticipantStatus(1, accounts.user1);
    expect(status.value?.verified).toBe(true);
  });

  it("should allow reward claim after verification", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    contract.joinProgram(accounts.user1, 1, "commit");
    contract.submitProof(accounts.user1, 1, "proof", null);
    contract.verifyProof(accounts.oracle, 1, accounts.user1, true, null);
    const claimResult = contract.claimReward(accounts.user1, 1);
    expect(claimResult).toEqual({ ok: true, value: 100 });

    const history = contract.getRewardHistory(1, accounts.user1);
    expect(history.value?.amount).toBe(100);
    const remaining = contract.calculateRemainingBudget(1);
    expect(remaining.value).toBe(9900);
  });

  it("should prevent claim without verification", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    contract.joinProgram(accounts.user1, 1, "commit");
    const claimResult = contract.claimReward(accounts.user1, 1);
    expect(claimResult).toEqual({ ok: false, value: 103 });
  });

  it("should allow program deactivation", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    const deactivate = contract.deactivateProgram(accounts.deployer, 1);
    expect(deactivate).toEqual({ ok: true, value: true });

    const details = contract.getProgramDetails(1);
    expect(details.value?.active).toBe(false);
  });

  it("should prevent actions on expired programs", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      10,
      [],
      "type"
    );
    contract.advanceBlock(20);
    const joinResult = contract.joinProgram(accounts.user1, 1, "commit");
    expect(joinResult).toEqual({ ok: false, value: 106 });
  });

  it("should update program budget", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    const update = contract.updateProgramBudget(accounts.deployer, 1, 15000);
    expect(update).toEqual({ ok: true, value: true });

    const details = contract.getProgramDetails(1);
    expect(details.value?.budget).toBe(15000);
  });

  it("should prevent non-admin from updating budget", () => {
    contract.createProgram(
      accounts.deployer,
      "Test",
      "Desc",
      10000,
      100,
      1000,
      [],
      "type"
    );
    const update = contract.updateProgramBudget(accounts.user1, 1, 15000);
    expect(update).toEqual({ ok: false, value: 100 });
  });
});