// ─── State Management ──────────────────────────────────────────────────────────
let globalPlansData   = [];
let globalDbData      = [];
let filteredPlansData = [];
let filteredDbData    = [];
let selectedSubId     = 'all';
let cpuChartInstance    = null;
let memChartInstance    = null;
let dtuChartInstance    = null;
let dbStorageChartInstance = null;

function createGradient(ctx, colorStart, colorEnd = "rgba(0,0,0,0)") {
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, colorStart);
  gradient.addColorStop(1, colorEnd);
  return gradient;
}

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.8)',
      titleFont: { family: 'Inter', size: 13 },
      bodyFont: { family: 'Inter', size: 13 },
      padding: 12,
      cornerRadius: 8,
      displayColors: false
    }
  },
  scales: {
    y: {
      beginAtZero: true, 
      max: 100,
      grid: { color: "#262626", drawBorder: false },
      ticks: { color: "#9ca3af", font: { family: 'Inter', size: 11 }, callback: v => `${v}%` },
      border: { display: false }
    },
    x: {
      grid: { display: false, drawBorder: false },
      ticks: { color: "#9ca3af", font: { family: 'Inter', size: 11 }, maxRotation: 0, maxTicksLimit: 8 },
      border: { display: false }
    }
  }
};

// ─── View Switching ──────────────────────────────────────────────────────────
function switchView(viewId) {
  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNavItem = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick') === `switchView('${viewId}')`);
  if (activeNavItem) activeNavItem.classList.add('active');

  // Update view visibility
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');

  // Update Topbar title
  const titles = {
    'overview':  'Overview',
    'vault':     'App Secrets Vault',
    'endpoints': 'Domain & SSL Registry',
    'settings':  'System Settings'
  };
  
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) titleEl.innerText = titles[viewId] || 'Overview';
}

function switchInfraType() {
  const type = document.getElementById("infraTypeSelector").value;
  const aspSec = document.getElementById("section-asp");
  const sqlSec = document.getElementById("section-sql");

  if (type === "asp") {
    aspSec.style.display = "block";
    sqlSec.style.display = "none";
    if (filteredPlansData.length > 0) handlePlanSelection();
  } else {
    aspSec.style.display = "none";
    sqlSec.style.display = "block";
    if (filteredDbData.length > 0) handleDbSelection();
  }
}


// ─── Login ────────────────────────────────────────────────────────────────────
async function login() {
  const user    = document.getElementById("username").value;
  const pass    = document.getElementById("password").value;
  const errorEl = document.getElementById("error");
  const btn     = document.querySelector(".btn");

  if (btn) {
    btn.innerText = "Signing in...";
    btn.disabled = true;
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass })
    });
    if (res.ok) {
      localStorage.setItem("auth", "true");
      location.href = "dashboard.html";
    } else {
      errorEl.innerText = "Invalid credentials";
    }
  } catch (e) {
    console.error("Login connection error:", e);
    errorEl.innerText = "Cannot connect to server";
  } finally {
    const btn = document.querySelector(".btn");
    if (btn) {
      btn.innerText = "Access Dashboard";
      btn.disabled = false;
    }
  }
}

async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("auth");
  location.href = "index.html";
}

// ─── Settings ────────────────────────────────────────────────────────────────
// ─── Multi-Subscription Settings ────────────────────────────────────────────
async function fetchSubscriptions() {
  try {
    const res = await fetch("/api/subscriptions");
    return res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Failed to fetch subscriptions:", e);
    return [];
  }
}

