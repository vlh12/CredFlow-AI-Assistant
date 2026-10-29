# CredFlow end to end project

## Setup on a new Windows laptop

For a source-only checkout on another laptop, follow [SETUP-WINDOWS.md](SETUP-WINDOWS.md).
It covers prerequisites, fresh Oracle schemas, private configuration, new RSA PEM
keys, scoped service identities, Kafka KRaft initialization, builds and verification.
The fresh-setup helpers refuse existing private runtime configuration and are not
an upgrade or password-reset procedure for an already configured installation.

CredFlow is a local training project connecting seller loan requests, marketplace submission, permissions, verification, eligibility, lender review, offers and audit history. The UI uses HTML, CSS and JavaScript. All CredFlow business and account data is stored in Oracle. Kafka delivers durable workflow events. Verification, financial providers and lenders are simulated; no money is disbursed or collected.

## Start and stop

The configured installation is `C:\innovation\CredFlow`. Start Oracle FREE / FREEPDB1, then run `start.cmd` and wait for all services and portals to report UP. Use `check.cmd` for health checks and `stop.cmd` to stop project-owned Java/Node processes while preserving Oracle and saved data. No PowerShell script execution-policy change is required.

| Portal | URL | Account type |
|---|---|---|
| Marketplace | http://localhost:5174 | Marketplace operator |
| Seller | http://localhost:5175 | Registered seller |
| All lenders / banks | http://localhost:5176 | Officer of any registered lender |
| Administrator | http://localhost:5178 | Administrator |

Backend ports: Application 8081, Consent 8082, Eligibility 8083, Orchestration 8084, Auth 8085, Audit 8086, Lender Integration 8087, external simulators 8090, Bank A 8091, NBFC B 8092 and Bank C 8093. Kafka uses 9092. The Node portal server is the active public gateway; the supplied Member 2 Java gateway is optional and is not started by the normal launcher.

Private runtime properties, signing keys, broker data and verification account records stay under `backend/runtime/private`. They are not public frontend assets. Preserve the configured private directory when moving the project. The launcher relocates local project paths. A source-only checkout still needs its own Oracle schemas, signing configuration and service identities; never publish local credentials.

## Roles and database-backed data

Every protected request validates authentication and ownership in the backend; separate ports alone do not provide authorization. Login uses Member 1 Auth and automatically issued RSA-signed JWTs. Browser login creates a server-held portal session with a random HttpOnly cookie. Refreshing the page restores that session until its fixed 15-minute expiry. Refresh and activity do not extend expiry. Sign out revokes the server session immediately; saved records remain in Oracle. Restarting the Node portal server also ends its sessions. No manual test tokens are required.

- Sellers register themselves, request a loan, grant/revoke permissions, track their own applications, correct eligible applications, respond to questions, review PDF terms, accept/decline offers and cancel eligible applications.
- Marketplace operators see only their marketplace's sellers, requests and applications. They enter source business history. Human operators cannot manually create applications; the backend submits after the seller requests a loan and permits initial sharing.
- Each lender officer sees only applications assigned to its lender, records decisions and questions, attaches terms PDFs and creates offers.
- Administrators manage marketplaces, view accounts, monitor services and inspect authorized application audit history.
- Sellers edit their current contact details in My business profile. Other human roles edit their own email in My profile. These edits do not rewrite submitted application snapshots.

The frontend contains no fallback demo records. Empty database results remain empty; unavailable data is identified as unavailable. Requested and offered amounts are displayed separately, using the actual saved lender offer. A missing offer displays a dash. Writes persist before the UI reports success. Kafka status projections normally converge within a few seconds. Pages poll every five seconds, while open forms retain their input. There is one Refresh button at the top. Application timeline appears only in its Timeline tab.

## Complete loan workflow

