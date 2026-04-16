export type TxStatus =
  | { phase: "idle" }
  | { phase: "pending"; signature: string }
  | { phase: "confirmed"; signature: string }
  | { phase: "failed"; signature?: string; reason: string };

export type GameLifecycleState =
  | "waiting"
  | "joined"
  | "reveal"
  | "finished"
  | "cancelled";

export type WalletSession = {
  wallet: string;
  accessToken: string;
  sid: string;
};

export type GameSummary = {
  id: string;
  stakeSol: number;
  state: GameLifecycleState;
  createdAt: string;
  expiresAt: string;
};
