const REQUIRED = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "STAFF_ROLE_ID",
  "SAAS_BASE_URL",
  "BOT_API_KEY",
];

const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  // Names only, never values.
  console.error(`Missing env vars: ${missing.join(", ")}. See .env.example.`);
  process.exit(1);
}

const baseUrl = new URL(process.env.SAAS_BASE_URL.trim());
if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
  console.error("SAAS_BASE_URL must use https:// (the bot key travels in a header).");
  process.exit(1);
}

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN.trim(),
  clientId: process.env.DISCORD_CLIENT_ID.trim(),
  guildId: process.env.DISCORD_GUILD_ID.trim(),
  staffRoleId: process.env.STAFF_ROLE_ID.trim(),
  saasBaseUrl: baseUrl,
  botApiKey: process.env.BOT_API_KEY.trim(),
});