1. The seller registers with an active marketplace and signs in at port 5175.
2. Marketplace staff enter the seller's three completed calendar months under Registered sellers > Business history. Explicit business-detail review supplies evidence to the local identity simulator; it is not real KYC. Missing months differ from zero-sales months.
3. The seller selects Apply for loan, reviews saved business details, enters amount/purpose/preferred tenure and declared income/expenses/debt, completes prototype KYC and authorizes initial sharing. The request and evidence are saved in Oracle.
4. The Auth-owned marketplace queue worker obtains a scoped Auth-issued identity from its registered service account and submits the immutable request through the gateway with a stable idempotency key. No private credentials-file entry is needed for a newly created marketplace. The application begins at DRAFT.
5. The seller grants operational consent and separate financial retrieval permission. Operational permission is application-specific; financial permission lasts 24 hours and is revision-specific.
6. Verification, authorized financial retrieval, Oracle PL/SQL aggregation and Java eligibility rules run. Missing/inconsistent data results in ACTION_REQUIRED rather than an invented result or automatic lender rejection.
7. A single eligible lender is selected by routing priority. The officer can request information, refer for review, reject or create an offer. Answers are forwarded to the same lender and acknowledged.
8. The lender supplies the offer amount, rate, tenure, fees, expiry and terms reference, and may optionally attach a terms PDF (maximum 5 MB). PDFs are immutable and bound to their offer/submission. For an existing active offer without a PDF, use Offers > Attach terms PDF.
9. The seller reviews the complete offer terms and expiry, optionally opens an attached PDF and accepts or declines. A PDF is not required for acceptance. Acceptance and lender acknowledgement are separate recorded outcomes. Offer acceptance ends this project's lending workflow.

The source financial history is immutable by version. Future requests use the latest saved history; earlier assessment snapshots remain unchanged. Marketplace-specific reference counters generate references such as VS-1001 or BB-2001 without changing stable seller UUIDs.

## Correct an application

A seller can use Correct application on an ACTION_REQUIRED application before lender dispatch. The request includes the displayed application revision and row version. Another seller, stale edits, changed idempotent retries and corrections after dispatch/closure are rejected.

The request is queued durably in `CF_APPLICATION.CF_APPLICATION_CORRECTIONS`, retaining before/after snapshots, actor and retry identity. The worker obtains the registered Application Service identity, asks Orchestration's revision guard for authorization, then atomically saves the new application revision and `application.revised` outbox event. Leases and stable operation IDs recover interrupted processing. Temporary connected-service failures remain visible as RETRY_PENDING. Authoritatively rejected corrections are shown as REJECTED without changing the application.

The Corrections tab shows queue progress. After APPLIED, verification and eligibility run for the new revision. Review Permissions and grant financial permission for that revision. If checks reached ACTION_REQUIRED while permission was absent, use Request financial refresh after granting it. Changing application details does not edit marketplace source history. A correction accepted before a simultaneous cancellation is reconciled without reopening the cancelled business workflow.

## Lender rules and routing

Lender portal > Lender rules lists and edits only that lender's product eligibility settings and activation. Routing priority is hidden from lender APIs and screens; only Admin > Routing priorities can reorder products, with a mandatory reason and atomic ordered move.

Saving requires the current version, a retry key and a change reason. A new immutable rule version and actor/reason record are committed with the product head. Stale updates return 409. Identical retries return their original version. History shows prior values. Evaluation uses only the latest version; deactivating it does not fall back to an older active version. Previously completed evaluations keep their recorded rule version.

## Marketplace management

Admin > Marketplaces supports create, view, edit, deactivate/reactivate and deletion of an unused marketplace. Creation atomically configures its organization, unique reference prefix, operator login and scoped submission service registration. IDs, usernames and prefixes stay fixed. Deactivation pauses new registrations and requests while keeping existing records accessible. Linked sellers or loan requests block deletion; deactivate such a marketplace instead. Record versions protect concurrent edits.

## Oracle setup and service identities

Apply the service-owned base schemas from the supplied Member 1/2/3 database folders first, then the additive project migrations in dependency order:

