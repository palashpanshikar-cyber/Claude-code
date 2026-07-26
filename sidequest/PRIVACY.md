# SideQuest Privacy Policy

**Last updated:** 26 July 2026
**Applies to:** the SideQuest mobile app and API

> **Before you publish this:** the placeholders in `[SQUARE BRACKETS]` need your
> real details, and this needs review by someone qualified in your jurisdiction.
> It describes what the code in this repository actually does as of the date
> above — if you change what you collect, change this document in the same
> commit. A privacy policy that has drifted from the code is worse than none,
> because it is a statement you have made and are not honouring.

## Who we are

SideQuest is operated by [YOUR NAME OR COMPANY], [ADDRESS].
For anything in this policy, contact **[PRIVACY@YOURDOMAIN]**.

## What we collect

Everything below is collected because a specific feature needs it. Nothing is
collected "just in case".

### You give us this when you sign up

| Data | Why |
|------|-----|
| Email address | Logging in, and account-related mail we may need to send |
| Username and display name | Identifying you to other users |
| Password | Stored only as a bcrypt hash — we never hold the password itself and cannot recover it |
| Timezone | Streaks are counted in your local day, not ours. Without it, midnight would land in the wrong place |
| City *(optional)* | Showing quests near you. Free text you type, **not** a GPS reading |

### You give us this when you use the app

| Data | Why |
|------|-----|
| Quest completion photos | The completion itself — a quest log is a photo |
| Reviews and star ratings | Shown on the quest so others know what it's like |
| Which quests you completed and when | Your profile grid and your streak |
| Daily mini completions and any notes | Same |
| Quests you submit | Reviewing them before they go in the feed |

### We work this out from your activity

- Current and longest streak, and the last day you were active
- When a streak breaks and how long it was — we use this in aggregate to
  understand where people drop off

### We do not collect

- **Precise location.** No GPS, no background location, no location permission.
- **Photo metadata.** Every uploaded photo is re-encoded before storage and
  **all EXIF data is stripped, including GPS coordinates**. Only image
  orientation is preserved, and it's baked into the pixels rather than kept as
  a tag. The photo you upload from a specific place does not carry that place
  with it.
- Your contacts, calendar, microphone, or health data.
- Advertising identifiers. There are no ad networks and no third-party
  analytics SDKs in the app.

## Who can see what

Be aware of this before you post — it is the part people usually get wrong.

- **Visible to any signed-in SideQuest user:** your username, display name,
  profile photo, city, streak counts, and every completion you log — photo,
  review, rating and date.
- **Visible only to you:** your email address, your timezone, quests you
  submitted that are still pending review, and your streak-break history.
- **Visible to nobody, ever:** your password. We hold a bcrypt hash and cannot
  reverse it.

There is currently no way to make an individual completion private. If you don't
want something seen, don't log it, or delete it afterwards.

## Where your data is held

- **Database:** PostgreSQL, hosted by [YOUR HOST — e.g. Railway / Render], in
  [REGION].
- **Photos:** Cloudflare R2, in [REGION].

Both are processors acting on our instructions. We don't sell your data, and we
don't share it with anyone for their own purposes.

## How long we keep it

We keep your data until you delete your account. When you do:

- Your account, completions, mini history, streak history and follows are
  deleted from the database **immediately**.
- Your photos are queued and removed from storage by a cleanup job, normally
  **within an hour**. They go on a queue rather than being deleted in the same
  breath so that deletion still works if storage is temporarily unreachable —
  your account going away must never depend on a third party being up.
- **Quests you submitted that were approved stay in the feed**, with your name
  removed. Once other people are part-way through a quest, removing it takes
  something away from them; the quest text is no longer linked to you.

Server logs containing IP addresses are kept for up to [30] days for security
and debugging.

## Your rights

Two of these are self-serve in the app — no email, no waiting:

- **Get a copy of your data** — `GET /me/export` returns everything we hold
  about you as JSON, built from the same rows the app itself reads.
- **Delete your account** — `DELETE /me`, confirmed with your password.
- **Correct your data** — edit your display name, city and timezone in the app.
- **Object or complain** — write to [PRIVACY@YOURDOMAIN]. If you're in the UK or
  EEA you can also complain to your data protection authority.

Depending on where you live you may have further rights under the GDPR, UK GDPR,
CCPA or local law. Ask and we'll honour them.

Our lawful basis under GDPR is **contract** (we cannot run the app without your
account data) and **legitimate interest** (keeping the service secure and
understanding aggregate drop-off).

## Security

- Passwords are hashed with bcrypt. We cannot see them.
- The API is served over HTTPS.
- Sign-in and account creation are rate limited to make brute force impractical.
- Uploads are size- and dimension-capped and re-encoded before storage.

No system is perfectly secure, and we will not claim otherwise. If you find a
vulnerability, please report it — see `SECURITY.md`.

## Children

SideQuest is not for children under 13 (under 16 in the EEA, where local law
requires it). We don't knowingly collect data from them. If you believe a child
has an account, contact us and we'll remove it.

## Push notifications

We do not currently send push notifications. When we do, we'll hold a device
token for that purpose, and this policy will be updated before that ships.

## Quest safety

Quests are suggestions, not instructions. Some involve being outdoors, in water,
or in unfamiliar places. **Use your judgement — your safety is your own
responsibility**, and completing a quest is never worth getting hurt for.

## Changes to this policy

If we change how we handle your data we'll update this page and, for anything
significant, tell you in the app before it takes effect.

## Contact

**[PRIVACY@YOURDOMAIN]** · [YOUR NAME OR COMPANY], [ADDRESS]
