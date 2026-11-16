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

client.login(config.token);
