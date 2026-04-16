"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl
} from "@solana/web3.js";
import { fetchOpenGames } from "../lib/api";
import { GameLifecycleState, TxStatus } from "../lib/types";

type View = "lobby" | "create" | "room" | "history" | "arcade";
type UserSession = { username?: string; email?: string; wallet?: string; provider: "local" | "wallet" };
type Network = "devnet" | "testnet" | "mainnet-beta";

type PieceType = "k" | "q" | "r" | "b" | "n" | "p";
type Piece = { type: PieceType; color: "w" | "b" } | null;
type Pos = { row: number; col: number };

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58: () => string };
  connect: () => Promise<{ publicKey: { toBase58: () => string } }>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
const pieceIcon: Record<string, string> = {
  wk: "\u2654", wq: "\u2655", wr: "\u2656", wb: "\u2657", wn: "\u2658", wp: "\u2659",
  bk: "\u265A", bq: "\u265B", br: "\u265C", bb: "\u265D", bn: "\u265E", bp: "\u265F"
};

const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

function defaultBoard(): Piece[][] {
  const e = null;
  return [
    [{ type: "r", color: "b" }, { type: "n", color: "b" }, { type: "b", color: "b" }, { type: "q", color: "b" }, { type: "k", color: "b" }, { type: "b", color: "b" }, { type: "n", color: "b" }, { type: "r", color: "b" }],
    Array(8).fill({ type: "p", color: "b" }) as Piece[],
    [e, e, e, e, e, e, e, e],
    [e, e, e, e, e, e, e, e],
    [e, e, e, e, e, e, e, e],
    [e, e, e, e, e, e, e, e],
    Array(8).fill({ type: "p", color: "w" }) as Piece[],
    [{ type: "r", color: "w" }, { type: "n", color: "w" }, { type: "b", color: "w" }, { type: "q", color: "w" }, { type: "k", color: "w" }, { type: "b", color: "w" }, { type: "n", color: "w" }, { type: "r", color: "w" }]
  ];
}

function pathClear(board: Piece[][], from: Pos, to: Pos) {
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  let r = from.row + dr;
  let c = from.col + dc;
  while (r !== to.row || c !== to.col) {
    if (board[r][c]) return false;
    r += dr;
    c += dc;
  }
  return true;
}

function legalMove(board: Piece[][], from: Pos, to: Pos, turn: "w" | "b") {
  if (!inBounds(to.row, to.col)) return false;
  const piece = board[from.row][from.col];
  const target = board[to.row][to.col];
  if (!piece || piece.color !== turn) return false;
  if (target && target.color === piece.color) return false;

  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);

  if (piece.type === "p") {
    const dir = piece.color === "w" ? -1 : 1;
    const start = piece.color === "w" ? 6 : 1;
    if (dc === 0 && !target && dr === dir) return true;
    if (dc === 0 && !target && from.row === start && dr === 2 * dir && !board[from.row + dir][from.col]) return true;
    if (adc === 1 && dr === dir && target && target.color !== piece.color) return true;
    return false;
  }

  if (piece.type === "n") return (adr === 1 && adc === 2) || (adr === 2 && adc === 1);
  if (piece.type === "k") return adr <= 1 && adc <= 1;
  if (piece.type === "b") return adr === adc && pathClear(board, from, to);
  if (piece.type === "r") return (dr === 0 || dc === 0) && pathClear(board, from, to);
  if (piece.type === "q") return (adr === adc || dr === 0 || dc === 0) && pathClear(board, from, to);
  return false;
}

function getProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as unknown as { solana?: PhantomProvider }).solana;
  if (provider?.isPhantom) return provider;
  return null;
}

