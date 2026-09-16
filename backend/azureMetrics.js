const axios = require("axios");
const { ClientSecretCredential } = require("@azure/identity");

async function getToken(clientId, clientSecret, tenantId, scope = "https://management.azure.com/.default") {
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const token = await credential.getToken(scope);
  return token.token;
}

/**
 * Lists all App Service Plans in the subscription and fetches
 * hourly Max CPU % and Max Memory % for the last 24 hours per plan.
 */
async function fetchMetrics(subscriptionId, clientId, clientSecret, tenantId, timeframe = '7d') {
  const token = await getToken(clientId, clientSecret, tenantId);

  // 1. List all App Service Plans
  const plansUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Web/serverfarms?api-version=2022-03-01`;

  const plansRes = await axios.get(plansUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const plans = plansRes.data.value || [];
  if (plans.length === 0) return [];

  // 2. Fetch CPU & Memory metrics for each plan (last 24h, hourly Max)
  const now = new Date();
  let ms = 7 * 24 * 60 * 60 * 1000;
  let interval = 'PT1H';

  switch (timeframe) {
    case '30m': ms = 30 * 60 * 1000; interval = 'PT1M'; break;
    case '1h': ms = 60 * 60 * 1000; interval = 'PT1M'; break;
    case '4h': ms = 4 * 60 * 60 * 1000; interval = 'PT5M'; break;
    case '12h': ms = 12 * 60 * 60 * 1000; interval = 'PT15M'; break;
    case '1d': ms = 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
    case '3d': ms = 3 * 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
    case '7d': ms = 7 * 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
  }
  const start = new Date(now.getTime() - ms);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;

  const results = await Promise.allSettled(
    plans.map(async (plan) => {
      const metricsUrl =
        `https://management.azure.com${plan.id}` +
        `/providers/microsoft.insights/metrics` +
        `?api-version=2021-05-01` +
        `&metricnames=CpuPercentage,MemoryPercentage` +
        `&timespan=${timespan}` +
        `&interval=${interval}` +
        `&aggregation=Maximum`;

      const metricsRes = await axios.get(metricsUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const metricsData = metricsRes.data.value || [];
      const cpuMetric = metricsData.find(m => m.name.value === "CpuPercentage");
      const memMetric = metricsData.find(m => m.name.value === "MemoryPercentage");

      const extract = (metric) =>
        metric?.timeseries?.[0]?.data?.map(d => d.maximum ?? null) ?? [];

      const extractLabels = (metric) =>
        metric?.timeseries?.[0]?.data?.map(d =>
          new Date(d.timeStamp).toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
          }).replace(',', '')
        ) ?? [];

      return {
        planName: plan.name,
        location: plan.location,
        sku:      plan.sku?.name || "Unknown",
        cpu:      extract(cpuMetric),
        memory:   extract(memMetric),
        labels:   extractLabels(cpuMetric)
      };
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);
}

/**
 * Lists all Azure SQL Databases in the subscription and fetches
 * hourly Max CPU % and DTU % for the last 24 hours per database.
 */
