import { REST, Routes } from "discord.js";
import { config } from "../src/config.js";
import * as leaderboard from "../src/commands/leaderboard.js";

// Guild commands update instantly. Run again after changing a command.
const rest = new REST().setToken(config.token);
const body = [leaderboard.data.toJSON()];
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
console.log(`Registered ${body.length} command(s) in the server.`);
