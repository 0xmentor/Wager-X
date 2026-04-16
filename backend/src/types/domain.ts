export type WalletSession = {
  id: string;
  wallet: string;
  refreshTokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
};

export type GameSummary = {
  id: string;
  stakeSol: number;
  state: "waiting" | "joined" | "reveal" | "finished" | "cancelled";
  createdAt: string;
  expiresAt: string;
};

export type GameLiveState = {
  state: GameSummary["state"];
  txStatus: "idle" | "pending" | "confirmed" | "failed";
  revealDeadline?: string;
  winnerWallet?: string;
};
