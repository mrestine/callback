-- One-time backfill: events.occurred_at and contacts.last_contact_at picked
-- via the old date-only UI (before the timezone fix) were stored as UTC
-- midnight of the intended date instead of local midnight. Displayed with
-- toLocaleDateString() (timezone-aware), UTC midnight renders as the
-- PREVIOUS calendar day for any US timezone.
--
-- This corrects affected rows by reinterpreting their (correct) calendar
-- date as America/New_York local midnight instead of UTC midnight. Postgres's
-- AT TIME ZONE handles DST correctly per-date.
--
-- Covers both source='manual' events (the date-only UI bug) and source='ai'
-- events (the extraction pipeline hit the same bug on a bare-date model
-- output — now fixed in api/_inbound.ts's add_event), plus all affected
-- contacts.last_contact_at (always manual).
--
-- Naturally idempotent: once corrected, occurred_at's time-of-day is no
-- longer exactly 00:00:00, so the WHERE clause won't match it again on a
-- second run. Safe to re-run.
--
-- Apply with: psql "$DATABASE_URL" -f scripts/backfill-utc-midnight-dates.sql
-- (npm run db:apply only runs schema.sql — this is a one-time script, not
-- part of the standing schema, so it isn't wired into that tool. If you
-- don't have psql, use scripts/backfill-utc-midnight-dates.mjs instead.)

begin;

update events
set occurred_at = (occurred_at::date)::timestamp at time zone 'America/New_York'
where source in ('manual', 'ai') and occurred_at::time = '00:00:00';

update contacts
set last_contact_at = (last_contact_at::date)::timestamp at time zone 'America/New_York'
where last_contact_at::time = '00:00:00';

commit;
