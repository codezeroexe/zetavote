# Frontend checklist

## 0. Project setup

- [ ] install frontend dependencies
- [ ] configure Vite dev server for local backend proxy
- [ ] confirm backend is running on `http://localhost:8080`
- [ ] confirm frontend runs on `http://localhost:5173`

## 1. App shell

- [ ] create top-level layout
- [ ] add admin / voter / verify navigation
- [ ] add backend status badge
- [ ] create shared card and form styling

## 2. Admin panel

- [ ] create election form
- [ ] validate required fields
- [ ] call `POST /api/elections`
- [ ] show success/error message
- [ ] list elections from backend
- [ ] close election flow
- [ ] tally election flow
- [ ] display results

## 3. Voter panel

- [ ] create registration form
- [ ] collect election id, voter id, passphrase
- [ ] call `POST /api/elections/{id}/register`
- [ ] display registration receipt
- [ ] create vote form
- [ ] collect candidate choice and vote nonce
- [ ] call `POST /api/elections/{id}/vote`
- [ ] show vote receipt and status

## 4. Verification panel

- [ ] input ballot commitment
- [ ] call verify endpoint
- [ ] show valid / invalid status
- [ ] display election metadata and timestamp
- [ ] show result summary after close/tally

## 5. Polish

- [ ] loading skeletons or spinners
- [ ] success/error banners
- [ ] empty states for no elections / no receipts
- [ ] validation for required fields
- [ ] responsive layout for tablet/mobile
- [ ] final smoke test for each major flow

## Completion gate

- [ ] all major frontend flows work with the live backend
- [ ] no direct cross-origin issues during local development
- [ ] README reflects running frontend and backend together