async function renderSubscriptionsList() {
  const list = document.getElementById("subscriptionsList");
  const emptyState = document.getElementById("subsEmptyState");
  if (!list) return;

  const subs = await fetchSubscriptions();
  updateCredentialVisibility(subs);

  if (subs.length === 0) {
    list.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  list.innerHTML = subs.map((acc, idx) => `
    <div style="display:flex; flex-direction:column; gap:8px; background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px;">${escHtml(acc.name || `Azure Account #${idx + 1}`)}</span>
        <button class="btn btn-danger" style="padding:4px 10px; font-size:11px;" onclick="removeSubscription('${acc._id}')">Remove</button>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-family:monospace; font-size:12px;">
        <div style="color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;" title="${escHtml(acc.subId)}">Sub: <span style="color:var(--text-main);">${escHtml(acc.subId.substring(0, 8))}…</span></div>
        <div style="color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;" title="${escHtml(acc.tenantId)}">Tenant: <span style="color:var(--text-main);">${escHtml(acc.tenantId.substring(0, 8))}…</span></div>
      </div>
    </div>
  `).join("");
}

function updateCredentialVisibility(subs) {
}

function resetSharedCredentials() {
}

async function addSubscription() {
  const nameInput         = document.getElementById("newSubNameInput");
  const subIdInput        = document.getElementById("newSubIdInput");
  const tenantIdInput     = document.getElementById("newTenantIdInput");
  const clientIdInput     = document.getElementById("newClientIdInput");
  const clientSecretInput = document.getElementById("newClientSecretInput");

  const name         = nameInput.value.trim();
  const subId        = subIdInput.value.trim();
  const tenantId     = tenantIdInput.value.trim();
  const clientId     = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();

  if (!subId || !tenantId || !clientId || !clientSecret) {
    alert("Please fill in all Azure credential fields.");
    return;
  }

  // Strict GUID check
  const isGuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  
  if (!isGuid(subId) || !isGuid(tenantId) || !isGuid(clientId)) {
    alert("Subscription, Tenant, and Client IDs must be valid GUIDs.");
    return;
  }

  try {
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, subId, tenantId, clientId, clientSecret })
    });

    if (!res.ok) {
      const err = await res.json();
      alert("Failed to add subscription: " + (err.error || "Unknown error"));
      return;
    }

    // Clear inputs
    ["newSubNameInput", "newSubIdInput", "newTenantIdInput", "newClientIdInput", "newClientSecretInput"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    await renderSubscriptionsList();
    showSubSaveMsg();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function removeSubscription(id) {
  // Find the subscription details before deleting (we need subId for cascade)
  let subId = null;
  let subName = null;
  try {
    const allSubs = await fetchSubscriptions();
    const target = allSubs.find(s => s._id === id);
    if (target) { subId = target.subId; subName = target.name; }
  } catch (_) {}

  if (!confirm(`Remove subscription "${subName || id}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to remove subscription."); return; }

    await renderSubscriptionsList();
    showSubSaveMsg();

    // Offer to cascade-delete secrets linked to this subscription
    if (subId) {
      const purge = confirm(
        `Subscription removed.\n\n` +
        `Do you also want to delete all App Registration & Key Vault secrets synced from this subscription?\n\n` +
        `(They will reappear automatically if you re-add this subscription and sync again.)`
      );
      if (purge) {
        try {
          await fetch(`/api/app-secrets/by-subscription/${subId}`, { method: "DELETE" });
          await loadDashboardSecrets();
        } catch (e) {
          console.error("Failed to purge subscription secrets:", e.message);
        }
      }
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

function showSubSaveMsg() {
  const msg = document.getElementById("subSaveMsg");
  if (!msg) return;
  msg.style.display = "block";
  clearTimeout(msg._timer);
  msg._timer = setTimeout(() => { msg.style.display = "none"; }, 4000);
}

// Legacy saveSettings kept as no-op safety
function saveSettings() {}

// ─── Notification Settings ──────────────────────────────────────────────────
async function fetchNotificationSettings() {
  try {
    const res = await fetch("/api/notification-settings");
    if (res.ok) {
      const data = await res.json();
      const input = document.getElementById("notifEmailsInput");
      if (input && data.emails) {
        input.value = data.emails.join("\n");
      }
    }
  } catch (e) {
    console.error("Failed to fetch notification settings:", e);
  }
}

async function saveNotificationSettings() {
  const input = document.getElementById("notifEmailsInput");
  const msg = document.getElementById("notifSaveMsg");
  const emails = input.value.split("\n").map(e => e.trim()).filter(e => e !== "");

  try {
    const res = await fetch("/api/notification-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails })
    });

    if (res.ok) {
      msg.style.display = "block";
      setTimeout(() => { msg.style.display = "none"; }, 4000);
    } else {
      alert("Failed to save notification settings.");
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

// ─── Modals ──────────────────────────────────────────────────────────────────
function openAppSecretModal() {
  ["asName", "asAppId", "asSecretName", "asExpiry", "asNotes"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("asError").innerText = "";
  document.getElementById("appSecretModal").classList.add("active");
}

function closeAppSecretModal() {
  document.getElementById("appSecretModal").classList.remove("active");
}

function openCertModal() {
  ["certDomain","certSslExpiry","certDomainExpiry","certNotes"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("certError").innerText = "";
  document.getElementById("certModal").classList.add("active");
}

function closeCertModal() {
  document.getElementById("certModal").classList.remove("active");
}

// ─── Save Handlers ──────────────────────────────────────────────────────────
async function saveAppSecret() {
  const name       = document.getElementById("asName").value.trim();
  const appId      = document.getElementById("asAppId").value.trim();
  const secretName = document.getElementById("asSecretName").value.trim();
  const expiry     = document.getElementById("asExpiry").value;
  const notes      = document.getElementById("asNotes").value.trim();
  const errEl      = document.getElementById("asError");

  if (!name)   { errEl.innerText = "App name is required."; return; }
  if (!expiry) { errEl.innerText = "Expiry date is required."; return; }

  try {
    const res = await fetch("/api/app-secrets", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, appId, secretName, expiry, notes })
    });
    if (!res.ok) {
      errEl.innerText = (await res.json()).error || "Failed to save.";
      return;
    }
    closeAppSecretModal();
    loadDashboardSecrets();
  } catch (e) {
    errEl.innerText = "Network error: " + e.message;
  }
}

async function deleteAppSecret(id) {
  if (!confirm("Delete this secret entry?")) return;
  try {
    await fetch(`/api/app-secrets/${id}`, { method: "DELETE" });
    loadDashboardSecrets();
  } catch (e) {
    console.error("Delete failed:", e.message);
  }
}

async function syncAzureSecrets() {
  const subs = await fetchSubscriptions();
  if (subs.length === 0) {
    alert("Please add an Azure subscription in Settings first.");
    return;
  }

  const btn = document.getElementById("btnSyncSecrets");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:14px; height:14px; border-width:2px; display:inline-block;"></span> Syncing...`;

  try {
    const res = await fetch("/api/sync-secrets", { method: "POST" });

    if (res.ok) {
      await loadDashboardSecrets();
      alert("Sync complete! Your Azure App Registrations and Key Vault secrets have been updated.");
    } else {
      const err = await res.json();
      alert("Sync failed: " + (err.error || "Unknown error"));
    }
  } catch (e) {
    alert("Network error during sync: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function saveCertificate() {
  const domain       = document.getElementById("certDomain").value.trim();
  const sslExpiry    = document.getElementById("certSslExpiry").value;
  const domainExpiry = document.getElementById("certDomainExpiry").value;
  const notes        = document.getElementById("certNotes").value.trim();
  const errEl        = document.getElementById("certError");

  if (!domain) { errEl.innerText = "Domain name is required."; return; }

  try {
    const res = await fetch("/api/certificates", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ domain, sslExpiry, domainExpiry, notes })
    });
    if (!res.ok) { errEl.innerText = (await res.json()).error || "Failed."; return; }
    closeCertModal();
    loadCertificates();
  } catch (e) {
    errEl.innerText = "Network error: " + e.message;
  }
}

async function deleteCertificate(id) {
  if (!confirm("Delete this entry?")) return;
  try {
    await fetch(`/api/certificates/${id}`, { method: "DELETE" });
    loadCertificates();
  } catch (e) {
    console.error("Delete failed:", e.message);
  }
}

// ─── Dashboard Initialization ─────────────────────────────────────────────────
async function initDashboard() {
  // Verify the session is still valid server-side before rendering anything
  const check = await fetch("/api/subscriptions").catch(() => null);
  if (!check || check.status === 401) {
    location.href = "index.html";
    return;
  }

  try {
    // Render subscriptions list in the Settings view
    await renderSubscriptionsList();

    const subs = await fetchSubscriptions();

  if (subs.length > 0) {
    document.getElementById("subBadge").innerHTML =
      `<div class="status-dot"></div>${subs.length} Subscription${subs.length > 1 ? "s" : ""} Linked`;
  } else {
    document.getElementById("subBadge").innerHTML =
      `<div class="status-dot" style="background:var(--warning);box-shadow:0 0 8px rgba(245,158,11,0.4)"></div>Simulation Mode`;
  }

  await fetchDashboardData();
  
    await Promise.all([loadDashboardSecrets(), loadCertificates(), fetchNotificationSettings()]);

  } catch (e) {
    console.error("Dashboard init error:", e);
  } finally {
    const loader = document.getElementById("loader");
    if (loader) {
      setTimeout(() => loader.classList.add("hidden"), 400);
    }
  }
}

async function fetchDashboardData() {
  const subs = await fetchSubscriptions();
  const loader = document.getElementById("loader");
  if (loader) loader.classList.remove("hidden");

  try {
    let timeframe = "7d";
    const tfSelector = document.getElementById("timeframeSelector");
    if (tfSelector) timeframe = tfSelector.value;

    if (subs.length > 0) {
      try {
        const results = await Promise.allSettled(
          subs.map(acc =>
            fetch(`/api/dashboard-data`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subscriptionId: acc.subId,
                timeframe:      timeframe
              })
            })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const out = { plans: [], dbs: [] };
              if (data && data.metrics) {
                out.plans = data.metrics.map(p => ({
                  ...p,
                  subId:   acc.subId,
                  subName: acc.name || acc.subId.substring(0, 8) + '…'
                }));
              }
              if (data && data.dbMetrics) {
                out.dbs = data.dbMetrics.map(d => ({
                  ...d,
                  subId:   acc.subId,
                  subName: acc.name || acc.subId.substring(0, 8) + '…'
                }));
              }
              return out;
            })
          )
        );

        const allPlans = results.filter(r => r.status === "fulfilled" && r.value.plans).flatMap(r => r.value.plans);
        const allDbs   = results.filter(r => r.status === "fulfilled" && r.value.dbs).flatMap(r => r.value.dbs);

        globalPlansData = (allPlans && allPlans.length > 0) ? allPlans : dummyPlans();
        globalDbData    = (allDbs && allDbs.length > 0)     ? allDbs   : dummyDbs();
      } catch (err) {
        console.warn("API fetch failed, using dummy data", err);
        globalPlansData = dummyPlans();
        globalDbData    = dummyDbs();
      }
    } else {
      globalPlansData = dummyPlans();
      globalDbData    = dummyDbs();
    }

    populateSubscriptionDropdown(subs);
    applySubscriptionFilter();
  } catch (err) {
    console.error("fetchDashboardData error:", err);
  } finally {
    if (loader) setTimeout(() => loader.classList.add("hidden"), 400);
  }
}

