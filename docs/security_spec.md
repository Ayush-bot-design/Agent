# Supabase-only security specification

## Trust boundaries

- The browser calls the Express API using relative URLs. It never receives a Supabase URL, anon key or service-role key.
- Supabase Auth verifies passwords and recovery tokens. The server exchanges a successful login for a 12-hour HMAC-signed application session. `SESSION_HMAC_SECRET` is mandatory (at least 32 characters).
- `public.profiles` is authoritative for application roles and sub-admin tabs. Every protected request re-reads the profile; deleting an account or revoking a tab takes effect on the next request. Email/username prefixes never grant administrator access.
- Supabase PostgreSQL stores sites, profiles, face templates, activity logs and document metadata. Custom SOP/permission files live in the private `system-documents` Storage bucket. Browser code receives short-lived signed object URLs, not permanent public links.
- All application tables and custom document objects are service-role-only. RLS is enabled and browser-role table privileges are revoked by the migrations.

## API invariants

1. Protected routes require a valid bearer session and an explicitly permitted role/tab. Unlisted API routes fail closed.
2. Profile updates bind identity to the authenticated caller; role and allowed tabs come from the authoritative profile, never the request body.
3. Only administrators may change roles/tabs. Sub-admins with provisioning permission may create/delete agents, not administrators or other sub-admins.
4. User creation creates a Supabase Auth account and its profile; profile failure compensates by removing the new Auth account. Deletion removes the Auth account, profile and biometric template.
5. Site claims require biometric verification. A conditional status update and the partial unique active-reservation index prevent competing claims and multiple active claims by one user. Coordinates never gate a claim.
6. Site completion revalidates ownership, hostname verification and required documents on the server.
7. Face templates and fingerprint lock metadata are stored in Supabase. Browser biometric caches are not an enrollment authority; enrollment writes must be acknowledged before becoming visible in the working mirror.
8. The database releases reservations after 24 hours. Its RPC is restricted to the service role; the server also runs a fallback sweep.
9. Authentication and general API endpoints are rate-limited. Database errors do not activate local JSON, seed data or password fallbacks.

## Deployment and recovery

Apply every migration in `supabase/migrations/` in filename order. The final additive migration adds attendance events, private document storage and the fingerprint uniqueness guard. Configure the server environment from `.env.example`, then explicitly bootstrap the first administrator using `npm run supabase:bootstrap`.

Password recovery uses Supabase email recovery and `APP_URL`. Synthetic `username@aether.local` addresses are not deliverable; those accounts require an administrator-assisted reset in Supabase Auth. The recovery email returns to the application with a short-lived Supabase recovery token, which is exchanged only at the password-update endpoint.

No legacy passwords, password hashes or HMAC secrets are imported into Supabase. Data snapshots can be imported with `npm run supabase:import` after provisioning the corresponding Auth accounts. Keep snapshots private and outside the repository.
