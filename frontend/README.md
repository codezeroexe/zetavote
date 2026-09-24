# ZetaVote frontend

This folder contains the local React + Vite frontend for the ZetaVote secure voting system.

## Local development

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Frontend runs on:
- `http://localhost:5173`

Backend runs on:
- `http://localhost:8080`

## Backend proxy

Use the Vite dev server proxy so browser requests hit the backend without CORS issues:

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

## Required screens

1. Admin: create election, close election, tally
2. Voter: register voter, cast vote, show receipt
3. Verification: verify ballot commitment and result summary

## API routes to implement

- `POST /api/elections`
- `POST /api/elections/{id}/register`
- `POST /api/elections/{id}/vote`
- `GET /api/elections/{id}/verify/{commitment}`
- `POST /api/elections/{id}/close`
- `POST /api/elections/{id}/tally`
- `GET /api/elections/{id}/results`
- `GET /health`

## Frontend checklist

See [frontend/checklist.md](./checklist.md) for the task list.

See [frontend/PLAN.md](./PLAN.md) for the implementation plan.
