const nodemailer = require("nodemailer");

const smtpHost = String(process.env.SMTP_HOST || "smtp-mail.outlook.com").trim();
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpUser = String(process.env.SMTP_USER || "").trim();
const smtpPass = String(process.env.SMTP_PASS || "").trim();
const notifyTo = String(process.env.SYNC_NOTIFY_TO || "").trim();
const notifyFrom = String(process.env.SYNC_NOTIFY_FROM || smtpUser || "").trim();

function hasEmailConfig() {
  return !!smtpHost && !!smtpPort && !!smtpUser && !!smtpPass && !!notifyTo && !!notifyFrom;
}

function buildSubject(kind, summary) {
  if (kind === "failure") return `AISS Catalog Sync Failed - ${summary?.trigger || "manual"}`;
  return `AISS Catalog Sync Completed - ${summary?.trigger || "manual"}`;
}

function buildText(kind, payload) {
  if (kind === "failure") {
    return [
      "AISS catalog sync failed.",
      "",
      `Trigger: ${payload?.trigger || "manual"}`,
      `Time: ${new Date().toLocaleString("en-MY")}`,
      `Error: ${payload?.error || "Unknown error"}`
    ].join("\n");
  }

  const summary = payload || {};
  const categories = Array.isArray(summary.categories)
    ? summary.categories.map((item) => `- ${item.appCategory}: seen ${item.productsSeen}, upserted ${item.productsUpserted}`).join("\n")
    : "No category details.";

  return [
    "AISS catalog sync completed successfully.",
    "",
    `Trigger: ${summary.trigger || "manual"}`,
    `Started: ${summary.startedAt || "N/A"}`,
    `Finished: ${summary.finishedAt || new Date().toISOString()}`,
    `Total products seen: ${summary.totalProductsSeen || 0}`,
    `Total products upserted: ${summary.totalProductsUpserted || 0}`,
    "",
    "Categories:",
    categories
  ].join("\n");
}

async function sendSyncEmail(kind, payload) {
  if (!hasEmailConfig()) {
    return {
      sent: false,
      skipped: true,
      reason: "SMTP/email env vars are incomplete."
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  await transporter.sendMail({
    from: notifyFrom,
    to: notifyTo,
    subject: buildSubject(kind, payload),
    text: buildText(kind, payload)
  });

  return {
    sent: true
  };
}

module.exports = {
  hasEmailConfig,
  sendSyncEmail
};
