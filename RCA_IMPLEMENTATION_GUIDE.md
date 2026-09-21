# RCA Feature — Implementation Guide

Companion runbook to the approved plan at `C:\Users\AbhishekKN\.claude\plans\graceful-munching-raccoon.md`. Work through the phases in order and check items off as you go. Phase 0 is Azure Portal work (no code); Phases 1-8 are implementation, done together with Claude in this repo.

---

## Phase 0 — Azure / Infra prerequisites

Nothing in later phases can be tested end-to-end until this phase is done, but you can start Phase 1 (pure refactor) in parallel if you want.

### 0.1 Identify and record your Log Analytics workspace

1. Azure Portal → search **"Log Analytics workspaces"** → select the workspace your target App Service/App Insights/SQL DB should report into (create one if none exists: **+ Create** → pick subscription/resource group/region → Review + create).
2. On the workspace's **Overview** page, copy:
   - **Workspace ID** (a GUID, e.g. `12345678-90ab-cdef-1234-567890abcdef`) — used for the Log Analytics Query REST API.
   - **Resource ID** — click **Properties** in the left nav (under "Settings"), copy the full `/subscriptions/.../resourceGroups/.../providers/Microsoft.OperationalInsights/workspaces/...` string.
3. Save both values somewhere you'll paste them from later (they go into the `serviceMappings` entry in Phase 7, not into `.env`).

### 0.2 Grant the Service Principal read access to the workspace

The app already stores Service Principal credentials per Azure subscription in MongoDB (`subscriptions` collection) — those same credentials will now also call Log Analytics, so they need a new role.

