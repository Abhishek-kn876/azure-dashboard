require("dotenv").config({ path: "../.env" });
const express      = require("express");
const cookieParser = require("cookie-parser");
const jwt          = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const {
  fetchMetrics,
  fetchDatabaseMetrics,
  fetchAppRegistrationSecrets,
  listKeyVaults,
  fetchKeyVaultSecrets
} = require("./azureMetrics");
const nodemailer = require("nodemailer");
const { connectCertsDB, connectAppSecretsDB, connectSubscriptionsDB, connectNotificationsDB } = require("./db");

const JWT_SECRET   = process.env.JWT_SECRET;
const ADMIN_USER   = process.env.ADMIN_USER;
const ADMIN_PASS   = process.env.ADMIN_PASS;

if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set in .env");
  process.exit(1);
}

const mailerTransport = nodemailer.createTransport({
  service: "hotmail",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const app = express();
app.use(express.json());
app.use(cookieParser());

/* ─── Auth middleware ────────────────────────────────────────────────────── */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

let certsCollection;
let appSecretsCollection;
let subscriptionsCollection;
let notificationsCollection;

(async () => {
  try {
    certsCollection         = await connectCertsDB();
    appSecretsCollection    = await connectAppSecretsDB();
    subscriptionsCollection = await connectSubscriptionsDB();
    notificationsCollection = await connectNotificationsDB();
    console.log("MongoDB collections ready");

    // Start background sync every 1 hour
    const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      console.log("Running scheduled Azure secrets sync and expiry check...");
      const subs = await subscriptionsCollection.find({}).toArray();
      for (const sub of subs) {
        try {
          await syncAzureSecretsToDB(sub.subId, sub.clientId, sub.clientSecret, sub.tenantId);
        } catch (err) {
          console.error(`Scheduled sync failed for sub ${sub.subId}:`, err.message);
        }
      }
      // Check for expiries after sync
      await checkExpiriesAndNotify();
    }, SYNC_INTERVAL);

    // Initial sync on startup
    setTimeout(async () => {
      const subs = await subscriptionsCollection.find({}).toArray();
      const syncPromises = subs.map(sub => 
        syncAzureSecretsToDB(sub.subId, sub.clientId, sub.clientSecret, sub.tenantId).catch(console.error)
      );
      await Promise.all(syncPromises);
      await checkExpiriesAndNotify();
    }, 5000);

  } catch (e) {
    console.error("DB init error:", e.message);
  }
})();

/* ─── Auth ───────────────────────────────────────────────────────────────── */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ success: false });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "8h" });
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ success: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

/* ─── Apply auth to all routes below this line ───────────────────────────── */
app.use(requireAuth);

