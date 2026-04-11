# Claude Code Kickoff — HO3 Build

Use **ultrathink** mode for this entire job. Permissions are bypassed in the terminal. Do not ask me for confirmation on anything you can do yourself. Only stop and ask when you genuinely cannot proceed without a secret, credential, or human-only action (like clicking a button in a web UI that has no API).

## Phase 0 — Tear Down The Old Cultivate App

Before building anything new, fully decommission the existing Cultivate community app. Do all of this yourself:

1. **GitHub:** Find the existing Cultivate repo. Archive it (don't delete, in case we want to reference it later). Create a brand new empty repo named `ho3` for this project.
2. **Vercel:** Find the Cultivate project. Delete it. Free up the `cultivate.shaqhardy.com` domain so it's no longer attached to anything. Create a new Vercel project linked to the new `ho3` GitHub repo.
3. **Supabase:** Find the Cultivate Supabase project. Delete it entirely. Create a new Supabase project named `ho3`.
4. **DNS:** The `cultivate.shaqhardy.com` CNAME at Squarespace can stay or be removed, your call. For HO3, create a new CNAME for `ho3.shaqhardy.com` pointing to Vercel. If you cannot access Squarespace via API, this is one of the few things you'll need to ask me to do manually, give me the exact record to add.

If you need credentials for GitHub, Vercel, or Supabase that aren't already in my environment, ask me once for all of them at the start so I can paste them in one batch.

## Phase 1 — Build HO3

Read the full project brief at the path I'll give you (`ho3-project-brief.md`). Execute all 14 build steps in order. Do not skip steps. Do not ask me to approve each step, just build.

For OCR, use the Anthropic Claude API with vision (model `claude-sonnet-4-6`). My API key will be in the env vars.

For Plaid, my banks are already connected on the Plaid side. You'll need my Plaid client ID, secret, and the existing access tokens. Ask for them when you get to step 4.

When you finish a major milestone (Phase 0 complete, auth working, Plaid syncing, Plan view live, full deploy), give me a one-paragraph status update and keep going. Don't wait for me to say continue.

## What I Want At The End

A fully deployed working app at `ho3.shaqhardy.com` with both user accounts created (mine and my wife's), Plaid pulling real transactions, the Plan view operational, and the debt module ready to accept its first statement upload. I'll test it and prompt for changes after.

Begin with Phase 0. Use ultrathink. Go.