1. Go to the Log Analytics workspace → **Access control (IAM)** (left nav) → **+ Add** → **Add role assignment**.
2. Role: search for and select **Log Analytics Reader**. Click **Next**.
3. Assign access to: **User, group, or service principal**. Click **+ Select members**, search for your app registration by name (the one whose Client ID/Secret is stored in the `subscriptions` collection — check **Microsoft Entra ID → App registrations** if you don't remember the name), select it, click **Select**.
4. **Review + assign**.
5. Repeat for every subscription/SP you plan to use RCA with, if you have more than one registered in the app.

### 0.3 Confirm Application Insights is workspace-based

1. Go to your Application Insights resource → **Overview**.
2. Look for **"Workspace"** in the resource summary (top of the page, near Instrumentation Key). If it shows a linked Log Analytics workspace name, you're done — skip to 0.4.
3. If it says **"Classic"** or shows no linked workspace, you need to migrate: on the same Overview page, look for a **"Migrate to workspace-based"** banner/button (Portal → App Insights resource → Properties, or a prompt at the top of Overview) and follow the migration wizard, selecting the same workspace from 0.1. This is a one-way, non-destructive operation (existing data isn't lost) but takes a few minutes to apply.
4. If you have multiple App Insights resources feeding different apps, repeat for each one you want RCA coverage for.

### 0.4 Enable SQL Database diagnostic settings for long-running query data

Do this per database you want RCA coverage for.

1. Go to the target **SQL Database** resource (not the SQL *server* — the individual database) → **Diagnostic settings** (left nav, under "Monitoring").
2. Click **+ Add diagnostic setting**.
3. Name it something like `send-to-<workspace-name>`.
4. Under **Categories**, check at minimum:
   - **QueryStoreRuntimeStatistics**
   - (Recommended, optional) **Errors**, **Blocks**, **Deadlocks** — useful extra context for RCA, not strictly required by the plan
5. Under **Destination details**, check **Send to Log Analytics workspace**, select your subscription and the workspace from 0.1.
6. **Save**.
7. Confirm Query Store itself is enabled on the database (it usually is by default on newer DBs): **SQL Database → Query Performance Insight** (left nav) — if it shows data/charts, Query Store is active. If it says Query Store is disabled, go to **Configure** on that same page and enable it.
8. Data won't appear in Log Analytics retroactively — only from the moment this setting is saved onward, so do this early and let it run for a while before your first real test.

### 0.5 Confirm the Pingshift → Teams → webhook path

The app's new webhook endpoint expects a direct HTTP POST with a shared-secret header. Before Phase 5, confirm:

1. Does Pingshift itself support configuring a custom outgoing webhook URL + custom header per-monitor? If yes, this is the simplest path — point it straight at the app's endpoint once deployed with a public URL.
2. If Pingshift only integrates with Teams (i.e., it posts to a Teams channel/webhook, not to arbitrary HTTP endpoints), you'll need a relay: a **Power Automate flow** (or a Teams **Workflow** from a channel's "..." menu → Workflows → "Post to a channel when a webhook request is received", inverted, or a flow triggered by the Teams message) that re-POSTs the alert data to the app's `/api/webhooks/pingshift` endpoint with the required header added.
3. Note down: does whichever path you land on let you set a custom header (`X-Webhook-Token`)? If not, flag this back — the plan's auth design assumes header-based auth and would need a fallback (e.g., a token in the URL query string, which is weaker but workable) if truly unavailable.
4. This step just needs an answer, not implementation yet — the actual webhook config happens after Phase 6 (when the endpoint exists and is reachable).

### 0.6 Prepare one pilot mapping

Before Phase 7 (frontend), have these 7 values ready for one real app, so you can register it as the first `serviceMappings` entry and use it for testing:

- Monitored URL (exactly as Pingshift will report it, e.g. `https://myapp.example.com/health`)
- Subscription ID (must match a `subId` already registered in the app's Subscriptions tab)
- Resource Group name
- App Service name
- SQL Server name + Database name (if applicable — can be left blank if this app has no SQL backend)
- Log Analytics Workspace ID (from 0.1)
- App Insights resource name (only needed if it's still classic; leave blank if workspace-based, since queries go through the workspace ID instead)

---

## Phase 1 — Backend refactor (no behavior change)

Goal: pull duplicated code out of `azureMetrics.js` before adding new files next to it, so the new code has clean building blocks to import.

1. **Create `backend/azureAuth.js`**: move the `getToken(clientId, clientSecret, tenantId, scope)` function (currently `azureMetrics.js` lines 1-8) into this new file, keeping the exact same signature and default scope. Export it.
2. **Create `backend/timeWindow.js`**:
   - `timeframeToWindow(timeframe)`: move the `switch (timeframe) { case '30m': ... }` block (duplicated at `azureMetrics.js:34-42` and `:126-134`) into this function. It should return `{ start, end, timespan, interval }` computed relative to `new Date()` — same values the two call sites compute today, just in one place.
   - `fixedWindow(endDate, hours = 2)`: new function. Returns `{ start: new Date(endDate.getTime() - hours*3600*1000), end: endDate, timespan: '<start iso>/<end iso>' }`, with interval fixed to `'PT5M'` (used later for the RCA charts).
3. **Update `backend/azureMetrics.js`**: `require("./azureAuth")` and `require("./timeWindow")` at the top, delete the local `getToken` definition and both duplicated switch blocks, call `timeframeToWindow(timeframe)` in their place. Function signatures and return shapes of `fetchMetrics`/`fetchDatabaseMetrics` must not change.
4. **Verify no regression**: `docker compose build backend && docker compose up -d backend`, open the app's existing **Overview** tab, confirm CPU/Memory/DTU charts still render for a real subscription exactly as before. This is a pure refactor — if anything looks different here, stop and fix before continuing.

---

## Phase 2 — Data layer

1. **`backend/db.js`**: add two new exported functions, following the existing style exactly (`client.connect()` then return a `.collection(...)`):
   - `connectServiceMappingsDB()` → `.collection("serviceMappings")`, and create a unique index: `await col.createIndex({ monitoredUrl: 1 }, { unique: true })`.
   - `connectRcaIncidentsDB()` → `.collection("rcaIncidents")`, and create two indexes: `await col.createIndex({ alertTime: -1 })` and a TTL index `await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: <RCA_RETENTION_DAYS * 86400> })` (read the days value from `process.env.RCA_RETENTION_DAYS`, default `90` if unset).
   - Export both alongside the existing exports at the bottom of the file.

---

## Phase 3 — New Azure data fetchers

Test each new Azure REST call manually first (Postman, curl, or the Azure Portal's "Try it" / Log Analytics query editor) before wiring it into Node — this isolates KQL/API mistakes from Node bugs.

1. **Create `backend/azureAppService.js`** (`require("./azureAuth")`):
   - `fetchAppServiceDetails(subscriptionId, resourceGroup, appServiceName, clientId, clientSecret, tenantId)` — `GET https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{name}?api-version=2022-03-01`, bearer token from `getToken`. From the response extract `{name, resourceGroup, location, state, kind, hostNames, serverFarmId, sku}` — `serverFarmId` points at the App Service Plan; if you need the SKU name, follow up with `GET https://management.azure.com{serverFarmId}?api-version=2022-03-01` and read `.sku.name` (same shape already used in `fetchMetrics`).
   - `fetchAppServiceInstances(subscriptionId, resourceGroup, appServiceName, clientId, clientSecret, tenantId)` — `GET .../sites/{name}/instances?api-version=2022-03-01`. Return `{count: <array length>, instances: [{id, state}]}`.
   - `fetchAppServiceCpuMemHistory(subscriptionId, serverFarmId, clientId, clientSecret, tenantId, windowStart, windowEnd)` — same `microsoft.insights/metrics` call pattern as `fetchMetrics` in `azureMetrics.js`, but scoped to the single `serverFarmId` passed in, and using `timespan` built from `windowStart`/`windowEnd` (via `fixedWindow`) instead of "now minus timeframe". Metric names stay `CpuPercentage,MemoryPercentage`, interval `PT5M`. Return the same `{cpu[], memory[], labels[]}` shape the frontend chart code already expects.

2. **Create `backend/azureLogAnalytics.js`** (`require("./azureAuth")`):
   - `queryLogAnalytics(workspaceId, clientId, clientSecret, tenantId, kqlQuery, timespanISO)` — core helper. `POST https://api.loganalytics.io/v1/workspaces/{workspaceId}/query`, body `{ query: kqlQuery, timespan: timespanISO }`, header `Authorization: Bearer <token>` where the token's scope is `https://api.loganalytics.io/.default` (pass this as the 4th arg to `getToken`). The response is `{ tables: [{ columns: [{name,type}], rows: [[...]] }] }` — write a small conversion so callers get back `[{colName: val, ...}, ...]` instead of raw column/row arrays.
   - `fetchInstanceScaleEvents(workspaceId, appServicePlanResourceId, clientId, clientSecret, tenantId, windowStart, windowEnd)`:
     ```kql
     AutoscaleScaleActionsLog
     | where TimeGenerated between (datetime({windowStart}) .. datetime({windowEnd}))
     | where ResourceId =~ "{appServicePlanResourceId}"
     | project TimeGenerated, OldInstanceCount, NewInstanceCount, Description
     | order by TimeGenerated asc
     ```
     If the query throws (table doesn't exist / no autoscale configured), catch it and return `{ available: false, events: [] }` rather than propagating an error — this is an expected, non-error state.
   - `fetchAppInsightsPerf(workspaceId, clientId, clientSecret, tenantId, windowStart, windowEnd)`:
     ```kql
     requests
     | where timestamp between (datetime({windowStart}) .. datetime({windowEnd}))
     | summarize avgDurMs=avg(duration), p95DurMs=percentile(duration,95), cnt=count(),
                 failRatePct=100.0*countif(success=="False")/count() by name
     | order by avgDurMs desc
     | take 20
     ```
     Also run an unsegmented version (no `by name`) for overall KPI numbers. Return `{ summary: {avgDurMs, p95DurMs, totalRequests, failRatePct}, byOperation: [...] }`.
   - `fetchSqlLongRunningQueries(workspaceId, sqlResourceId, clientId, clientSecret, tenantId, windowStart, windowEnd)`:
     ```kql
     AzureDiagnostics
     | where TimeGenerated between (datetime({windowStart}) .. datetime({windowEnd}))
     | where Category == "QueryStoreRuntimeStatistics" and ResourceId =~ "{sqlResourceId}"
     | order by TimeGenerated desc
     | take 50
     ```
     Start with the `AzureDiagnostics` (legacy) shape since that's what a fresh diagnostic setting from Phase 0.4 produces by default; if your workspace uses resource-specific tables instead, the table name will differ (check via **Log Analytics workspace → Logs → Tables** in the portal after Phase 0.4 has been running a while, and look for a table starting with `AzureDiagnostics` vs one named after the SQL resource type). Return `{ configured: boolean, rows: [...] }` — set `configured: false` when the query returns zero rows **and** a schema probe (`AzureDiagnostics | where Category == "QueryStoreRuntimeStatistics" | take 1`, unscoped by time/resource) also returns nothing, meaning diagnostics were never wired up at all (vs. just "no slow queries in this window").
   - `fetchCodeOptimizationFindings(workspaceId, clientId, clientSecret, tenantId, windowStart, windowEnd, appInsightsResourceId, tenantIdForLink)`:
     ```kql
     dependencies
     | where timestamp between (datetime({windowStart}) .. datetime({windowEnd}))
     | summarize avgDurMs=avg(duration), cnt=count(), failCnt=countif(success=="False") by type, target, name
     | order by avgDurMs desc | take 20
     ```
     ```kql
     exceptions
     | where timestamp between (datetime({windowStart}) .. datetime({windowEnd}))
     | summarize cnt=count() by type, method, outerMessage
     | order by cnt desc | take 20
     ```
     Build `profilerPortalUrl = https://portal.azure.com/#@{tenantIdForLink}/resource/{appInsightsResourceId}/performance` and return `{ slowDependencies: [...], topExceptions: [...], profilerPortalUrl }`.

---

## Phase 4 — Orchestration

1. **Create `backend/rcaEngine.js`**:
   - `normalizeWebhookPayload(body)` — try, in order: `body.url || body.monitorUrl || body.monitor?.url || body.name`; `body.status || body.monitor?.status` mapped to boolean `isDown` (treat `"down"`, `"unhealthy"`, `0`, `false` as down; anything else as up); `body.timestamp || body.time || body.heartbeat?.time`, parsed with `new Date(...)`, fallback to `new Date()` if missing/invalid; `body.message || body.msg || body.reason || null`. Return `null` only if no URL-like field was found at all; otherwise always return `{ url, isDown, alertTime, message, rawPayload: body }` even with best-guess values.
   - `matchServiceMapping(monitoredUrl, serviceMappingsCollection)` — `findOne({ monitoredUrl })` first; if no hit, fetch all mappings and compare `new URL(monitoredUrl).hostname` against `new URL(m.monitoredUrl).hostname` for each, return the first match or `null`. Wrap `new URL(...)` in try/catch since either side could be a malformed URL.
   - `runRcaAggregation(incidentId, { rcaIncidentsCollection, serviceMappingsCollection, subscriptionsCollection })`:
     1. Load the incident by `_id`.
     2. `matchServiceMapping(incident.monitoredUrl, serviceMappingsCollection)`. If none found: `updateOne` the incident to `{status: "unmapped", completedAt: new Date()}` and return.
     3. Load the matched mapping's `subscriptions` doc via `subscriptionsCollection.findOne({ subId: mapping.subscriptionId })` for `{clientId, clientSecret, tenantId}`.
     4. Compute `{start, end, timespan} = fixedWindow(incident.alertTime, process.env.RCA_WINDOW_HOURS || 2)`; update the incident with `windowStart`/`windowEnd`.
     5. `Promise.allSettled([fetchAppServiceDetails, fetchAppServiceInstances, fetchAppServiceCpuMemHistory, fetchAppInsightsPerf, fetchSqlLongRunningQueries, fetchCodeOptimizationFindings, fetchInstanceScaleEvents])` — call each with the mapping's stored resource identifiers and the credentials from step 3.
     6. Build `results.*` from fulfilled values (`null` where a corresponding mapping field was empty, e.g. no SQL DB configured → skip SQL fetchers), `errors.*` from rejected reasons' `.message`.
     7. `status`: `"ready"` if zero errors, `"partial"` if some-but-not-all sections errored, `"failed"` if every attempted section errored. Set `completedAt: new Date()`.
     8. `updateOne` the incident with all of the above.

---

## Phase 5 — Routes

1. **`backend/server.js`**: add `require`s for the new modules at the top; in the startup IIFE (where `certsCollection` etc. are assigned), add `serviceMappingsCollection = await connectServiceMappingsDB();` and `rcaIncidentsCollection = await connectRcaIncidentsDB();`.
2. **Before** `app.use(requireAuth)` (currently line 111), add:
   ```
   app.post("/api/webhooks/pingshift", async (req, res) => {
     // 1. read req.headers["x-webhook-token"], compare against process.env.PINGSHIFT_WEBHOOK_SECRET
     //    using crypto.timingSafeEqual on equal-length buffers; 401 generic message on any mismatch
     //    or missing header/env var — do not leak which one failed.
     // 2. normalized = normalizeWebhookPayload(req.body); 400 if normalized === null.
     // 3. if (!normalized.isDown) return res.status(200).json({ skipped: true }); // ignore recovery pings
     // 4. insert into rcaIncidentsCollection: { source:"pingshift", rawPayload: normalized.rawPayload,
     //    monitoredUrl: normalized.url, alertMessage: normalized.message, alertTime: normalized.alertTime,
     //    status:"collecting", matchedServiceMapId:null, createdAt:new Date(), completedAt:null,
     //    results:{}, errors:{} }
     // 5. res.status(202).json({ incidentId: result.insertedId });
     // 6. runRcaAggregation(result.insertedId, {...collections}).catch(console.error);  // NOT awaited
   });
   ```
3. **After** `app.use(requireAuth)`, add (mirror the existing certs/subscriptions CRUD style at `server.js:153-259`):
   - `GET /api/service-mappings`, `POST /api/service-mappings` (validate required fields, insert), `DELETE /api/service-mappings/:id`
   - `GET /api/rca/incidents` — `.find({}).project({rawPayload:0, results:0}).sort({alertTime:-1}).limit(parseInt(req.query.limit)||50).toArray()`
   - `GET /api/rca/incidents/:id` — full document by `ObjectId`
   - `POST /api/rca/incidents/:id/retry` — re-fetch the incident, call `runRcaAggregation` again unawaited, respond 202
   - `DELETE /api/rca/incidents/:id`
4. **`.env.example`**: append
   ```
   PINGSHIFT_WEBHOOK_SECRET=
   RCA_WINDOW_HOURS=2
   RCA_RETENTION_DAYS=90
   ```
   Then copy the same 3 keys into your real `.env` with an actual secret value (generate one, e.g. `openssl rand -hex 32`).

---

## Phase 6 — Backend smoke test

Do this before writing any frontend code.

1. `docker compose up -d --build` on the `testing` branch.
2. Send a test webhook (replace `<secret>` with your real `PINGSHIFT_WEBHOOK_SECRET`):
   ```
   curl -X POST http://localhost:3000/api/webhooks/pingshift \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Token: <secret>" \
     -d '{"url":"https://myapp.example.com/health","status":"down","timestamp":"2026-09-21T10:00:00Z","message":"Connection timeout"}'
   ```
   Expect `202 {incidentId: "..."}`.
3. Confirm via `docker exec -it azure-dashboard-mongodb mongosh metricsdb --eval 'db.rcaIncidents.find().pretty()'` that the incident was created and — a few seconds later — reaches `status: "ready"`, `"partial"`, or `"unmapped"` (expected `"unmapped"` until you've registered a matching `serviceMappings` entry in Phase 7).
4. Re-run the same curl **without** the `X-Webhook-Token` header → expect `401`, and confirm no new document was inserted.
5. `curl http://localhost:3000/api/rca/incidents` (no cookie) → expect `401` (confirms the auth boundary is correct).

---

## Phase 7 — Frontend

1. **`frontend/dashboard.html`**:
   - Add a sidebar nav item next to the existing ones (`Overview`, `App Secrets`, `Certificates`, `Settings`): `<a class="nav-item" onclick="switchView('rca')">RCA</a>`.
   - Add `<section id="view-rca" class="view-section">` containing:
     - An incidents table (`Alert Time`, `Monitored URL`, `Status` badge, click row → `selectRcaIncident(id)`), body `<tbody id="rcaIncidentsTableBody">`.
     - A detail panel `<div id="rcaDetailPanel" style="display:none">` with 5 cards in this order: (1) App Service Overview + Instance Count KPIs, (2) two `<canvas>` elements for CPU and Memory over the 2h window, (3) App Insights performance KPIs + a table of slowest operations, (4) SQL long-running queries table (with an alternate "not configured" message block, toggle visibility based on `configured`), (5) code optimization findings — two tables (slow dependencies, top exceptions) + an `<a target="_blank">` "Open Profiler in Azure Portal" button.
   - In the existing Settings section, add a "Service Mappings" card: an inline form (Monitored URL, Display Name, Subscription dropdown — reuse the same subscriptions data already loaded for the Subscriptions card, Resource Group, App Service Name, SQL Server Name, SQL Database Name, Log Analytics Workspace ID, App Insights Resource Name) + a list below it with delete buttons, styled the same as the existing Subscriptions card.

2. **`frontend/app.js`**:
   - Add `'rca': 'Root Cause Analysis'` to the `titles` object inside `switchView()`.
   - `loadRcaIncidents()` — `fetch('/api/rca/incidents')`, render rows into `rcaIncidentsTableBody` with a color-coded status badge (`collecting`=amber, `ready`=green, `partial`=orange, `failed`/`unmapped`=red).
   - `selectRcaIncident(id)` — `fetch('/api/rca/incidents/' + id)`, call `renderRcaDetail(data)`, show `rcaDetailPanel`.
   - `renderRcaDetail(incident)` — populate each of the 5 cards from `incident.results.*`; where `incident.errors.<section>` is set, show that message instead of the card's normal content.
   - `renderRcaCpuMemCharts(cpuMemory)` — declare `rcaCpuChartInstance`/`rcaMemChartInstance` at file scope; on call, if the instances already exist, update `.data` and call `.update('none')`; otherwise construct new `Chart(...)` instances — copy this pattern directly from the existing `renderPlanCharts` function.
   - `retryRcaIncident(id)` — `POST /api/rca/incidents/' + id + '/retry'`, then re-call `selectRcaIncident(id)` after a short delay (or on next `loadRcaIncidents()` poll).
   - `loadServiceMappings()`, `renderServiceMappingsList()`, `addServiceMapping()`, `deleteServiceMapping(id)` — mirror the existing Subscriptions tab's equivalent functions exactly (same fetch/render/error-handling shape).
   - Call `loadRcaIncidents()` the first time `switchView('rca')` runs (lazy-load, matching the app's existing per-tab loading convention), and `loadServiceMappings()` similarly when Settings is opened.
   - Do **not** add a dummy-data fallback for the incidents list — leave it empty with a "No incidents yet" message when there's nothing, rather than reusing the `dummyPlans()`-style simulation pattern used elsewhere in the app.

3. Register your Phase 0.6 pilot mapping through the new Settings UI once it's live.

---

## Phase 8 — End-to-end verification

Run through this list against the running `testing`-branch stack:

1. Webhook rejects missing/wrong secret (401, no incident row created); accepts correct secret + "down" payload (202, row appears as `collecting`).
2. Send 2-3 differently-shaped payloads (flat `url` vs nested `monitor.url`, `time` vs `timestamp` field names) — all should still produce a valid incident. A payload with no URL-like field anywhere → 400, nothing persisted.
3. Webhook for a URL with no matching `serviceMappings` entry → incident reaches `status:"unmapped"`, no Azure calls attempted (check logs).
4. With the Phase 0.6 pilot mapping registered and diagnostics running for a while: fire a real webhook → all sections populate in the RCA tab, `status:"ready"`.
5. Temporarily remove the SP's Log Analytics Reader role (Phase 0.2) → fire another webhook → confirm `status:"partial"`, App Service/CPU-Memory sections (ARM-only, don't need the role) still populate, Log-Analytics-dependent sections show their error message. Re-grant the role afterward.
6. Point a mapping at a DB with no diagnostic settings enabled → confirm the SQL section shows "not configured", not a red error.
7. Confirm `/api/rca/*` and `/api/service-mappings*` 401 without a login session (open in an incognito window or clear cookies), and the webhook endpoint works without a session but rejects without the secret.
8. Seed 50+ test incidents (loop the curl command from Phase 6 a bunch of times with different fake URLs) — confirm the incident list still loads quickly and the detail panel only fetches on row click.
9. Force a `failed` incident (e.g. temporarily set a wrong `logAnalyticsWorkspaceId` in a mapping), fix the mapping, click Retry in the UI → incident transitions to `ready`.
10. Finally, walk through the real intended flow once end-to-end: configure the actual Pingshift/Teams relay from Phase 0.5 to hit the deployed endpoint, trigger (or simulate) a real outage, and confirm the RCA tab tells you what you'd need to know without opening the Azure Portal separately.

---

## Risks to keep in mind throughout

- SQL long-running query visibility only exists where diagnostics were enabled ahead of time (Phase 0.4) — coverage will be uneven across apps until that's rolled out everywhere.
- Historical instance-count trend (via `AutoscaleScaleActionsLog`) only exists for App Service Plans with autoscale configured; fixed-instance plans will only ever show a current snapshot.
- `subscriptions.clientSecret` is stored in plaintext in MongoDB today; this feature reuses those same credentials for Log Analytics calls without changing that storage model — a good candidate for a future, separate hardening pass.
- Pingshift's real webhook payload shape is unconfirmed until Phase 0.5/Phase 8 step 10 — the tolerant parser in Phase 4 is a best-effort design, validate it against a real payload as early as possible.
