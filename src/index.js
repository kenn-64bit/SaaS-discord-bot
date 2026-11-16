import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "./config.js";
import * as leaderboard from "./commands/leaderboard.js";

const commands = new Map([[leaderboard.data.name, leaderboard]]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => console.log(`Online as ${c.user.tag}`));

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[/${interaction.commandName}]`, err);
    const reply = { content: "Something went wrong.", flags: MessageFlags.Ephemeral };
    await (interaction.deferred || interaction.replied ? interaction.editReply(reply) : interaction.reply(reply)).catch(() => {});
  }
});

// Never let one bad interaction take the bot down.
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// discord.js reconnects by itself; these lines just make it visible in the logs.
client.on(Events.Error, (err) => console.error("[client]", err.message));
client.on(Events.ShardDisconnect, (event) => console.warn(`Disconnected (code ${event.code})`));
client.on(Events.ShardResume, () => console.log("Reconnected"));

// A failed login (no network yet, bad token) must end the process so the
// service restarts it, instead of leaving it running but never connected.
client.login(config.token).catch((err) => {
  console.error(`Login failed: ${err.code ?? err.name}: ${err.message}`);
  process.exit(1);
});
