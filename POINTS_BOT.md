# Points Bot (`points-bot`): spec and build guide

A coded Discord bot that replaces the Kite bot `biscoff`. It has one command, **`/leaderboard`**, for staff only. It reads the Points Dashboard's read-only bot API and never writes anything.

The bot lives in its **own repo** (`points-bot`), not in this dashboard repo. This file has everything needed to create that repo.

**Contents:** [1. What it does](#1-what-it-does) · [2. Create the repo](#2-create-the-repo) · [3. Code](#3-code) · [4. Discord setup](#4-discord-setup) · [5. Local test](#5-local-test) · [6. Deploy to Oracle Cloud](#6-deploy-to-oracle-cloud-always-free) · [7. Replace Kite](#7-replace-kite-and-rotate-the-key) · [8. API reference](#8-bot-api-reference) · [9. Done when](#9-done-when)

---

## 1. What it does

```
/leaderboard [week:YYYY-MM-DD] [user:<name>]
  → list of events, 10 a page        (select menu + ◀ Previous / Next ▶)
  → pick an event → standings, 10 a page   (◀ Previous / Next ▶ / Events)
  user: given → opens on that person's page, with their rank shown at the top
```

- **Staff only, in two layers.** Discord hides the command from everyone until you grant it to your staff role. The bot also checks for `STAFF_ROLE_ID` on every use.
- **Private replies.** Only the person who ran the command sees the reply (ephemeral), and only they can use its buttons.
- **Names exactly as staff typed them.** `user:` must match the dashboard's spelling and case. `ashe` doesn't find `Ashe`.
- **No scheduled posts and no database.** Each reply keeps its page state in memory for 10 minutes. After that its buttons are removed, so you run the command again.
- **Small footprint.** Uses the `Guilds` intent only, no privileged intents. It makes only outgoing connections (to Discord and the dashboard).

## 2. Create the repo

```bash
mkdir points-bot && cd points-bot && git init
mkdir -p src/commands scripts
# create the files from section 3, then:
npm install discord.js@^14
git add . && git commit -m "points-bot: /leaderboard"
```

Needs **Node 22** or later. It uses the built-in `--env-file`, so there's no `dotenv` dependency.

```
points-bot/
├─ src/
│  ├─ index.js              # login, route the command, shut down cleanly
│  ├─ config.js             # read + check env, stop at once if any are missing
│  ├─ saas.js               # dashboard API calls, 10 s timeout
│  ├─ embeds.js             # messages, menus and buttons
│  └─ commands/
│     └─ leaderboard.js     # /leaderboard
├─ scripts/
│  └─ deploy-commands.js    # register the command in your server
├─ ecosystem.config.cjs     # pm2 (.cjs because the package is ESM)
├─ .env.example
├─ .gitignore
└─ package.json
```

## 3. Code

### `package.json`
```json
{
  "name": "points-bot",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node --env-file=.env src/index.js",
    "deploy-commands": "node --env-file=.env scripts/deploy-commands.js"
  },
  "dependencies": {
    "discord.js": "^14.16.3"
  }
}
```

### `.gitignore`
```
node_modules/
.env
*.log
```

### `.env.example`
```
# Discord Developer Portal → your app
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
# Your server's ID, and the staff role allowed to run /leaderboard
DISCORD_GUILD_ID=
STAFF_ROLE_ID=
# Dashboard
SAAS_BASE_URL=https://<my-app>.vercel.app
BOT_API_KEY=
```

### `src/config.js`
```js
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
```

### `src/saas.js`
```js
import { config } from "./config.js";

const TIMEOUT_MS = 10_000;

// An error whose message is safe to show staff in Discord: either the
// dashboard's own `error` text or a fixed message from here.
export class ApiError extends Error {}

async function get(path, params = {}) {
  const url = new URL(path, config.saasBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.botApiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[saas] ${path} failed:`, err.name);
    throw new ApiError(err.name === "TimeoutError" ? "The dashboard took too long to answer." : "Couldn't reach the dashboard.");
  }

  const body = await response.json().catch(() => null);
  if (response.ok && body) return body;

  console.error(`[saas] ${path} → ${response.status}`);
  if (response.status === 429) {
    const wait = response.headers.get("retry-after");
    throw new ApiError(`Too many requests. Try again in ${wait ?? "a few"} seconds.`);
  }
  if (response.status === 401) throw new ApiError("The bot's API key was refused. Tell an admin.");
  throw new ApiError(body?.error ?? `The dashboard answered with an error (${response.status}).`);
}

export const fetchEvents = (page) => get("/api/bot/events", { page });

export const fetchLeaderboard = ({ event, week, page, name }) =>
  get("/api/bot/leaderboard", { event, week, page, name });
```

### `src/embeds.js`
```js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";