// ─── Subscription Filter ─────────────────────────────────────────────────────
function populateSubscriptionDropdown(subs) {
  const select = document.getElementById('subscriptionSelector');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="all">All Subscriptions</option>';
  subs.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.subId;
    opt.text  = acc.name || acc.subId.substring(0, 8) + '…';
    select.appendChild(opt);
  });
  // Restore prior selection if it still exists
  if (currentVal && [...select.options].some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
  selectedSubId = select.value;
}

function handleSubscriptionChange() {
  selectedSubId = document.getElementById('subscriptionSelector').value;
  applySubscriptionFilter();
}

function applySubscriptionFilter() {
  // Capture current selections by stable key before rebuilding dropdowns
  const planSel   = document.getElementById("planSelector");
  const dbSel     = document.getElementById("dbSelector");
  const prevPlan  = filteredPlansData[planSel?.value];
  const prevDb    = filteredDbData[dbSel?.value];
  const prevPlanKey = prevPlan ? `${prevPlan.planName}|${prevPlan.subId || ''}` : null;
  const prevDbKey   = prevDb   ? `${prevDb.dbName}|${prevDb.subId || ''}`       : null;

  if (selectedSubId === 'all') {
    filteredPlansData = globalPlansData;
    filteredDbData    = globalDbData;
  } else {
    filteredPlansData = globalPlansData.filter(p => p.subId === selectedSubId);
    filteredDbData    = globalDbData.filter(d => d.subId === selectedSubId);
  }

  populatePlanDropdown(prevPlanKey);
  populateDatabaseDropdown(prevDbKey);

  // Only render charts for the currently visible section to avoid
  // Chart.js errors on hidden (display:none) canvases
  const infraType = document.getElementById("infraTypeSelector")?.value || 'asp';
  if (infraType === 'asp') {
    if (filteredPlansData.length > 0) handlePlanSelection();
  } else {
    if (filteredDbData.length > 0) handleDbSelection();
  }
}

