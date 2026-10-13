-- supabase/migrations/0009_suppression_plain_unique_indexes.sql
-- Every suppression write since 0001 has failed. The three unique indexes on
-- suppression_list were partial (`where email is not null` and so on), and
-- every writer upserts with `on conflict (workspace_id, email)` or
-- `(workspace_id, phone)`. Postgres only uses a partial index as an arbiter
-- when the ON CONFLICT clause repeats its predicate, which PostgREST's
-- onConflict cannot express, so each upsert raised 42P10 ("there is no unique
-- or exclusion constraint matching the ON CONFLICT specification") and wrote
-- nothing. The callers did not check the error, so an unsubscribe, a hard
-- bounce or a complaint reported success and left the address sendable.
--
-- Plain indexes on the same columns enforce the same rule. NULLs are distinct
-- in a unique index, so any number of rows can still have a null email or a
-- null phone, which is what the partial predicate was there to allow. The
-- existing rows already satisfy these indexes, because the partial ones
-- enforced uniqueness over every non-null value.
--
-- The names are kept so nothing that refers to them has to change.

drop index if exists suppression_email_idx;
drop index if exists suppression_phone_idx;
drop index if exists suppression_domain_idx;

create unique index suppression_email_idx on suppression_list (workspace_id, email);
create unique index suppression_phone_idx on suppression_list (workspace_id, phone);
create unique index suppression_domain_idx on suppression_list (workspace_id, domain);