1. `database/organization-catalog.sql`
2. `database/seller-registration.sql`
3. `database/seller-loan-requests.sql`
4. `database/marketplace-business-history.sql`
5. `database/offer-terms-documents.sql`
6. `database/marketplace-management.sql`
7. `database/scope-completion.sql`
8. `database/phase0-alignment.sql`
9. `database/phase0-completion/01_financial_permission_checkpoint.sql` (adds the nullable financial-permission workflow checkpoint).
10. Create the dedicated CF_SIM_BANK_C user with your private password and run `database/bank-c-tables.sql`; provision its scoped identity with `backend/runtime/tools/ProvisionPhase0.java`. This installation is already configured.

Other existing Member 2 package/organization setup scripts may be needed when installing the original services from scratch. Review their prerequisites rather than executing training seed/reset scripts against an existing dataset. These migrations have already been applied on this configured computer.

The service base configuration requires the existing Auth clients for Consent, Eligibility, Orchestration, Integration and simulated lenders. Marketplace clients use the exact identity `marketplace-submission-<marketplace UUID>` and only `application.submit`. The Auth-owned queue worker issues their tokens internally from those registered identities. Older `marketplace-clients.properties` files may remain for compatibility but are not read by that worker.

Application corrections additionally use OAuth client `application-service`, role `APPLICATION_SERVICE` and only `workflow.revision`. After the scope migration, provision this identity with `backend/runtime/tools/ProvisionApplicationCorrections.java`, using the Oracle JDBC and Spring Security Crypto libraries on its Java classpath and the private runtime directory as its argument. The helper preserves existing matching credentials, rejects conflicting registrations, stores private configuration and prints no secret. The normal configured installation is already provisioned.

The registration/history integration uses explicitly limited same-Oracle grants for trusted seller mappings and local provider mappings. This is a recorded departure from the original strict schema-isolation proposal; service-owned workflow, offer, financial and audit tables remain authoritative. The browser never accesses Oracle directly.

## Verification

The regression scripts read the configured account aliases from private runtime properties. They never use hard-coded legacy integration usernames. Run from the configured root, using Node 24 or newer. In Command Prompt:

```bat
set CREDFLOW_ALLOW_WRITE_TEST=true
node tests/lender-rules.cjs
node tests/journey.cjs
node tests/missing-month.cjs
node tests/marketplace-history.cjs
```

These are opt-in write tests and create clearly labelled verification records. The journey test covers initial missing data, source correction, a new application revision, permission renewal, fresh checks, lender questions/answers, terms PDF upload/download, offer acceptance, lender acknowledgement, amount separation and audit. It leaves an accepted verification application. Missing-month and history tests cancel their test applications. Lender-rule verification restores the initial business values using new versions, preserving its change history. Reports and generated verification credentials remain in `backend/runtime/private/verification`.

Build/test commands and database-backed evidence are described in `tests/README.md`. Oracle integration tests gated by environment variables are not counted as executed merely because the test source exists. `check.cmd` confirms health, not every business scenario. The API additions are specified in `contracts/scope-completion.openapi.yaml` and the correction event example alongside it.

## Agreed scope changes

CredFlow - Phase 0 (3).pdf defines the loan workflow. The corrected development plan supplies supporting technical context. The user's later instructions extend or replace several technical defaults:

| Original planning default | Current agreed implementation |
|---|---|
| Optional minimal React screens | HTML/CSS/JavaScript portals on four role-specific ports |
| Keycloak proposal | Member 1 Auth with real automatic JWT issuance and scoped service identities |
| H2 simulator fixtures | Oracle for every running data store |
| One simulator process / one marketplace baseline | Supplied separate simulator applications and admin-managed marketplaces |
| Full admin/marketplace dashboards deferred | Requested role-specific dashboards, marketplace management and editable profiles |
| Actual uploads outside initial MVP | Requested Oracle-backed lender terms PDFs |

The core single-lender workflow, audit retention, immutable financial snapshots, permission checks, idempotency and version guards remain required. General deletion of submitted loan/audit records is not provided. Real KYC, credit-bureau checks, payments, disbursement, repayments, automatic fallback and parallel competing offers remain outside the project. Local forgot-password recovery is available through Mailpit as described below.