// ─── Data Loaders ────────────────────────────────────────────────────────────
async function loadDashboardSecrets() {
  try {
    const res = await fetch("/api/app-secrets");
    const secrets = res.ok ? await res.json() : [];
    renderSecrets(secrets);
  } catch {
    renderSecrets([]);
  }
}

async function loadCertificates() {
  try {
    const res = await fetch("/api/certificates");
    const certs = res.ok ? await res.json() : [];
    renderCertificates(certs);
  } catch {
    renderCertificates([]);
  }
}

// ─── Dropdown & Metrics Selection ─────────────────────────────────────────────
function populatePlanDropdown(restoreKey) {
  const select = document.getElementById("planSelector");
  if (!select) return;
  select.innerHTML = "";
  let restoreIdx = 0;
  filteredPlansData.forEach((plan, idx) => {
    const option = document.createElement("option");
    option.value = idx;
    const prefix = selectedSubId === 'all' && plan.subName ? `[${plan.subName}] ` : '';
    option.text = `${prefix}${plan.planName} ${plan.sku ? `(${plan.sku})` : ""}`;
    select.appendChild(option);
    if (restoreKey && `${plan.planName}|${plan.subId || ''}` === restoreKey) restoreIdx = idx;
  });
  select.value = restoreIdx;
}

