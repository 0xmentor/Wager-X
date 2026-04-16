# Solana P2P Betting MVP

This repository follows the decision-complete MVP plan in `PLAN.md` with a launch path of `devnet -> mainnet`.

## Structure
- `contracts/`: Anchor program for non-custodial escrow game logic.
- `backend/`: Fastify + PostgreSQL + Redis services for auth, matchmaking/discovery, sessions, and realtime updates.
- `frontend/`: Next.js mobile-first client with wallet session + game lifecycle UX.
- `infra/`: Deployment and local orchestration assets.

## Contract Scope
Implemented account model and instruction surface:
- Accounts: `Game`, `Vault PDA`, `Treasury PDA`
- Instructions: `create_game`, `join_game`, `reveal`, `claim_timeout_win`, `cancel_game`
- State machine: `Waiting -> Joined -> Reveal -> Finished | Cancelled`
- Fee model: 2% treasury cut; draw refunds without fee

## Backend APIs
Implemented routes:
- `POST /auth/nonce`
- `POST /auth/verify`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /games`
- `POST /games/:id/join-intent`
- `GET /games/open`
- `GET /games/:id`
- `GET /me/sessions`
- `DELETE /me/sessions/:id`
- WebSocket channels: `/ws/lobby`, `/ws/game/:id`

## Security/Hardening Included
- Wallet signature auth with nonce challenge
- Rotating refresh tokens with server-side revocation
- Per-route and per-IP rate limiting
- Strict CORS allowlist
- Request schema validation using `zod`
- Basic geoblock middleware via `x-country-code`

## Database Setup
Run schema:
```bash
psql "$DATABASE_URL" -f backend/src/schema.sql
```

## Local Run
```bash
npm install
npm run dev
```

`npm run dev` automatically picks free ports (starting from backend `4000` and frontend `3000`) and wires frontend API calls to the selected backend port.  
Optional overrides: `BACKEND_PORT=4100 FRONTEND_PORT=3100 npm run dev`

Or run docker stack:
```bash
docker compose -f infra/docker-compose.yml up --build
```

## Deploy On Render
This repo includes a Render Blueprint file: [render.yaml](C:\Users\ALLOWZ\OneDrive\Desktop\crypto app\render.yaml)

1. Push this repo to GitHub.
2. In Render dashboard, click `New +` -> `Blueprint`.
3. Select your repo and deploy.
4. After first deploy, set required env values:
   - Backend `CORS_ORIGINS` = your frontend Render URL (for example `https://wagerx-frontend.onrender.com`)
   - Frontend `NEXT_PUBLIC_API_BASE` = your backend Render URL (for example `https://wagerx-backend.onrender.com`)
   - Frontend `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = Google OAuth Web client id (optional, needed for Google sign-in)
   - Frontend `NEXT_PUBLIC_SOLANA_RPC_ENDPOINT` (optional; if empty, app uses Solana cluster defaults)
5. Redeploy both services once env vars are set.

Notes:
- Backend auto-creates required PostgreSQL tables on startup.
- Redis is disabled by default (`USE_REDIS=false`) and in-memory store is used for nonce/session cache.
- SOL transfers require Phantom wallet in the user browser.
- Auth is cookie-based (httpOnly tokens set by backend); frontend no longer stores auth session in localStorage.
- For Render cross-site cookies, keep backend `AUTH_COOKIE_SAME_SITE=none` and HTTPS enabled.

## CI Gates
GitHub Actions pipeline runs:
- lint
- test
- build
- `npm audit --audit-level=critical`

## Pre-mainnet Checklist (to complete)
- 48h devnet soak test
- backup/restore drill pass
- contract + backend security checklist fully green
- staging signoff
- immutable release + rollback script verification
