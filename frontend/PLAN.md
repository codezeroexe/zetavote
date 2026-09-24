# Frontend plan

## Goal

Build a clean, local-first React + Vite UI for ZetaVote that drives the existing FastAPI backend without hiding the crypto workflow. The frontend should be split into clear panels for admin, voter, and verification tasks, with each step mapped directly to backend endpoints.

## Scope

### 1. Admin flows
- Create election
- View election status
- Close election
- Trigger tally
- Show results summary

### 2. Voter flows
- Register voter
- Unlock passphrase-protected key material
- Cast vote
- Receive ballot receipt

### 3. Verification flows
- Verify ballot commitment
- Check turnout and election status
- Review result summary

## Architecture

- React app runs locally in Vite on port 5173
- FastAPI backend runs on port 8080
- Browser calls should use relative `/api/...` paths via Vite proxy
- Sensitive crypto operations should stay on the backend when possible; browser UI acts as thin client for forms, receipts, and state

## Local integration pattern

### Dev setup
```bash
cd backend
python run.py
```

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Vite proxy
Add to `frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
```

This keeps the browser on `http://localhost:5173` while proxying `/api/*` traffic to the backend.

## Recommended screen structure

### Admin dashboard
- Election overview cards
- Create election form
- Close election form
- Tally output panel
- Results panel

### Voter dashboard
- Election selector
- Registration form
- Voter passphrase field
- Vote form with candidate list and nonce
- Receipt display

### Verification dashboard
- Ballot commitment lookup
- Verified / invalid status panel
- Result summary

## API mapping

| UI action | HTTP call |
|---|---|
| Create election | `POST /api/elections` |
| Register voter | `POST /api/elections/{id}/register` |
| Cast vote | `POST /api/elections/{id}/vote` |
| Verify ballot | `GET /api/elections/{id}/verify/{commitment}` |
| Close election | `POST /api/elections/{id}/close` |
| Tally results | `POST /api/elections/{id}/tally` |
| Show results | `GET /api/elections/{id}/results` |
| Health check | `GET /health` |

## Frontend state model

Keep local state simple:
- `electionList`
- `selectedElection`
- `voterRegistration`
- `voteForm`
- `verificationInput`
- `statusMessage`
- `errorMessage`

Use one request helper for all API calls:

```ts
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.detail ?? 'Request failed')
  }

  return payload as T
}
```

## Delivery plan

### Phase 1 — App shell
- [ ] landing layout
- [ ] admin / voter / verify tabs
- [ ] backend health indicator
- [ ] base styling

### Phase 2 — Admin panel
- [ ] create election form
- [ ] list elections
- [ ] close election action
- [ ] tally action

### Phase 3 — Voter panel
- [ ] voter registration form
- [ ] vote form
- [ ] receipt display
- [ ] duplicate-vote messaging

### Phase 4 — Verification panel
- [ ] commitment lookup
- [ ] status card
- [ ] result summary

### Phase 5 — Polish
- [ ] error banners
- [ ] loading states
- [ ] empty states
- [ ] form validation
- [ ] basic responsive layout

## Acceptance criteria

- Frontend can create, register, vote, verify, close, and tally via the backend
- All API calls use the existing backend contract without custom server-side fallback
- Vite proxy is configured for local development
- App stays readable on desktop and tablet widths
- User feedback is clear for loading, success, and failure states
