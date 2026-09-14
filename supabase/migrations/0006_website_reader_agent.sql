-- supabase/migrations/0006_website_reader_agent.sql
-- The business profile form can now be drafted from the company's website.
-- The reader that does it is an agent like the others, so its runs, tokens
-- and failures land in agent_runs under their own slug. It writes nothing
-- else: what it drafts goes to the form as suggestions, and only a saved
-- form reaches business_profiles.

alter type agent_slug add value if not exists 'website_reader';