/* ─── Azure Dashboard Data (metrics + Graph API secrets) ─────────────────── */
app.post("/api/dashboard-data", async (req, res) => {
  const { subscriptionId, timeframe } = req.body;

  if (!subscriptionId) {
    return res.status(400).json({ error: "subscriptionId is required" });
  }

  const sub = await subscriptionsCollection.findOne({ subId: subscriptionId });
  if (!sub) return res.status(404).json({ error: "Subscription not found" });

  const { clientId, clientSecret, tenantId } = sub;

  syncAzureSecretsToDB(subscriptionId, clientId, clientSecret, tenantId).catch(console.error);

  try {
    const [metricsResult, dbMetricsResult, secretsResult] = await Promise.allSettled([
      fetchMetrics(subscriptionId, clientId, clientSecret, tenantId, timeframe),
      fetchDatabaseMetrics(subscriptionId, clientId, clientSecret, tenantId, timeframe),
      fetchAppRegistrationSecrets(clientId, clientSecret, tenantId)
    ]);

    res.json({
      metrics:        metricsResult.status   === "fulfilled" ? metricsResult.value         : [],
      dbMetrics:      dbMetricsResult.status === "fulfilled" ? dbMetricsResult.value       : [],
      secrets:        secretsResult.status   === "fulfilled" ? secretsResult.value         : [],
      metricsError:   metricsResult.status   === "rejected"  ? metricsResult.reason.message  : null,
      dbMetricsError: dbMetricsResult.status === "rejected"  ? dbMetricsResult.reason.message : null,
      secretsError:   secretsResult.status   === "rejected"  ? secretsResult.reason.message  : null
    });

    if (metricsResult.status === "rejected")   console.error("Metrics Fetch Error:", metricsResult.reason);
    if (dbMetricsResult.status === "rejected") console.error("DB Metrics Fetch Error:", dbMetricsResult.reason);
  } catch (e) {
    console.error("Dashboard Data API Error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ─── Certificates CRUD ─────────────────────────────────────────────────── */
app.get("/api/certificates", async (req, res) => {
  try {
    res.json(await certsCollection.find({}).sort({ createdAt: -1 }).toArray());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/certificates", async (req, res) => {
  try {
    const { domain, sslExpiry, domainExpiry, notes } = req.body;
    if (!domain) return res.status(400).json({ error: "domain is required" });

    const doc = {
      domain:      domain.trim(),
      sslExpiry:   sslExpiry    ? new Date(sslExpiry)    : null,
      domainExpiry:domainExpiry ? new Date(domainExpiry) : null,
      notes:       notes || "",
      createdAt:   new Date()
    };
    const result = await certsCollection.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/certificates/:id", async (req, res) => {
  try {
    const result = await certsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── App Secrets CRUD ──────────────────────────────────────────────────── */
app.get("/api/app-secrets", async (req, res) => {
  try {
    res.json(await appSecretsCollection.find({}).sort({ createdAt: -1 }).toArray());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/app-secrets", async (req, res) => {
  try {
    const { name, appId, secretName, expiry, notes } = req.body;
    if (!name)   return res.status(400).json({ error: "name is required" });
    if (!expiry) return res.status(400).json({ error: "expiry is required" });

    const doc = {
      name:       name.trim(),
      appId:      appId?.trim()      || "",
      secretName: secretName?.trim() || "Secret",
      expiry:     new Date(expiry),
      notes:      notes || "",
      source:     "manual",
      createdAt:  new Date()
    };
    const result = await appSecretsCollection.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/app-secrets/:id", async (req, res) => {
  try {
    const result = await appSecretsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Delete ALL secrets linked to a subscription (called on subscription removal) */
app.delete("/api/app-secrets/by-subscription/:subId", async (req, res) => {
  try {
    const result = await appSecretsCollection.deleteMany({ subscriptionId: req.params.subId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Subscriptions CRUD ─────────────────────────────────────────────────── */
app.get("/api/subscriptions", async (req, res) => {
  try {
    res.json(await subscriptionsCollection.find({}).toArray());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/subscriptions", async (req, res) => {
  try {
    const { name, subId, tenantId, clientId, clientSecret } = req.body;
    if (!subId || !tenantId || !clientId || !clientSecret) {
      return res.status(400).json({ error: "All credentials fields are required" });
    }
    const doc = { 
      name: name?.trim() || "Azure Account", 
      subId, 
      tenantId, 
      clientId, 
      clientSecret, 
      createdAt: new Date() 
    };
    const result = await subscriptionsCollection.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/subscriptions/:id", async (req, res) => {
  try {
    const result = await subscriptionsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sync-secrets", async (req, res) => {
  try {
    const subs = await subscriptionsCollection.find({}).toArray();
    if (subs.length === 0) return res.status(400).json({ error: "No subscriptions configured" });
    await Promise.all(
      subs.map(sub =>
        syncAzureSecretsToDB(sub.subId, sub.clientId, sub.clientSecret, sub.tenantId).catch(console.error)
      )
    );
    await checkExpiriesAndNotify();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── Notification Settings CRUD ────────────────────────────────────────── */
app.get("/api/notification-settings", async (req, res) => {
  try {
    const settings = await notificationsCollection.findOne({ type: "email_list" });
    res.json(settings || { emails: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/notification-settings", async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) return res.status(400).json({ error: "emails must be an array" });
    
    await notificationsCollection.updateOne(
      { type: "email_list" },
      { $set: { emails, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Sync Logic ─────────────────────────────────────────────────────────── */
async function syncAzureSecretsToDB(subscriptionId, clientId, clientSecret, tenantId) {
  try {
    console.log("Starting Azure to MongoDB sync...");
    
    // 1. Fetch App Registration Secrets
    const appSecrets = await fetchAppRegistrationSecrets(clientId, clientSecret, tenantId);
    
    // 2. Fetch Key Vault Secrets
    const vaults = await listKeyVaults(subscriptionId, clientId, clientSecret, tenantId);
    let kvSecrets = [];
    for (const vault of vaults) {
      const vaultSecrets = await fetchKeyVaultSecrets(vault.name, clientId, clientSecret, tenantId);
      kvSecrets = kvSecrets.concat(vaultSecrets);
    }

    const allAzureSecrets = [...appSecrets, ...kvSecrets];

    // 3. Upsert into MongoDB — tag each secret with its subscriptionId
    for (const sec of allAzureSecrets) {
      await appSecretsCollection.updateOne(
        { 
          name: sec.name, 
          secretName: sec.secretName, 
          source: sec.source,
          subscriptionId: subscriptionId
        },
        { 
          $set: { 
            ...sec,
            expiry: sec.expiry ? new Date(sec.expiry) : null, // Ensure Date object for MongoDB queries
            subscriptionId: subscriptionId,
            updatedAt: new Date() 
          } 
        },
        { upsert: true }
      );
    }
    
    console.log(`Sync complete. Processed ${allAzureSecrets.length} secrets.`);
  } catch (e) {
    console.error("Sync Error:", e.message);
  }
}

/* ─── Notification & Expiry Logic ─────────────────────────────────────────── */
async function checkExpiriesAndNotify() {
  try {
    console.log("Checking for expiring items...");
    const settings = await notificationsCollection.findOne({ type: "email_list" });
    if (!settings || !settings.emails || settings.emails.length === 0) {
      console.log("No notification emails configured. Skipping.");
      return;
    }

    const fifteenDaysFromNow = new Date();
    fifteenDaysFromNow.setDate(fifteenDaysFromNow.getDate() + 15);

    // 1. Check App Secrets
    const expiringSecrets = await appSecretsCollection.find({
      expiry: { $lte: fifteenDaysFromNow, $gt: new Date() }
    }).toArray();

    // 2. Check Certificates
    const expiringCerts = await certsCollection.find({
      $or: [
        { sslExpiry: { $lte: fifteenDaysFromNow, $gt: new Date() } },
        { domainExpiry: { $lte: fifteenDaysFromNow, $gt: new Date() } }
      ]
    }).toArray();

    if (expiringSecrets.length > 0 || expiringCerts.length > 0) {
      console.log(`Found ${expiringSecrets.length} secrets and ${expiringCerts.length} certs expiring soon.`);
      await sendExpiryEmail(settings.emails, expiringSecrets, expiringCerts);
    } else {
      console.log("No items expiring within 15 days.");
    }
  } catch (e) {
    console.error("Expiry check error:", e.message);
  }
}

async function sendExpiryEmail(emails, secrets, certs) {
  let htmlContent = `<h2>Azure Metrics Hub - Expiry Notification</h2>`;
  
  if (secrets.length > 0) {
    htmlContent += `<h3>Expiring App Secrets</h3><ul>`;
    secrets.forEach(s => {
      htmlContent += `<li><strong>${s.name}</strong> (${s.secretName}) - Expires on: ${new Date(s.expiry).toDateString()}</li>`;
    });
    htmlContent += `</ul>`;
  }

  if (certs.length > 0) {
    htmlContent += `<h3>Expiring Certificates/Domains</h3><ul>`;
    certs.forEach(c => {
      if (c.sslExpiry && new Date(c.sslExpiry) <= new Date(new Date().getTime() + 15 * 86400000)) {
        htmlContent += `<li><strong>${c.domain} (SSL)</strong> - Expires on: ${new Date(c.sslExpiry).toDateString()}</li>`;
      }
      if (c.domainExpiry && new Date(c.domainExpiry) <= new Date(new Date().getTime() + 15 * 86400000)) {
        htmlContent += `<li><strong>${c.domain} (Domain)</strong> - Expires on: ${new Date(c.domainExpiry).toDateString()}</li>`;
      }
    });
    htmlContent += `</ul>`;
  }

  htmlContent += `<p>Please take necessary actions to renew these items.</p>`;

  try {
    await mailerTransport.sendMail({
      from: process.env.SMTP_FROM,
      to: emails.join(", "),
      subject: "⚠️ Azure Metrics Hub: Expiry Alert",
      html: htmlContent
    });
    console.log(`Notification email sent to ${emails.length} recipients.`);
  } catch (e) {
    console.error("Email sending failed:", e.message);
  }
}

/* ─── Start ─────────────────────────────────────────────────────────────── */
app.listen(3000, () => console.log("Backend running on port 3000"));
