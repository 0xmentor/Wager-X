CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS local_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id UUID PRIMARY KEY,
  wallet TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_listings (
  id UUID PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  stake_sol NUMERIC(20,9) NOT NULL,
  state TEXT NOT NULL,
  tx_status TEXT NOT NULL DEFAULT 'idle',
  winner_wallet TEXT,
  reveal_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS join_intents (
  game_id UUID NOT NULL REFERENCES game_listings(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  intent_nonce TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, wallet)
);