const COLOR = 0x3a9a3a;
const ERROR_COLOR = 0xd84a4a;

// Same escaping as the dashboard uses for `text`.
const escape = (text) => text.replace(/[\\*_~`|>]/g, "\\$&");

const button = (id, label, disabled = false, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

export function eventsView(data) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Pick an event")
    .setDescription(data.events.length ? data.events.map((name, i) => `**${i + 1}.** ${escape(name)}`).join("\n") : "No events yet.")
    .setFooter({ text: data.footer });

  const components = [];
  if (data.events.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("lb:pick")
          .setPlaceholder("Choose an event")
          // Values are list positions, so long or duplicate names are fine.
          .addOptions(data.events.map((name, i) => ({ label: name.slice(0, 100), value: String(i) })))
      )
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      button("lb:events-prev", "◀ Previous", data.prevPage === null),
      button("lb:events-next", "Next ▶", data.nextPage === null)
    )
  );
  return { embeds: [embed], components };
}

export function boardView(data) {
  const title = data.week ? `${data.event} · ${data.weekLabel}` : data.event;
  const lines = [];
  if (data.match) {
    lines.push(`🔎 **#${data.match.rank} ${escape(data.match.name)}** — ${data.match.points} pts`, "");
  }
  lines.push(data.text);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title.slice(0, 256))
    .setDescription(lines.join("\n"))
    .setFooter({ text: data.footer });

  const row = new ActionRowBuilder().addComponents(
    button("lb:board-prev", "◀ Previous", data.prevPage === null),
    button("lb:board-next", "Next ▶", data.nextPage === null),
    button("lb:events", "Events", false, ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function errorView(message) {
  const embed = new EmbedBuilder().setColor(ERROR_COLOR).setDescription(`⚠️ ${message}`);
  const row = new ActionRowBuilder().addComponents(button("lb:events", "Events", false, ButtonStyle.Primary));
  return { embeds: [embed], components: [row] };
}

export const expiredView = { components: [] };
```

### `src/commands/leaderboard.js`
```js
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";
import { ApiError, fetchEvents, fetchLeaderboard } from "../saas.js";
import { boardView, errorView, eventsView, expiredView } from "../embeds.js";

const SESSION_MS = 10 * 60_000;

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show an event's standings")
  // Hidden from everyone but admins until you allow your staff role in
  // Server Settings → Integrations (see the spec, section 4).
  .setDefaultMemberPermissions(0)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName("week").setDescription("A week's first day, YYYY-MM-DD").setMinLength(10).setMaxLength(10)
  )
  .addStringOption((o) =>
    o.setName("user").setDescription("A participant's name, exactly as staff typed it").setMaxLength(32)
  );

function isStaff(member) {
  const roles = member?.roles;
  if (!roles) return false;
  // A cached GuildMember has a manager; raw API data has an array of IDs.
  return Array.isArray(roles) ? roles.includes(config.staffRoleId) : roles.cache.has(config.staffRoleId);
}

const safeMessage = (err) => {
  if (err instanceof ApiError) return err.message;
  console.error("[leaderboard]", err);
  return "Something went wrong.";
};

export async function execute(interaction) {
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: "Only staff can use /leaderboard.", flags: MessageFlags.Ephemeral });
    return;
  }

  const week = interaction.options.getString("week")?.trim() || null;
  const name = interaction.options.getString("user")?.trim() || null;
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    await interaction.reply({ content: "`week` must look like 2026-09-21.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Everything this reply needs, kept until the session ends.
  const state = { eventsPage: 1, events: null, event: null, boardPage: null };

  const showEvents = async () => {
    state.events = await fetchEvents(state.eventsPage);
    return eventsView(state.events);
  };
  const showBoard = async () => {
    // boardPage null: the dashboard opens on page 1, or on `name`'s page.
    const board = await fetchLeaderboard({ event: state.event, week, page: state.boardPage, name });
    state.boardPage = board.page;
    state.board = board;
    return boardView(board);
  };
  const render = async (load) => {
    try {
      return await load();
    } catch (err) {
      return errorView(safeMessage(err));
    }
  };

  const message = await interaction.editReply(await render(showEvents));

  const collector = message.createMessageComponentCollector({ time: SESSION_MS });

  collector.on("collect", async (i) => {
    try {
      // Ephemeral, so only the invoker can click; checked anyway.
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: "Run /leaderboard yourself to browse.", flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferUpdate();
      let view;
      switch (i.customId) {
        case "lb:events-prev":
          state.eventsPage = state.events?.prevPage ?? state.eventsPage;
          view = await render(showEvents);
          break;
        case "lb:events-next":
          state.eventsPage = state.events?.nextPage ?? state.eventsPage;
          view = await render(showEvents);
          break;
        case "lb:events":
          view = await render(showEvents);
          break;
        case "lb:pick":
          state.event = state.events?.events[Number(i.values[0])] ?? null;
          state.boardPage = null;
          view = state.event ? await render(showBoard) : await render(showEvents);
          break;
        case "lb:board-prev":
          state.boardPage = state.board?.prevPage ?? state.boardPage;
          view = await render(showBoard);
          break;
        case "lb:board-next":
          state.boardPage = state.board?.nextPage ?? state.boardPage;
          view = await render(showBoard);
          break;
        default:
          return;
      }
      await interaction.editReply(view);
    } catch (err) {
      console.error("[leaderboard] button:", err);
    }
  });

  collector.on("end", () => {
    interaction.editReply(expiredView).catch(() => {});
  });
}
```

### `src/index.js`
```js
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
```

### `scripts/deploy-commands.js`
```js
import { REST, Routes } from "discord.js";
import { config } from "../src/config.js";
import * as leaderboard from "../src/commands/leaderboard.js";

// Guild commands update instantly. Run again after changing a command.
const rest = new REST().setToken(config.token);
const body = [leaderboard.data.toJSON()];
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
console.log(`Registered ${body.length} command(s) in the server.`);
```

### `ecosystem.config.cjs`
```js
module.exports = {
  apps: [
    {
      name: "points-bot",
      script: "src/index.js",
      node_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      kill_timeout: 5000,
      max_memory_restart: "300M",
    },
  ],
};
```

## 4. Discord setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it.
2. **Bot** tab → **Reset Token** → copy it into `DISCORD_TOKEN`. Leave every *Privileged Gateway Intent* **off**.
3. **General Information** → copy **Application ID** into `DISCORD_CLIENT_ID`.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`, bot permissions **none**. Open the URL and add the bot to your **test server** first.
5. In Discord, turn on **Developer Mode** (User Settings → Advanced). Then right-click the server → **Copy Server ID** into `DISCORD_GUILD_ID`, and right-click the staff role → **Copy Role ID** into `STAFF_ROLE_ID`.
6. After `npm run deploy-commands`, go to **Server Settings → Integrations → your bot → `/leaderboard`**. Turn off **@everyone** and add your **staff role**.

## 5. Local test

On your own machine, against the real dashboard, in a **test server**:

```bash
cp .env.example .env    # fill it in
chmod 600 .env
npm ci
npm run deploy-commands
npm start               # "Online as <bot>#0000"
```

Check each of these in Discord:

- [ ] A non-staff member doesn't see `/leaderboard`. If they get to it anyway, they're told "Only staff…".
- [ ] `/leaderboard` → event list → Previous/Next work (with 11+ events) → picking an event shows standings.
- [ ] Standings Previous/Next work (with 11+ participants), and **Events** goes back to the list.
- [ ] `/leaderboard week:<a week's first day>` shows that week. A date that isn't a week start shows the dashboard's ⚠️ message.
- [ ] `/leaderboard user:<exact name>` opens on that person's page with the 🔎 line. The wrong case gives "⚠️ … has no points in …".
- [ ] After 10 minutes the buttons are removed.
- [ ] Ctrl+C prints "SIGINT: shutting down" and exits.

## 6. Deploy to Oracle Cloud Always Free

You run these steps yourself.

### 6.1 Account and VM
- **Home region: Singapore (`ap-singapore-1`).** You can't change it later.
- Create Instance → image **Ubuntu 24.04 (aarch64)**, shape **`VM.Standard.A1.Flex`**, **1 OCPU / 6 GB**, boot volume **50 GB**. Paste your SSH **public** key.
- Stay within Always Free: A1 is **2 OCPU / 12 GB in total** across all instances, and storage is 200 GB in total. If the trial ends while you're over the A1 limit, **all** A1 instances get disabled.
- Networking: the default security list allows only **SSH (22)** inbound. Keep it that way. The bot needs no inbound ports.
- **Idle reclamation:** Oracle can reclaim Always Free instances that stay mostly idle for 7 days, and a command-only bot is almost always idle. **Upgrade to Pay As You Go** (Always Free resources stay free), then go to **Billing → Budgets** and set a **$1 budget alert**.

### 6.2 Server setup
```bash
ssh ubuntu@<vm-ip>
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git unattended-upgrades
sudo npm i -g pm2
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
node --version   # v22.x
```

`build-essential` isn't needed, because the bot has no native modules.

### 6.3 Run
```bash
git clone <points-bot repo URL> && cd points-bot
cp .env.example .env && nano .env      # fill in values
chmod 600 .env
npm ci --omit=dev
npm run deploy-commands
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                # run the command it prints
pm2 install pm2-logrotate
pm2 logs points-bot --lines 20         # "Online as …"
```

Test a reboot: `sudo reboot`, wait a minute, then run `/leaderboard`.

### 6.4 Updates
```bash
cd ~/points-bot && git pull && npm ci --omit=dev && pm2 reload points-bot
# only if a command's options changed:
npm run deploy-commands
```

Optional later: a GitHub Action that SSHes in and runs the above on every push to `main`.

## 7. Replace Kite and rotate the key

Do this once section 5 passes and the bot is running on the VM.

1. Invite the new bot to your **real** server (section 4, step 4). Set `DISCORD_GUILD_ID` to that server, run `npm run deploy-commands`, and set the staff-role permission (section 4, step 6).
2. Remove `biscoff` (Kite) from the server and turn off its commands in Kite.
3. Rotate the key, because Kite still has a copy:
   ```bash
   openssl rand -hex 32
   ```
   - Vercel: update `BOT_API_KEY` → **redeploy**. The bot returns "API key was refused" until the next step is done.
   - VM: `nano ~/points-bot/.env` → new `BOT_API_KEY` → `pm2 reload points-bot`.
   - Dashboard `.env.local` for local dev.
4. Delete `BOT_API_KEY` from Kite's **Secrets**.
5. Once Kite is gone, these can go too: `KITE_BOT_MANUAL.md`, `a.mermaid`, and the `hidden` field in `/api/bot/events` (only BotGhost used it).

## 8. Bot API reference

Every call needs `Authorization: Bearer <BOT_API_KEY>`. Every response is JSON with `Cache-Control: no-store`. All the endpoints are read-only, and any method other than `GET` gets a 405.

| Endpoint | Returns |
|---|---|
| `GET /api/bot/health` | `{ "ok": true }` |
| `GET /api/bot/events?page=N` | Event names, 10 a page, newest first |
| `GET /api/bot/leaderboard?event=<name>[&week=YYYY-MM-DD][&page=N][&name=<username>]` | One event's standings, 10 a page |

**Paging fields** (both lists): `page, pageSize, totalRows, totalPages, showing, prevPage, nextPage, footer`. `prevPage` and `nextPage` are `null` at either end.

**`/api/bot/events`** adds `events` (string[]) and `hidden` (boolean[10], a leftover from BotGhost).

**`/api/bot/leaderboard`** adds:

| Field | Meaning |
|---|---|
| `event` | The event's name as stored |
| `week` | `null` for the whole event, otherwise the week's first day |
| `weekLabel`, `grid` | Only with `week`: `"Week 2 · Sep 21 - 25, 2026"` and a day-by-day grid |
| `leaderboard` | `[{ rank, name, points }]` for this page. Tied totals share a rank (1, 2, 2, 4). |
| `text` | This page as ready-made Discord markdown, or `No points yet.` |
| `match` | With `name=`: `{ rank, name, points }`, otherwise `null` |

**How `name=` works:** the name is cleaned the way the dashboard saves names, then matched **exactly, case included**. If `page=` is left out, the response opens on the page containing that person. A name nobody has gives `404 "<name> has no points in <event>"`. More than 32 characters gives a 400.

**Errors** come as `{ "error": "..." }`:

| Status | When |
|---|---|
| 400 | Missing `event`, bad `week`, bad `page`, `name` too long |
| 401 | Missing or wrong key, or the server has no key of 32+ characters |
| 404 | No such event, week, page or name |
| 429 | Over 60 requests a minute per IP. The `Retry-After` header gives the wait. |
| 500 | Server error. Details go to the Vercel logs only. |

**Checks once it's deployed:**
```bash
B=https://<my-app>.vercel.app
curl -si "$B/api/bot/health"                                              # 401
curl -si -H "Authorization: Bearer $BOT_API_KEY" "$B/api/bot/health"      # 200, no-store
curl -si -X POST -H "Authorization: Bearer $BOT_API_KEY" "$B/api/bot/health"  # 405
curl -s  -H "Authorization: Bearer $BOT_API_KEY" "$B/api/bot/events"
curl -s  -H "Authorization: Bearer $BOT_API_KEY" --get "$B/api/bot/leaderboard" \
     --data-urlencode "event=<event name>" --data-urlencode "name=<name as typed>"
```

## 9. Done when

- [ ] `/api/bot/*` is live on Vercel: 401 without the key, 200 with it, `no-store` on every response.
- [ ] The bot is online in the real server, and only staff can run `/leaderboard`.
- [ ] Events, standings, weeks, `user:` and paging all work.
- [ ] The bot is back online within about a minute after `sudo reboot`.
- [ ] Kite is removed and `BOT_API_KEY` is rotated.
- [ ] No secrets in either repo: `git log -p | grep -iE "token|api_key"` shows only empty `.env.example` lines.
- [ ] Oracle is on Pay As You Go with a $1 budget alert, and usage stays within Always Free.