function handlePlanSelection() {
  const select = document.getElementById("planSelector");
  if (!select) return;
  const idx = select.value;
  const plan = filteredPlansData[idx];
  if (plan) {
    const cpuS = calcStats(plan.cpu);
    const memS = calcStats(plan.memory);
    document.getElementById("kpiCpuMin").innerHTML = `${cpuS.min}<span>%</span>`;
    document.getElementById("kpiCpuAvg").innerHTML = `${cpuS.avg}<span>%</span>`;
    document.getElementById("kpiCpuMax").innerHTML = `${cpuS.max}<span>%</span>`;
    document.getElementById("kpiMemMin").innerHTML = `${memS.min}<span>%</span>`;
    document.getElementById("kpiMemAvg").innerHTML = `${memS.avg}<span>%</span>`;
    document.getElementById("kpiMemMax").innerHTML = `${memS.max}<span>%</span>`;
    renderPlanCharts(plan);
  }
}

function populateDatabaseDropdown(restoreKey) {
  const select = document.getElementById("dbSelector");
  if (!select) return;
  select.innerHTML = "";
  let restoreIdx = 0;
  filteredDbData.forEach((db, idx) => {
    const option = document.createElement("option");
    option.value = idx;
    const prefix = selectedSubId === 'all' && db.subName ? `[${db.subName}] ` : '';
    option.text = `${prefix}${db.dbName} (${db.serverName})`;
    select.appendChild(option);
    if (restoreKey && `${db.dbName}|${db.subId || ''}` === restoreKey) restoreIdx = idx;
  });
  select.value = restoreIdx;
}

