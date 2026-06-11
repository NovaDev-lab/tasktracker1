## Task Tracker with Excel Export

A login-protected app where each signed-in user adds tasks (person name, task, deadline), sees their list, and can download a live `.xlsx` of their tasks.

### Auth
- Enable Lovable Cloud.
- Email/password + Google sign-in (Google via Lovable's managed broker; I'll call `configure_social_auth` for Google).
- A `/auth` page (sign in / sign up tabs + "Continue with Google").
- Protected app routes under `_authenticated/`.

### Data model
- `tasks` table: `id`, `user_id` (auth.users), `person_name`, `task`, `deadline` (date), `created_at`.
- RLS: each user can only select/insert/update/delete their own rows.
- Standard public-schema GRANTs for `authenticated` + `service_role`.

### Pages
- `/auth` — login / signup.
- `/` (protected) — Task tracker:
  - Form: Person name, Task, Deadline → "Add task".
  - Table of the user's tasks (sortable by deadline), with delete button.
  - "Download Excel" button → downloads `tasks.xlsx` containing the user's current tasks.

### Excel export
- Add `exceljs` dependency (Worker-compatible, pure JS).
- `createServerFn` `exportTasksXlsx` with `requireSupabaseAuth`: queries the user's tasks, builds an `.xlsx` workbook with columns Person / Task / Deadline / Created, returns base64 bytes + filename.
- Client decodes and triggers a browser download (`tasks.xlsx`).
- (The sheet is generated fresh on each click, so it's always "updated".)

### UI
- Clean shadcn UI: Card containing the form, Table for the list, top bar with user email + Sign out + Download Excel.
- Toasts for add/delete/download success and errors.
- Zod validation on the form (non-empty name/task, valid future-or-today date optional).

### Technical notes
- TanStack Start server functions for all DB writes/reads (via `requireSupabaseAuth`, RLS-scoped).
- Browser Supabase client only for auth flows + session.
- Root `onAuthStateChange` wired to invalidate router/queries on sign-in/out.
- No Supabase Edge Functions; no external Excel/Sheets account needed.
