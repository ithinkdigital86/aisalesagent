-- supabase/migrations/0002_icp_offer_and_single_active.sql
-- The ICP is now authored from the UI, so it carries the offer description the
-- Content Creator writes from, and "active" means exactly one profile per
-- workspace rather than a flag that happened to default to true.

alter table icp_profiles
  add column if not exists offer text;

comment on column icp_profiles.offer is
  'What we sell, in the workspace owner''s own words. Fed to the Content Creator.';

-- Existing rows all defaulted to active. Keep the most recently updated one per
-- workspace so the unique index below can be created without a manual cleanup.
update icp_profiles p
   set active = false
 where p.active
   and exists (
     select 1 from icp_profiles other
      where other.workspace_id = p.workspace_id
        and other.active
        and (other.updated_at, other.id) > (p.updated_at, p.id)
   );

create unique index if not exists icp_profiles_one_active_idx
  on icp_profiles (workspace_id) where active;
