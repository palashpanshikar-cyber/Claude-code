# Security

## Reporting a vulnerability

Email **[SECURITY@YOURDOMAIN]**. Please don't open a public issue for anything
exploitable. We'll acknowledge within a few days.

## What's in place

| Area | Control |
|------|---------|
| Passwords | bcrypt, cost 10 |
| Sessions | JWT, 7-day expiry, `JWT_SECRET` required in production or the process refuses to boot |
| Brute force | 20 logins/15min and 10 registrations/hour per IP |
| Flooding | 600 requests/15min per IP globally; 60 uploads/hour and 20 quest submissions/day per **user** |
| Headers | helmet — nosniff, HSTS, frame-options, restrictive CSP, no `x-powered-by` |
| Input | zod on every request body and query string |
| SQL injection | Prisma parameterises everything; no raw SQL anywhere |
| Uploads | 10MB cap, MIME allowlist, 50MP decode ceiling, re-encoded through sharp |
| Metadata | EXIF stripped from all uploads, including GPS |
| Admin | `isAdmin` column set by hand; no endpoint grants it; admin routes 404 rather than 403 |
| Account deletion | Requires password re-entry, so a stolen token can't destroy an account |

## Decisions worth understanding

**Login timing is equalised.** An unknown email is compared against a dummy
bcrypt hash so it costs the same as a real one. Without this, an unknown account
returns in ~1ms and a real one in ~80ms, which is a reliable account-enumeration
oracle no matter how identical the response body is. There's a test for it.

**Uploads are throttled per user, not per IP.** A shared campus or office NAT
would otherwise let one person exhaust the budget for a whole building.

**Image decoding has a pixel ceiling, not just a size limit.** A 40KB PNG can
decode to gigabytes — the classic decompression bomb, and a file-size check does
nothing against it. Anything over 50MP is rejected outright rather than falling
through to the "store the original" path, because no phone camera produces that
and hostile input shouldn't get a fallback.

**Admin surfaces return 404, not 403.** A 403 confirms the endpoint exists and
tells an attacker what to go after.

**Photo deletion is queued, not inline.** Account deletion must not be able to
fail because object storage is having a bad day.

## Known gaps, accepted deliberately

These are choices, not oversights. Each is cheap to change if the reasoning
stops holding.

**Registration reveals whether an email is in use.** Returning 409 "email
already taken" is an enumeration vector. The alternative — accepting the
registration and sending a "you already have an account" email — needs an email
provider that doesn't exist yet, and produces a worse signup experience. Login
and password reset must *not* leak this; registration does.

**No token revocation.** JWTs are valid until they expire. A stolen token works
for up to 7 days. Adding a denylist means a Redis dependency and a lookup on
every request; worth it once there's something to steal, not before. Shortening
`JWT_EXPIRES_IN` is the cheap mitigation.

**No 2FA, no password-strength check beyond 8 characters.** Worth adding a
breached-password check (k-anonymity against Have I Been Pwned) before launch —
it's about 30 lines and catches the accounts most likely to be taken over.

**Local-disk storage serves photos with no authorisation.** Anyone with the URL
can fetch them. This only applies to the local dev fallback; with R2 configured
and `R2_PUBLIC_URL` unset, photos are served through presigned URLs that expire
in an hour. **Don't run local-disk storage in production.**

**Completions are readable by every signed-in user.** That's the product — it's
a social app — but it means any account can enumerate all completions. Rate
limiting is the only thing making bulk scraping inconvenient.

**`CORS_ORIGIN` defaults to `*`.** Fine while the only client is a native app
sending a Bearer token, since there are no cookies to steal. Lock it down before
any web client exists.

## Before you go to production

- [ ] Set a real `JWT_SECRET` (`openssl rand -hex 32`) — the app won't start without one
- [ ] Set `TRUST_PROXY=true` behind Railway/Render, or rate limiting keys every user into one bucket
- [ ] Configure R2 and leave `R2_PUBLIC_URL` blank unless the bucket is genuinely public
- [ ] Set `CORS_ORIGIN` to your actual origins
- [ ] Fill in the placeholders in `PRIVACY.md` and have it reviewed
- [ ] Run `npm audit` — it should be clean; keep it that way
