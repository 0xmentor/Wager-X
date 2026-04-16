import { GameSummary } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export async function fetchOpenGames(): Promise<GameSummary[]> {
  const res = await fetch(`${API_BASE}/games/open?limit=20&offset=0`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load open games");
  }
  const json = await res.json();
  return json.items as GameSummary[];
}