Eligibility rules are managed exclusively in each lender portal. Administrators cannot list, edit or read eligibility rule history. Routing priority is managed separately at Administrator > Routing priorities; lenders cannot see or submit a priority value. The backend filters products by the signed lenderId and rejects access to another lender's products. No database migration is needed for this ownership change.


## Local password recovery (Mailpit)

Start the project with start.cmd. Mailpit starts with the project on 127.0.0.1:8025 (inbox) and 127.0.0.1:1025 (SMTP); stop.cmd stops it. It captures local messages only, uses its own temporary inbox storage and has no external relay. A new Mailpit process starts a fresh inbox; account passwords and token hashes remain in Oracle. Mailpit uses its own temporary SQLite inbox internally; no CredFlow account or business persistence is moved out of Oracle.

On any portal choose Sign in > Forgot password?, enter a username, then open http://localhost:8025. Find the email addressed to the account's registered email (dummy addresses work), open its link, enter and confirm a new 12-72 character password and sign in through the assigned portal. Links expire after 15 minutes, are single-use and are replaced by a newer request. Unknown, disabled and machine accounts receive the same generic request receipt, without an email. Email/profile changes invalidate old reset links. Successful resets invalidate all remaining reset links for the account.

Apply database/password-recovery.sql once as the local Oracle administrator in FREEPDB1. This adds only CF_AUTH.CF_PASSWORD_RESET_TOKENS and CF_PASSWORD_RESET_LIMITS. Set credflow.recovery.enabled=true in backend/runtime/private/auth.properties for this local environment. Other environments default to disabled. No existing accounts, loans or rule values are reset by installation.

POST /api/v1/auth/forgot-password accepts {username}; POST /api/v1/auth/reset-password accepts {token,password,confirmPassword}. Both are available without a login through each portal's /api/proxy/auth path. Links use a fixed backend mapping of account role/lender to portal; request headers and submitted URLs cannot override it. Only SHA-256 token hashes are stored in Oracle. Plain tokens appear only in the captured email and reset form memory; the form removes the fragment from the address bar immediately.

Unknown usernames return 404 with "User does not exist"; inactive or unsupported accounts return 403. These responses intentionally disclose account availability for this local project. The inbox prompt appears only after a reset email is sent.

Limits: five requests per username and thirty per source address in a 15-minute window; thirty reset attempts per source address per window. Limits are persisted separately from the password-reset transaction. On this local installation all browser portals share the loopback backend address. HTTP 429 includes Retry-After: 900. Invalid/expired/used tokens and invalid input return 400; mail/database outages return safe 503 messages; unexpected failures return a safe 500 with a reference. Failed SMTP delivery rolls back token replacement so an existing link remains valid. Ambiguous network failures tell users to try signing in before retrying a reset.

Mailpit is a shared local test inbox: anyone with access to it can read reset links. It is bound to loopback and must not be exposed publicly. Password reset does not revoke previously issued stateless JWT access tokens; they remain valid until their normal expiry (currently 15 minutes). No automatic login occurs after recovery. Test with node tests/password-recovery.cjs after setting CREDFLOW_ALLOW_WRITE_TEST=true; the test creates its own clearly named seller account and never changes existing users' passwords.

Bundled tool: Mailpit v1.31.6, official axllent/mailpit Windows amd64 release, MIT license in backend/tools/mailpit/LICENSE. Archive SHA-256: 5d5ad094bfb3bac9004f9d1105d2335fea9f8952c09951df73ae0a280e34d3b1. Source: https://github.com/axllent/mailpit/releases/tag/v1.31.6.


## Governing Phase 0 workflow

The loan workflow follows CredFlow - Phase 0 (3).pdf, with one explicit presentation exception: application.status.changed remains hidden in the Audit history tab. The underlying status-change events and application timeline remain stored. Supporting marketplace/profile management, optional offer PDFs and local Mailpit recovery are retained by agreement. Keycloak is not required by this Phase 0 document; Member 1 Auth continues to issue actual signed JWTs.