function handleDbSelection() {
  const select = document.getElementById("dbSelector");
  if (!select) return;
  const idx = select.value;
  const db = filteredDbData[idx];
  if (db) {
    const dtuData = db.dtu.length > 0 ? db.dtu : db.cpu;
    const dtuS = calcStats(dtuData);
    const stoS = calcStats(db.storage);
    document.getElementById("kpiDbMin").innerHTML  = `${dtuS.min}<span>%</span>`;
    document.getElementById("kpiDbAvg").innerHTML  = `${dtuS.avg}<span>%</span>`;
    document.getElementById("kpiDbMax").innerHTML  = `${dtuS.max}<span>%</span>`;
    document.getElementById("kpiStoMin").innerHTML = `${stoS.min}<span>%</span>`;
    document.getElementById("kpiStoAvg").innerHTML = `${stoS.avg}<span>%</span>`;
    document.getElementById("kpiStoMax").innerHTML = `${stoS.max}<span>%</span>`;
    renderDbCharts(db);
  }
}

// ─── Render Plan Charts ──────────────────────────────────────────────────────
function renderPlanCharts(plan) {
  const labels = plan.labels || [];
  const ctxCpu = document.getElementById("cpuChart").getContext("2d");
  const ctxMem = document.getElementById("memoryChart").getContext("2d");

  if (cpuChartInstance && memChartInstance) {
    try {
      cpuChartInstance.data.labels = labels;
      cpuChartInstance.data.datasets[0].data = plan.cpu;
      cpuChartInstance.update('none');
      memChartInstance.data.labels = labels;
      memChartInstance.data.datasets[0].data = plan.memory;
      memChartInstance.update('none');
      return;
    } catch (e) {
      cpuChartInstance.destroy(); cpuChartInstance = null;
      memChartInstance.destroy(); memChartInstance = null;
    }
  }

  cpuChartInstance = new Chart(ctxCpu, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "CPU %",
        data: plan.cpu,
        borderColor: "#6366f1",
        backgroundColor: createGradient(ctxCpu, 'rgba(99, 102, 241, 0.4)'),
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: commonOptions
  });

  memChartInstance = new Chart(ctxMem, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Memory %",
        data: plan.memory,
        borderColor: "#a855f7",
        backgroundColor: createGradient(ctxMem, 'rgba(168, 85, 247, 0.4)'),
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: commonOptions
  });
}

// ─── Render DB Charts ────────────────────────────────────────────────────────
function renderDbCharts(db) {
  const labels = db.labels || [];
  const dtuData = db.dtu.length > 0 ? db.dtu : db.cpu;
  const ctxDtu = document.getElementById("dtuChart").getContext("2d");
  const ctxSto = document.getElementById("dbStorageChart").getContext("2d");

  if (dtuChartInstance && dbStorageChartInstance) {
    try {
      dtuChartInstance.data.labels = labels;
      dtuChartInstance.data.datasets[0].data = dtuData;
      dtuChartInstance.update('none');
      dbStorageChartInstance.data.labels = labels;
      dbStorageChartInstance.data.datasets[0].data = db.storage;
      dbStorageChartInstance.update('none');
      return;
    } catch (e) {
      dtuChartInstance.destroy(); dtuChartInstance = null;
      dbStorageChartInstance.destroy(); dbStorageChartInstance = null;
    }
  }

  dtuChartInstance = new Chart(ctxDtu, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "DTU %",
        data: dtuData,
        borderColor: "#6366f1",
        backgroundColor: createGradient(ctxDtu, 'rgba(99, 102, 241, 0.4)'),
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: commonOptions
  });

  dbStorageChartInstance = new Chart(ctxSto, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Storage %",
        data: db.storage,
        borderColor: "#06b6d4",
        backgroundColor: createGradient(ctxSto, 'rgba(6, 182, 212, 0.4)'),
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: commonOptions
  });
}


function calcStats(dataArr) {
  if (!dataArr || dataArr.length === 0) return { min: 0, max: 0, avg: 0 };
  const valid = dataArr.filter(v => v != null);
  if (valid.length === 0) return { min: 0, max: 0, avg: 0 };
  
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const sum = valid.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / valid.length);
  
  return { min, max, avg };
}


