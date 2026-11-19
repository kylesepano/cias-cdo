# CIAS

CIAS is a private office workspace for City Internal Audit Services, Cagayan de Oro. It uses React, Vite, TypeScript, Tailwind, shadcn-style components, Supabase Auth, PostgreSQL, Realtime, and FullCalendar. The office calendar uses Asia/Manila.

## Run locally

Use Node.js 24, npm, and Docker Desktop or Docker Engine 28 or later. Start Docker, then run:

```shell
npm ci
npm run supabase:start
npm run dev
```

Open [CIAS on this computer](http://127.0.0.1:5173). On startup Supabase applies pending migrations. The startup script verifies that the API and PostgreSQL are bound to loopback and writes the public frontend settings to the ignored `.env.local` file. The ports are 5173 for Vite, 56321 for the API, and 56322 for PostgreSQL. If the stack is already running and you add a migration, use `npm run supabase:migrate`. To stop the stack while retaining local records, run `npx --yes supabase@2.122.1 stop`. [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)

### Bootstrap and staff provisioning

The local workspace has an ignored roster at `scripts/roster.local`. In a fresh database, a trusted operator provisions it from a terminal. The script creates confirmed internal Auth identities and associated profiles. It creates the Superadmin first, skips existing profiles on subsequent runs, and preserves their passwords and roles.

```powershell
$ciasStatus = npx --yes supabase@2.122.1 status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $ciasStatus.API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $ciasStatus.SERVICE_ROLE_KEY
$env:CIAS_ROSTER_FILE = 'scripts/roster.local'
$env:CIAS_TEMP_PASSWORD = Read-Host 'Enter the local temporary password' -MaskInput
try {
  npm run provision
} finally {
  Remove-Item Env:CIAS_TEMP_PASSWORD, Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_URL, Env:CIAS_ROSTER_FILE
}
```

`-MaskInput` is available in PowerShell 7. Use an equivalent masked prompt or an approved secret store if using a different shell. The roster JSON is a list of objects with `username`, `full_name`, `designation`, and `access`. Supported access values are `superadmin`, `head`, `supervisor`, `admin`, `office_admin`, `lead`, and `auditor`. Use dummy personnel for a test or staging project.

The current local test roster skips the first-login password change. To apply the same setting when provisioning a fresh local test database, set `CIAS_SKIP_INITIAL_PASSWORD_CHANGE=1` for the provisioning command. The option also applies to already-provisioned accounts in that roster. Hosted provisioning requires the first-login password change.

| Office assignment | System role and capabilities |
| --- | --- |
| Superadmin | One active account. Manages accounts and audited settings. Private workspace access still requires membership. |
| Supervising Administrative Officer | Admin slot 1, with leave review. |
| Administrative Officer | Admin slot 2, with leave review. |
| CIAS Head | Employee with engagement and task creation, task review, leave review, and reports. |
| Lead Auditor | Employee with engagement and task creation and task review. |
| Administrative Staff | Employee with calendar and notice management, directory name updates, and reports. |
| Auditor | Employee with access to assigned work and shared office features. |

Sign-in uses normalized lowercase usernames in the app and confirmed username-based identities under the reserved `identity.cias.invalid` domain in Supabase. Protected modules require an active profile, a current Auth session, and completion of any required password change. The Admin and Superadmin limits are database-enforced. The Superadmin can provision, deactivate, reactivate, reset passwords, and revoke sessions under Administration. Account recovery is staff-assisted.

In **Administration → Add account**, enter the staff member’s first and last names. CIAS generates the username from the lowercase surname, joins the parts of a compound surname with hyphens, and adds a number if the username is already taken. The account function reads the initial password from the server-side `CIAS_NEW_ACCOUNT_PASSWORD` setting. Set it in `supabase/functions/.env` for local use or in Edge Function Secrets for a hosted project. The password must meet the project's Auth policy. The local Supabase stack also supports `CIAS_SKIP_NEW_ACCOUNT_PASSWORD_CHANGE=1` for test accounts added through the form. Hosted accounts added through the form require a change at first sign-in.

## Office workflows

- **Home page.** The calendar is the default page. Signed-out visitors see the three starter schedules and a compact staff sign-in. Staff see their events after sign-in and can open Dashboard from the sidebar. On either calendar, clear **Show recurring events** to display only one-time events.
- **Calendar.** Month, week, day and list views share the same bounded recurrence expansion. Office managers can import CSV using the in-app template and review duplicates before submitting. Short months skip dates that do not exist. February 29 birthdays appear in leap years. Editing or cancelling an individual date preserves the rest of the series. Changing a series start or recurrence pattern clears its prior exceptions, responses, and reminders. Reminder delivery uses the `cias-calendar-reminders` PostgreSQL cron job.
- **Leave.** Reviewers can approve or decline requests. An approved request adds an all-day block covering the inclusive start and end dates. The request reason remains visible to the requester and authorized reviewers.
- **Tasks and engagements.** Authorized users create engagements, choose members, and assign standalone or engagement tasks. Subtasks support up to eight levels, including the root. An assignee supplies the work completion date when submitting. An independent reviewer approves or returns the work, and CIAS records the approval date separately. Approved tasks appear in the accomplishment period that covers their work completion date. An engagement member must also be the task creator, assignee, or reviewer to see a particular task.
- **Communications.** Direct messages and private groups use persisted message history, cursor pagination, read states and Realtime. Group owners manage their groups. Announcements support acknowledgements and persisted in-app notifications.
- **Directory and reports.** Staff can opt in to sharing only the month and day of their birthday. In **Reports**, choose a reporting period, edit and save your own accomplishment draft, and download Annex A (monthly summary) or Annex B (dated activities) as a Word file. New drafts start with approved tasks you can see. Office CSV reports still require report permissions.
- **Prototype boundaries.** Attachments and document uploads are disabled. The private bucket denies client-side object access. The calendar supports editing one occurrence or the entire series. A split-series operation is outside the current prototype. The starter database contains the ten categories and three recurring office schedules. The integration tests load and remove a dummy Audit of HR workspace and sample tasks. Actual prior calendar records can be imported after the office supplies an approved CSV.

## Verify

```shell
npm test
npm run build
npm run test:api
npm run test:browser
npm run test:reports
```

The API tests require a running local stack and a fresh build. They create temporary fixture accounts, test live Auth, RLS, leave, task review and message delivery, and clean up afterward. The browser test requires the running Vite server and Microsoft Edge. Set `CIAS_BROWSER_CHANNEL=chrome` to use Chrome. Optional `CIAS_TEST_SCREENSHOTS` points to a folder for desktop and mobile screenshots using a dummy account.

The report browser test saves and reopens a private draft and verifies the two Word downloads. Set `CIAS_REPORT_QA_DIR` to retain the generated test documents in a chosen folder.

`npm run qa:office` exercises the local roster in Edge using forms, menus, and other browser controls. Set `CIAS_QA_PASSWORD` for the test roster. It leaves clearly labeled synthetic data in the two previous full months. `CIAS_QA_PHASE` can select individual checks, such as `calendar,reports`. Verified Word downloads go to the temporary output folder printed after the run.

The operator can run `node tests/local-roster.mjs` with `CIAS_ROSTER_FILE` and `CIAS_TEMP_PASSWORD` set. For a roster configured to skip the first-login password change, also set `CIAS_SKIP_INITIAL_PASSWORD_CHANGE=1`. The test verifies each local account's role and access to the protected calendar.

## Host on approved Supabase and Cloudflare Pages projects

1. Use a dedicated CIAS Supabase project and separate test project. Enable the email/password provider while turning off **Allow new users to sign up** and anonymous sign-ins. Enable email confirmation, set the hosted minimum password length to at least 12, and configure a short access-token lifetime. Review Auth and gateway rate limits and validate generic login errors against that exact project. The Edge Function additionally limits attempts per normalized username. [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
2. Link the project using the Supabase CLI. Apply the migrations with `supabase db push` and deploy `supabase functions deploy accounts --no-verify-jwt`. Login is a public entry point. Other operations validate the user through GoTrue and check the scoped profile before performing privileged changes. The Supabase runtime supplies its server-side connection settings. Enable and verify pg_cron and Realtime for the migrated tables. Check that the private bucket access policy is present. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
3. Provision dummy accounts first and verify username-only sign-in, confirmation, revocation, deactivation, and the disabled signup endpoint. For an approved hosted roster, set `CIAS_ALLOW_REMOTE=approved` and associate each row's `password_env` with a distinct temporary secret of at least 12 characters. The provisioning script rejects shared hosted credentials. Keep roster data and server keys in approved storage. [Supabase production security checklist](https://supabase.com/docs/guides/security/production-checklist)
4. In Cloudflare Pages, connect the private GitHub repository, use `npm run build`, and publish `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` for the intended environment. Use a staging Supabase project for previews. Set only the public frontend credentials in Pages. Test direct SPA links and redirects on the deployed address. [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)

## Operations before an office pilot

- Obtain the LGU IT and privacy approvals required by the specification. Complete the office privacy impact assessment and agree on hosting, access, records retention, incident response, and who can restore or export data. Keep audit evidence and confidential personnel records outside the prototype pending approval.
- Record the owners and review dates for Supabase and Cloudflare plans, quotas, and monitoring. Review provider terms and the plan’s backup and uptime coverage before relying on the service. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- Set an approved backup cadence and recovery objectives. Export PostgreSQL data with the supported Supabase database dump workflow over a trusted connection. Encrypt the backup with an office-controlled key, store it in approved off-site storage, and record the date and checksum. Test restoration to an isolated project, including Auth identities, profile roles, RLS, Realtime, cron, and private bucket configuration. Document the restore time and verify that restored sessions cannot be reused. Plan separate private object backups if attachments are later enabled. [Supabase database backup guidance](https://supabase.com/docs/guides/platform/backups)
- Periodically verify the Superadmin recovery procedure and revoke sessions promptly after access changes or a suspected incident. Review audit logs, failed-login rates, cron execution, database use, and Realtime and Edge Function limits.