The seller requests a loan in CredFlow, reviews prefilled business details, selects amount/purpose/preferred tenure and declares monthly income, expenses and existing debt repayments. Prototype KYC requires a fictional TEST document reference, correct-details acknowledgement, KYC terms acceptance and age 18 or above. Real Aadhaar/PAN checks, document verification, disbursement, repayments and servicing remain excluded. No document file upload is required for a loan request or acceptance; existing lender terms PDFs are optional supporting material.

A valid request creates a unique DRAFT application. It cannot proceed until mandatory KYC and operational consent are present. Granting consent moves it to SUBMITTED for authorised verification and financial-data checks. Marketplace-controlled synthetic history supplies three complete monthly records and a simulated credit-score band. Missing records, unavailable credit information or incomplete checks produce ACTION_REQUIRED, without a lender dispatch or automatic rejection. Marketplace staff can update their sellers' source history; seller-initiated refresh retrieves a fresh authorised source reference. New applications never silently substitute demo data.

Configured lender products for Bank A, NBFC B and Bank C evaluate business age, sales, returns, amount, purpose, credit-score band and repayment affordability. The assessment uses preferred tenure and the lender's versioned assessment APR to calculate a monthly repayment estimate. Disposable income is max(0, min(declared monthly income, average monthly marketplace payout) - monthly expenses - existing monthly debt repayments). The proposed repayment must fit the configured share of this amount. This is a prototype rule, not a real credit decision. Credit bands are POOR < FAIR < GOOD < EXCELLENT; missing credit information remains NOT_AVAILABLE and requests action. The selected lender receives only its own eligibility result and the relevant financial/verification summary. Prior snapshots and assessments are not rewritten when source history or rules change.

The router selects one eligible lender using routing priority and the existing deterministic tie break. No suitable product produces NOT_ELIGIBLE with recorded product reasons. A delivered application becomes UNDER_REVIEW. Assigned officers may approve, reject with a reason, request manual review or ask for information. Requested information produces ACTION_REQUIRED; the seller or staff of the owning marketplace can answer exactly those questions, which go to the same lender. Another marketplace or lender cannot read or answer them. Rejection and offer records include actor/time and lender reference. An approved decision is APPROVED; a complete offer includes amount, rate, tenure and expiry. A seller may accept or decline a live offer; expired/withdrawn offers cannot be accepted.

Only one active application is allowed per seller AND purpose. A different purpose may have its own active application. A duplicate purpose returns the existing application reference. Pending requests are also purpose-scoped, and an Oracle unique index protects the active-purpose invariant. A closed purpose may be requested again. Corrections are available only before dispatch on ACTION_REQUIRED applications; existing purpose stays fixed while details, requested amount, preferred tenure, KYC and declared finances can be corrected as a new revision.

Declined or withdrawn consent pauses the open application in ACTION_REQUIRED and blocks further sharing. A new explicit grant can resume the same application; after lender dispatch it retains the same lender submission. Financial permission has a separate 24-hour expiry; expired permission blocks retrieval until renewed. Manual refresh uses current workflow versions to prevent concurrent duplicate operations.

Bank C uses simulator port 8093 and the shared lender portal http://localhost:5176. Its officer username is bank.c.officer. The password is stored only in backend/runtime/private/runtime.properties as account.bank-c.password, with its schema settings under db.bank-c.*. Bank C uses the same real Auth token flow as the other officers. Admin cannot edit lender rules; each officer edits only their own institution's versioned policies.

Existing installations must apply database/phase0-alignment.sql before starting the updated services. Bank C's schema must exist with credentials matching the private settings; database/bank-c-tables.sql clones the empty simulator table structure from Bank A without copying its records. ProvisionPhase0.java registers the Bank C officer and scoped callback client without resetting existing identities. Start with start.cmd; stop with stop.cmd. Tests/phase0-flow.cjs runs the opt-in Oracle/Kafka journey across all three lenders and writes its report under backend/runtime/private/verification.