async function fetchDatabaseMetrics(subscriptionId, clientId, clientSecret, tenantId, timeframe = '7d') {
  const token = await getToken(clientId, clientSecret, tenantId);

  // 1. List all SQL Servers then Databases
  // For simplicity, we list all resources of type Microsoft.Sql/servers/databases
  const resourcesUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Sql/servers?api-version=2021-11-01`;

  const serversRes = await axios.get(resourcesUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const servers = serversRes.data.value || [];
  const dbPromises = servers.map(async (server) => {
    const dbsUrl = `https://management.azure.com${server.id}/databases?api-version=2021-11-01`;
    const dbsRes = await axios.get(dbsUrl, { headers: { Authorization: `Bearer ${token}` } });
    return (dbsRes.data.value || [])
      .filter(db => db.name !== "master") // Skip master db
      .map(db => ({ ...db, serverName: server.name }));
  });

  const dbsArrays = await Promise.all(dbPromises);
  const dbs = dbsArrays.flat();

  if (dbs.length === 0) return [];

  const now = new Date();
  let ms = 7 * 24 * 60 * 60 * 1000;
  let interval = 'PT1H';

  switch (timeframe) {
    case '30m': ms = 30 * 60 * 1000; interval = 'PT1M'; break;
    case '1h': ms = 60 * 60 * 1000; interval = 'PT1M'; break;
    case '4h': ms = 4 * 60 * 60 * 1000; interval = 'PT5M'; break;
    case '12h': ms = 12 * 60 * 60 * 1000; interval = 'PT15M'; break;
    case '1d': ms = 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
    case '3d': ms = 3 * 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
    case '7d': ms = 7 * 24 * 60 * 60 * 1000; interval = 'PT1H'; break;
  }
  const start = new Date(now.getTime() - ms);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;

  const results = await Promise.allSettled(
    dbs.map(async (db) => {
      const metricsUrl =
        `https://management.azure.com${db.id}` +
        `/providers/microsoft.insights/metrics` +
        `?api-version=2021-05-01` +
        `&metricnames=cpu_percent,dtu_consumption_percent,storage_percent` +
        `&timespan=${timespan}` +
        `&interval=${interval}` +
        `&aggregation=Maximum`;

      const metricsRes = await axios.get(metricsUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const metricsData = metricsRes.data.value || [];
      const cpuMetric = metricsData.find(m => m.name.value === "cpu_percent");
      const dtuMetric = metricsData.find(m => m.name.value === "dtu_consumption_percent");
      const storageMetric = metricsData.find(m => m.name.value === "storage_percent");

      const extract = (metric) =>
        metric?.timeseries?.[0]?.data?.map(d => d.maximum ?? null) ?? [];

      const extractLabels = (metric) =>
        metric?.timeseries?.[0]?.data?.map(d =>
          new Date(d.timeStamp).toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
          }).replace(',', '')
        ) ?? [];

      return {
        dbName:     db.name,
        serverName: db.serverName,
        cpu:        extract(cpuMetric),
        dtu:        extract(dtuMetric),
        storage:    extract(storageMetric),
        labels:     extractLabels(cpuMetric || dtuMetric)
      };
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);
}

/**
 * Uses the Microsoft Graph API to list all App Registrations
 * and return their password credential expiry dates.
 */
async function fetchAppRegistrationSecrets(clientId, clientSecret, tenantId) {
  const token = await getToken(clientId, clientSecret, tenantId, "https://graph.microsoft.com/.default");
  const url =
    "https://graph.microsoft.com/v1.0/applications" +
    "?$select=displayName,appId,passwordCredentials&$top=100";

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const secrets = [];
  (res.data.value || []).forEach(app => {
    (app.passwordCredentials || []).forEach(cred => {
      secrets.push({
        name:       app.displayName,
        appId:      app.appId,
        secretName: cred.displayName || "Secret",
        expiry:     cred.endDateTime,
        source:     "azure"
      });
    });
  });

  return secrets;
}

/**
 * Lists all Key Vaults in the subscription.
 */
async function listKeyVaults(subscriptionId, clientId, clientSecret, tenantId) {
  const token = await getToken(clientId, clientSecret, tenantId);
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.KeyVault/vaults?api-version=2023-02-01`;
  
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.data.value || [];
  } catch (e) {
    console.error("Error listing Key Vaults:", e.message);
    return [];
  }
}

/**
 * Fetches secrets from a specific Key Vault.
 */
async function fetchKeyVaultSecrets(vaultName, clientId, clientSecret, tenantId) {
  const token = await getToken(clientId, clientSecret, tenantId, "https://vault.azure.net/.default");
  const url = `https://${vaultName}.vault.azure.net/secrets?api-version=7.4`;

  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    const secrets = res.data.value || [];
    
    return secrets.map(s => {
      // Secret ID is like https://vaultname.vault.azure.net/secrets/secretname/version
      const name = s.id.split("/")[4];
      return {
        name: vaultName,
        appId: "Key Vault",
        secretName: name,
        expiry: s.attributes?.exp ? new Date(s.attributes.exp * 1000).toISOString() : null,
        source: "keyvault"
      };
    });
  } catch (e) {
    console.error(`Error fetching secrets from vault ${vaultName}:`, e.message);
    return [];
  }
}

module.exports = { 
  fetchMetrics, 
  fetchDatabaseMetrics, 
  fetchAppRegistrationSecrets,
  listKeyVaults,
  fetchKeyVaultSecrets
};
