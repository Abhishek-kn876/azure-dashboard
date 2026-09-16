const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGO_URI);
const DB = "metricsdb";

async function connectDB() {
  await client.connect();
  const col = client.db(DB).collection("appservice");
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 604800 });
  return col;
}

async function connectCertsDB() {
  await client.connect();
  return client.db(DB).collection("certificates");
}

async function connectAppSecretsDB() {
  await client.connect();
  return client.db(DB).collection("appSecrets");
}

async function connectSubscriptionsDB() {
  await client.connect();
  return client.db(DB).collection("subscriptions");
}

async function connectNotificationsDB() {
  await client.connect();
  return client.db(DB).collection("notifications");
}

module.exports = { connectDB, connectCertsDB, connectAppSecretsDB, connectSubscriptionsDB, connectNotificationsDB };