Bank C uses the account `bank.c.officer`. Its initial password is stored only as `account.bank-c.password` in the private `backend/runtime/private/runtime.properties` file. It can also use the existing local Mailpit password-recovery flow. Its machine client has only `lender.callback` scope; callback ownership still requires the exact Bank C client.


## Phase 0 exception and consent completion

Lender rejection codes are visible to the seller and owning marketplace; private reviewer notes stay private. Manual-review decisions require specific questions and create an Action required task. Answers are validated against those questions and sent to the same lender.

Financial permission is checked against Consent immediately before submission sharing, information responses and offer actions. Expiry or withdrawal pauses an open workflow. Renewal resumes the saved lender submission or restarts the checks before lender submission. Pending deliveries wait without cancelling the application or exhausting retries. Closed applications remain closed.

Financial permission grants, withdrawals and expiries use the Oracle outbox and Kafka for actor-attributed application audit history. A reconciliation worker fills missing historical consent entries from their stored original actor and time; it does not create sellers, loans or financial datasets. Application status changed remains hidden in the UI and retained in Oracle.

For existing installations, run the additive checkpoint migration in FREEPDB1 before starting the updated orchestration service. No account password or existing loan field is reset.

Verification on 22 October 2026: 385 automated checks passed, along with rollback-only Oracle diagnostics and live browser/API checks. All 11 services and four portals are running. Existing seller, account, loan and business-history records were preserved; no test loans or sellers were added. See `frontend/VERIFICATION.md` for verification scope.

Routing-priority ownership update (22 October 2026): administrator priority updates create a versioned Oracle rule snapshot while preserving every lender eligibility setting and allowed purpose. Lender rule saves retain the existing priority. Version checks prevent stale overwrites, and retry keys prevent duplicate saves. No schema migration or priority reset is required.


## Admin lender onboarding and shared lender portal (26 October 2026)

All bank/NBFC officers now sign in at http://localhost:5176. Marketplace remains 5174, Seller 5175 and Admin 5178. Ports 5177 and 5179 are no longer launched. Existing lender credentials and lender ownership checks remain valid.

Admin > Lenders / banks > Create lender creates an Oracle lender organization, unique code, BCrypt-protected officer login and inactive Business Loan product atomically. A reason is mandatory; creation is retry-safe. The new officer signs in at 5176, reviews Lender rules and activates the product when ready. Initial routing position is appended automatically; admin alone can change it. New lenders use the Bank A protocol on the shared local simulator, with cases and callbacks separated by lender code/ID. This is simulated lending, not an automatic real-bank API connection.

Admin > Routing priorities keeps the numeric field and mandatory reason. Positions range from 1 to the number of configured products. Moving a product shifts every intervening product by one position in one Oracle transaction, recording the admin, time and supplied reason for every affected version. Existing loan selections stay unchanged.

Apply database/lender-management.sql as the local Oracle administrator in FREEPDB1 before launching updated services. It adds the lender registry and global routing lock, registers existing three adapters, and normalizes any old duplicate/gapped positions with an explicit migration reason. No account password or submitted loan is reset. Local onboarding uses narrow cross-schema insert grants to create the inactive eligibility product in the same transaction as its login; Integration, Consent and the shared simulator have read-only registry access.


## Portal sessions (26 October 2026)

The browser requests cookie login with X-CredFlow-Session: cookie. The Node gateway validates the Auth JWT and keeps it in server memory; the browser receives only an opaque session ID (HttpOnly, SameSite=Strict, host-only, Path=/api). Each portal has a separate cookie name. The session ends at the earlier of JWT expiry and 15 minutes after token issuance. GET /api/session restores safe account metadata without exposing the JWT or extending expiry. POST /api/session/logout requires the portal origin, revokes the session and clears its cookie. Cookie-authenticated writes require the exact same origin. A user-ID guard rejects stale-tab actions after switching accounts. Existing bearer-token clients remain supported. No database migration is required. Local HTTP is supported; set CREDFLOW_COOKIE_SECURE=true when serving behind HTTPS. Restarting a portal server requires users of that portal to sign in again.