// ─── Render Secrets ──────────────────────────────────────────────────────────
function renderSecrets(secrets) {
  const tbody = document.getElementById("secretsTableBody");
  tbody.innerHTML = "";

  if (!secrets || secrets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No secrets tracked yet.</div></td></tr>`;
    return;
  }

  secrets.forEach(sec => {
    const status = getExpiryStatus(sec.expiry);
    const isDemo = String(sec._id).startsWith("demo");
    const progressClass = status.days < 0 ? 'bg-danger' : status.days <= 30 ? 'bg-warning' : 'bg-success';
    const percent = status.days < 0 ? 0 : Math.min(100, (status.days / 365) * 100);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight:500; color:var(--text-main);">${escHtml(sec.name)}</div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">
          ${sec.source === 'keyvault' ? '<span style="color:var(--accent);">Key Vault</span>' : 
            sec.source === 'azure' ? '<span style="color:var(--success);">App Reg</span>' : 'Manual'}
        </div>
      </td>
      <td style="font-family:monospace; font-size:12px;">${escHtml(sec.appId || "—")}</td>
      <td>${escHtml(sec.secretName || "Secret")}</td>
      <td>
        <div>${sec.expiry ? formatDate(sec.expiry) : "—"}</div>
        <div class="expiry-track"><div class="expiry-fill ${progressClass}" style="width: ${percent}%"></div></div>
      </td>
      <td>${pillHtml(status)}</td>
      <td>${
        isDemo
          ? `<button class="btn btn-danger" disabled style="opacity:.4; padding:6px 12px; font-size:11px;">Delete</button>`
          : `<button class="btn btn-danger" style="padding:6px 12px; font-size:11px;" onclick="deleteAppSecret('${sec._id}')">Delete</button>`
      }</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render Certificates ─────────────────────────────────────────────────────
function renderCertificates(certs) {
  const tbody = document.getElementById("certsTableBody");
  tbody.innerHTML = "";

  if (!certs || certs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No endpoints tracked yet.</div></td></tr>`;
    return;
  }

  certs.forEach(cert => {
    const sslSt  = getExpiryStatus(cert.sslExpiry);
    const domSt  = getExpiryStatus(cert.domainExpiry);
    const isDemo = String(cert._id).startsWith("demo");

    const renderExpiry = (dateStr, statusObj) => {
      if (!dateStr) return "—";
      const progressClass = statusObj.days < 0 ? 'bg-danger' : statusObj.days <= 30 ? 'bg-warning' : 'bg-success';
      const percent = statusObj.days < 0 ? 0 : Math.min(100, (statusObj.days / 365) * 100);
      return `
        <div>${formatDate(dateStr)}</div>
        <div class="expiry-track"><div class="expiry-fill ${progressClass}" style="width: ${percent}%"></div></div>
        <div style="margin-top:4px;">${pillHtml(statusObj)}</div>
      `;
    };

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:500; color:var(--text-main);">${escHtml(cert.domain)}</td>
      <td>${renderExpiry(cert.sslExpiry, sslSt)}</td>
      <td>${renderExpiry(cert.domainExpiry, domSt)}</td>
      <td style="max-width:200px; color:var(--text-muted); font-size:12px;">${escHtml(cert.notes || "—")}</td>
      <td>${isDemo
        ? `<button class="btn btn-danger" disabled style="opacity:.4; padding:6px 12px; font-size:11px;">Delete</button>`
        : `<button class="btn btn-danger" style="padding:6px 12px; font-size:11px;" onclick="deleteCertificate('${cert._id}')">Delete</button>`
      }</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Dummy Fallback Data ──────────────────────────────────────────────────────
function getDummyLabelsData() {
  let tf = "7d";
  const el = document.getElementById("timeframeSelector");
  if (el) tf = el.value;

  let points = 24;
  let intervalMs = 3600000;

  switch(tf) {
    case '30m': points = 30; intervalMs = 60000; break;
    case '1h': points = 60; intervalMs = 60000; break;
    case '4h': points = 48; intervalMs = 5 * 60000; break;
    case '12h': points = 48; intervalMs = 15 * 60000; break;
    case '1d': points = 24; intervalMs = 3600000; break;
    case '3d': points = 72; intervalMs = 3600000; break;
    case '7d': points = 168; intervalMs = 3600000; break;
  }

  const labels = Array.from({ length: points }, (_, i) => {
    const d = new Date(Date.now() - (points - i - 1) * intervalMs);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(',', '');
  });
  return { labels, points };
}

function dummyPlans() {
  const { labels } = getDummyLabelsData();
  const rand   = (min, max) => Math.floor(Math.random() * (max - min)) + min;
  return [
    { planName: "prod-api-plan",  sku: "P2v3", labels,
      cpu:    labels.map(() => rand(20, 65)), memory: labels.map(() => rand(45, 80)) },
    { planName: "dev-frontend-plan", sku: "B2",   labels,
      cpu:    labels.map(() => rand(5,  35)), memory: labels.map(() => rand(30, 60)) },
    { planName: "worker-batch-plan", sku: "P1v3", labels,
      cpu:    labels.map(() => rand(2,  20)), memory: labels.map(() => rand(50, 75)) }
  ];
}

function dummySecrets() {
  const n = Date.now();
  return [
    { _id: "demo-s1", name: "Frontend Auth App",  appId: "app-1234-abcd", secretName: "client-secret-v1", expiry: new Date(n + 86400000 *  5).toISOString() },
    { _id: "demo-s2", name: "API Gateway",         appId: "api-5678-efgh", secretName: "gateway-proxy-key", expiry: new Date(n + 86400000 * 90).toISOString() },
    { _id: "demo-s3", name: "Legacy DB Bridge",    appId: "leg-9012-ijkl", secretName: "sql-legacy-pass",  expiry: new Date(n - 86400000 *  2).toISOString() },
    { _id: "demo-s4", name: "Azure Storage Key",   appId: "st-4421-mnop", secretName: "primary-blob-key",  expiry: new Date(n + 86400000 * 25).toISOString() },
    { _id: "demo-s5", name: "Notification Hub",    appId: "hub-9981-qrst", secretName: "hub-access-key",   expiry: new Date(n + 86400000 * 310).toISOString() }
  ];
}

function dummyCertificates() {
  const n = Date.now();
  return [
    { _id: "demo-c1", domain: "api.contoso.com",    sslExpiry: new Date(n + 86400000 * 10).toISOString(), domainExpiry: new Date(n + 86400000 * 200).toISOString(), notes: "Azure App Service managed cert" },
    { _id: "demo-c2", domain: "portal.contoso.com", sslExpiry: new Date(n + 86400000 * 80).toISOString(), domainExpiry: new Date(n + 86400000 * 365).toISOString(), notes: "Let's Encrypt via Certbot" },
    { _id: "demo-c3", domain: "legacy.contoso.com", sslExpiry: new Date(n - 86400000 *  3).toISOString(), domainExpiry: new Date(n + 86400000 *  20).toISOString(), notes: "Needs renewal — expired!" },
    { _id: "demo-c4", domain: "docs.contoso.com",   sslExpiry: new Date(n + 86400000 * 45).toISOString(), domainExpiry: new Date(n + 86400000 * 500).toISOString(), notes: "GoDaddy Standard SSL" }
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getExpiryStatus(dateStr) {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0)   return { cls: "pill-danger",  text: "Expired",             days };
  if (days <= 30) return { cls: "pill-warning", text: `Expiring in ${days}d`, days };
  return             { cls: "pill-success",   text: `Valid · ${days}d left`,  days };
}

function pillHtml(status) {
  if (!status) return `<span class="pill" style="background:var(--bg-surface);color:var(--text-muted)">N/A</span>`;
  return `<span class="pill ${status.cls}">${status.text}</span>`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

// Duplicate Database Rendering removed


function dummyDbs() {
  const { labels } = getDummyLabelsData();
  const rand = (min, max) => Math.floor(Math.random() * (max - min)) + min;
  return [
    {
      dbName: "PROD-SQL-DB",
      serverName: "prod-server",
      cpu: labels.map(() => rand(10, 45)),
      dtu: labels.map(() => rand(12, 50)),
      storage: labels.map(() => rand(65, 70)),
      labels
    },
    {
      dbName: "STAGING-SQL-DB",
      serverName: "stage-server",
      cpu: labels.map(() => rand(2, 12)),
      dtu: labels.map(() => rand(5, 25)),
      storage: labels.map(() => rand(12, 15)),
      labels
    }
  ];
}

function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