export default function HomePage() {
  const [view, setView] = useState<View>("lobby");
  const [session, setSession] = useState<UserSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [walletAddress, setWalletAddress] = useState("");
  const [network, setNetwork] = useState<Network>("devnet");
  const [recipient, setRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("0.01");

  const [stake, setStake] = useState("0.1");
  const [gameState, setGameState] = useState<GameLifecycleState>("waiting");
  const [tx, setTx] = useState<TxStatus>({ phase: "idle" });
  const [gamesText, setGamesText] = useState("Load games to view lobby activity.");

  const [rpsChoice, setRpsChoice] = useState<"rock" | "paper" | "scissors" | "">("");
  const [rpsBot, setRpsBot] = useState<"rock" | "paper" | "scissors" | "">("");
  const [rpsResult, setRpsResult] = useState("Play a round.");
  const [rpsScore, setRpsScore] = useState({ you: 0, bot: 0 });

  const [board, setBoard] = useState<Piece[][]>(defaultBoard());
  const [turn, setTurn] = useState<"w" | "b">("w");
  const [selected, setSelected] = useState<Pos | null>(null);
  const [chessWinner, setChessWinner] = useState<"White" | "Black" | null>(null);

  async function loadSession() {
    const response = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (response.ok) {
      const body = await response.json();
      setSession(body.user as UserSession);
      return true;
    }

    return false;
  }

  useEffect(() => {
    (async () => {
      const ok = await loadSession();
      if (!ok) {
        const refreshed = await fetch(`${API_BASE}/auth/session/refresh`, {
          method: "POST",
          credentials: "include"
        });

        if (refreshed.ok) {
          await loadSession();
        }
      }

      const provider = getProvider();
      if (provider?.publicKey) {
        setWalletAddress(provider.publicKey.toBase58());
      }

      setAuthLoading(false);
    })();
  }, []);

  const explorer = useMemo(() => {
    if (tx.phase !== "confirmed" && tx.phase !== "pending") return undefined;
    const cluster = network === "mainnet-beta" ? "" : `?cluster=${network}`;
    return `https://explorer.solana.com/tx/${tx.signature}${cluster}`;
  }, [tx, network]);

  async function connectWallet() {
    try {
      const provider = getProvider();
      if (!provider) {
        setTx({ phase: "failed", reason: "Phantom wallet not found. Install Phantom extension first." });
        return;
      }
      const connected = await provider.connect();
      setWalletAddress(connected.publicKey.toBase58());
    } catch (error) {
      setTx({ phase: "failed", reason: error instanceof Error ? error.message : "Wallet connection failed" });
    }
  }

  async function disconnectWallet() {
    const provider = getProvider();
    if (!provider) return;
    await provider.disconnect();
    setWalletAddress("");
  }

  async function loadGames() {
    try {
      const games = await fetchOpenGames();
      setGamesText(JSON.stringify(games, null, 2));
    } catch (error) {
      setGamesText(error instanceof Error ? error.message : "Failed to fetch games");
    }
  }

  async function sendSol() {
    try {
      const provider = getProvider();
      if (!provider) {
        setTx({ phase: "failed", reason: "Phantom wallet not found." });
        return;
      }

      if (!walletAddress) {
        setTx({ phase: "failed", reason: "Connect your wallet first." });
        return;
      }

      const amountNum = Number(sendAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        setTx({ phase: "failed", reason: "Amount must be a positive number." });
        return;
      }

      const fromPubkey = new PublicKey(walletAddress);
      const toPubkey = new PublicKey(recipient.trim());
      const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT || clusterApiUrl(network);
      const connection = new Connection(endpoint, "confirmed");

      const txObj = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: Math.round(amountNum * LAMPORTS_PER_SOL)
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      txObj.recentBlockhash = blockhash;
      txObj.feePayer = fromPubkey;

      const send = await provider.signAndSendTransaction(txObj);
      setTx({ phase: "pending", signature: send.signature });

      await connection.confirmTransaction({ signature: send.signature, blockhash, lastValidBlockHeight }, "confirmed");
      setTx({ phase: "confirmed", signature: send.signature });
    } catch (error) {
      setTx({ phase: "failed", reason: error instanceof Error ? error.message : "Transaction failed" });
    }
  }

  function playRps(choice: "rock" | "paper" | "scissors") {
    const options: Array<"rock" | "paper" | "scissors"> = ["rock", "paper", "scissors"];
    const bot = options[Math.floor(Math.random() * 3)];
    setRpsChoice(choice);
    setRpsBot(bot);
    if (choice === bot) {
      setRpsResult("Draw round.");
      return;
    }
    const win =
      (choice === "rock" && bot === "scissors") ||
      (choice === "paper" && bot === "rock") ||
      (choice === "scissors" && bot === "paper");
    if (win) {
      setRpsResult("You win this round.");
      setRpsScore((s) => ({ ...s, you: s.you + 1 }));
    } else {
      setRpsResult("Bot wins this round.");
      setRpsScore((s) => ({ ...s, bot: s.bot + 1 }));
    }
  }

  function movePiece(to: Pos) {
    if (!selected || chessWinner) return;
    if (!legalMove(board, selected, to, turn)) {
      setSelected(null);
      return;
    }

    const next = board.map((row) => row.slice());
    const moving = next[selected.row][selected.col];
    const captured = next[to.row][to.col];
    next[to.row][to.col] = moving;
    next[selected.row][selected.col] = null;

    if (moving?.type === "p" && (to.row === 0 || to.row === 7)) {
      next[to.row][to.col] = { type: "q", color: moving.color };
    }

    if (captured?.type === "k") {
      setChessWinner(turn === "w" ? "White" : "Black");
    }

    setBoard(next);
    setTurn((t) => (t === "w" ? "b" : "w"));
    setSelected(null);
  }

  async function logout() {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
    setSession(null);
  }

  return (
    <main>
      <div className="app-hero">
        <Image src="/brand/wagerx-logo.png" alt="Wager X logo" width={72} height={72} className="hero-logo" />
        <div>
          <h1>Wager X</h1>
          <small>Trade. Wager. Win. Real Solana transfers + mini-game arena.</small>
        </div>
      </div>

      {authLoading && <section className="card" style={{ marginTop: 16 }}><p>Loading session...</p></section>}

      {!authLoading && !session && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Sign In Required</h3>
          <p>Use the login page to continue.</p>
          <Link href="/login" className="inline-link">Go to Login</Link>
        </section>
      )}

      {!authLoading && session && (
        <>
          <section className="card" style={{ marginTop: 16 }}>
            <p>
              Signed in as <strong>{session.username ?? session.wallet ?? "user"}</strong> ({session.provider})
            </p>
            <button onClick={logout}>Sign Out</button>
          </section>

          <div className="grid" style={{ marginTop: 16 }}>
            <button onClick={() => setView("lobby")}>Lobby</button>
            <button onClick={() => setView("create")}>Create Game</button>
            <button onClick={() => setView("room")}>Game Room</button>
            <button onClick={() => setView("history")}>History/Profile</button>
            <button onClick={() => setView("arcade")}>Mini Games</button>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <h3>Wallet</h3>
            <div className="grid">
              <div>
                <label>Connected Wallet</label>
                <input value={walletAddress} readOnly placeholder="Not connected" />
              </div>
              <div>
                <label>Network</label>
                <select value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
                  <option value="devnet">devnet</option>
                  <option value="testnet">testnet</option>
                  <option value="mainnet-beta">mainnet-beta</option>
                </select>
              </div>
            </div>
            <div className="grid">
              <button onClick={connectWallet}>Connect Phantom</button>
              <button onClick={disconnectWallet}>Disconnect</button>
            </div>
          </section>

          {view === "lobby" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3>Open Games</h3>
              <button onClick={loadGames}>Refresh Lobby</button>
              <pre style={{ overflow: "auto", whiteSpace: "pre-wrap" }}>{gamesText}</pre>
            </section>
          )}

          {view === "create" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3>Create / Send SOL</h3>
              <label>Stake (SOL)</label>
              <input value={stake} onChange={(event) => setStake(event.target.value)} />

              <label>Recipient Wallet</label>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient public key" />

              <label>Amount (SOL)</label>
              <input value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="0.01" />

              <button onClick={sendSol}>Send SOL Transaction</button>
            </section>
          )}

          {view === "room" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3>Game Room</h3>
              <p>State: <span className="state-pill">{gameState}</span></p>
              <div className="grid">
                <button onClick={() => setGameState("joined")}>Join</button>
                <button onClick={() => setGameState("reveal")}>Reveal</button>
                <button onClick={() => setGameState("finished")}>Claim Timeout Win</button>
                <button onClick={() => setGameState("cancelled")}>Cancel</button>
              </div>
            </section>
          )}

          {view === "history" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3>History/Profile</h3>
              <small>Track your confirmed transfers, sessions, and round outcomes.</small>
            </section>
          )}

          {view === "arcade" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3>Mini Games</h3>
              <div className="grid">
                <div className="card">
                  <h4>Rock Paper Scissors</h4>
                  <div className="grid">
                    <button onClick={() => playRps("rock")}>Rock</button>
                    <button onClick={() => playRps("paper")}>Paper</button>
                    <button onClick={() => playRps("scissors")}>Scissors</button>
                  </div>
                  <p>You: {rpsChoice || "-"} | Bot: {rpsBot || "-"}</p>
                  <p>{rpsResult}</p>
                  <p>Score: You {rpsScore.you} - {rpsScore.bot} Bot</p>
                </div>

                <div className="card">
                  <h4>Mini Chess</h4>
                  <p>Turn: {turn === "w" ? "White" : "Black"}</p>
                  {chessWinner && <p>Winner: {chessWinner}</p>}
                  <div className="chess-board">
                    {board.map((row, r) =>
                      row.map((cell, c) => {
                        const isDark = (r + c) % 2 === 1;
                        const isSelected = selected?.row === r && selected?.col === c;
                        return (
                          <button
                            key={`${r}-${c}`}
                            className={`square ${isDark ? "dark" : "light"} ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              if (selected) {
                                movePiece({ row: r, col: c });
                              } else if (cell && cell.color === turn) {
                                setSelected({ row: r, col: c });
                              }
                            }}
                          >
                            {cell ? pieceIcon[`${cell.color}${cell.type}`] : ""}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button onClick={() => { setBoard(defaultBoard()); setTurn("w"); setSelected(null); setChessWinner(null); }}>
                      Reset Chess
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="card" style={{ marginTop: 16 }}>
            <h3>Transaction Status</h3>
            {tx.phase === "idle" && <p>No active transaction.</p>}
            {tx.phase === "pending" && <p>Transaction pending confirmation.</p>}
            {tx.phase === "confirmed" && <p>Transaction confirmed on-chain.</p>}
            {tx.phase === "failed" && <p>Transaction failed: {tx.reason}</p>}
            {explorer && (
              <p>Explorer: <a href={explorer} target="_blank" rel="noreferrer">{explorer}</a></p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
