# Incident: concurrent logins by the same user could collide and fail

## Status

Resolved and verified.

## Summary

`createRefreshToken` signed a JWT from a payload with no per-issuance
unique claim: `{ id, email, role, tenantId }` plus the JWT library's own
`iat`/`exp` (both second-resolution). `RefreshTokenRepository.create`
stores a hash of that signed JWT string under a **unique** DB constraint
(`RefreshToken.tokenHash`).

Two logins for the same user within the same second produce an identical
payload and identical `iat`, and therefore a byte-identical signed JWT —
which collides on that unique constraint. The second (and any subsequent
same-second) login failed with a `409 RESOURCE_ALREADY_EXISTS`, surfaced
to the client as a failed login.

This is a real availability bug independent of load testing: it would
reproduce any time the same user logs in twice within one second — two
browser tabs, a mobile client's automatic retry, a password manager's
autofill-and-submit racing a manual submit.

## How it surfaced

Load-testing at 10 concurrent VUs against a single seeded user (see
`load-test/seed.ts`) reproduced it almost every request (~87% failure) —
concurrent VUs on a tight iteration loop land requests within the same
second far more often than real traffic would, which is exactly why this
kind of bug is easy to miss without load testing but trivial for it to
expose. At 1 VU, requests are naturally spaced far enough apart that the
same-second collision essentially never occurs, which is why the smoke
test (1 VU) never caught it.

Diagnosis path: added temporary status/body logging to
`load-test/transfer-flow.js`'s `authenticate()`, reran at 10 VUs, and the
logged response body named the exact constraint (`RefreshToken.tokenHash`)
— no guessing required once the actual error was visible instead of just
a pass/fail check.

## Fix

`createRefreshToken` (`src/auth/jwt.service.ts`) now includes a `jti`
(JWT ID) claim — a random UUID generated per call — in the signed payload.
`jti` is the JWT spec's standard claim for exactly this purpose: a
per-issuance unique identifier, independent of payload contents or
timing resolution. This guarantees every issued refresh token is unique
regardless of how many logins happen in the same second.

`createAccessToken` was deliberately left unchanged — access tokens aren't
stored under a uniqueness constraint (they're stateless bearer
credentials), so two logins in the same second producing equivalent access
tokens is harmless.

## Follow-up

- Worth a regression test: two logins for the same user fired concurrently
  (e.g. `Promise.all`) should both succeed with distinct refresh tokens.
  Nothing in the existing suite exercises concurrent logins for the same
  user.
- This is now covered end-to-end by `load-test/transfer-flow.js` at
  concurrency, but a fast, deterministic unit/integration test is cheaper
  to run in CI than relying on a load test to catch a regression here.