Verification: node --test tests/contracts.test.mjs tests/sessions.test.mjs from frontend. Session tests cover restoration, fixed expiry, logout revocation, portal separation, origin checks, stale-account guards and token-free browser requests.

## AI loan application assistant using local Ollama

Seller Portal > Apply for loan now includes **Get help with this application**,
**Save draft**, **Check application**, and a final review before explicit submission.
The form and assistant share the current draft. Accepted suggestions update the form;
manual edits invalidate pending suggestions and the review. Declarations are never
filled by AI or restored as accepted. If Ollama is unavailable, editing, saving,
validation and submission remain available. If draft storage itself is unavailable,
the original manual loan-request form remains usable.

The assistant runs in a separate `com.credflow.auth.assistant` package inside Auth.
Drafts are stored in `CF_AUTH.CF_LOAN_DRAFTS`, with seller ownership and optimistic
versions. Final submission calls the existing `LoanRequestService` in the same
transaction that marks the draft submitted. Existing loan processing is unchanged.
Submitted drafts cannot be edited. AI cannot grant permissions, submit, approve,
or select financial values without explicit seller confirmation.

For an existing installation, apply only
`database/ai-assistant/01-create-loan-drafts.sql` as SYSTEM in FREEPDB1, after confirming
the table does not already exist. Fresh setup includes this migration automatically.
No existing tables or accounts are reset. Rebuild Auth and restart Auth and the four
portal servers after adding the routes. Portal restarts end existing login sessions.

Install Ollama locally and make the selected model available, for example:

```powershell
ollama pull qwen3:1.7b
ollama serve
```

An already running Ollama instance can be reused; do not start a second server.
Settings in private Auth properties (defaults shown):

```properties
credflow.assistant.ollama-url=http://127.0.0.1:11434
credflow.assistant.model=qwen3:1.7b
credflow.assistant.timeout-seconds=45
```

Only local HTTP Ollama addresses are accepted. The browser never calls Ollama.
The client uses `/api/chat` with a JSON schema, non-streaming responses and thinking
disabled. Backend validation checks editable fields, real purpose enums, decimal
amounts and explicit numeric evidence. Ambiguous financial figures require a monthly
period and are not silently converted. Small models can still produce inaccurate
explanations: review the actual form and never treat assistance as credit advice.

Only the current permitted financial fields and seller message are sent to the
local model. Profile contact details, date of birth, document reference, JWTs and
credentials are excluded from the supplied draft context. Conversation text is
kept in the open browser panel only and is not stored by CredFlow. Do not type secrets
or real identity documents in messages. Drafts persist for resume; no automatic
retention policy is enabled. Choose a retention policy before broader deployment.

APIs are under `/api/v1/seller/loan-drafts`: GET/POST collection, GET/PATCH `/{id}`,
POST `/{id}/validate`, POST `/{id}/assistant/messages`, POST `/{id}/submit`.
PATCH and assistant messages require `draftVersion`; stale writes or model replies
return 409. The submission route requires explicit declarations and an idempotency
key. The original seller loan-request route remains available for manual fallback.

Verification:

```powershell
mvn -f backend/member1/auth-service/pom.xml "-Dtest=!AuthServiceApplicationTests" test
node --test frontend/tests/contracts.test.mjs frontend/tests/assistant.test.mjs tests/setup-helpers.test.mjs
$env:CREDFLOW_ALLOW_WRITE_TEST='true'
node tests/ai-assistant.cjs
```

The existing `AuthServiceApplicationTests` context test requires a separately
configured Oracle datasource and signing keys. It is excluded from the credential-free
unit command above. The opt-in live test requires the full local stack and Ollama;
it creates a synthetic verification seller, submits one request, and cancels its
verification application. It preserves existing seller records.

Approved field explanations are held in `assistant/field-descriptions.json`.
Known field-definition questions use these reviewed definitions verbatim after the
model interaction, so small-model wording cannot redefine debt, expenses or tenure.
AI continues to handle other questions and propose validated, optional updates.
