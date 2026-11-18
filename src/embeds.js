import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";

const COLOR = 0x3a9a3a;
const ERROR_COLOR = 0xd84a4a;
const PAGE_SIZE = 10;
const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

// Same escaping as the dashboard uses for names.
const escape = (text) => String(text).replace(/[\\*_~`|>]/g, "\\$&");

const button = (id, label, disabled = false, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

const pagingRow = (prefix, data, ...extra) =>
  new ActionRowBuilder().addComponents(
    button(`lb:${prefix}-prev`, "◀ Previous", data.prevPage === null),
    button(`lb:${prefix}-next`, "Next ▶", data.nextPage === null),
    ...extra
  );

const footer = (data, noun) => {
  const page = data.page ?? 1;
  const pages = Math.max(data.totalPages ?? 1, 1);
  return `Page ${page} of ${pages} · ${data.totalRows ?? 0} ${noun}`;
};

export function eventsView(data) {
  const events = (data.events ?? []).slice(0, PAGE_SIZE);
  const offset = ((data.page ?? 1) - 1) * PAGE_SIZE;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Leaderboards — pick an event")
    .setDescription(events.length ? events.map((name, i) => `**${offset + i + 1}.** ${escape(name)}`).join("\n") : "No events yet.")
    .setFooter({ text: footer(data, "events") });

  const components = [];
  if (events.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("lb:pick")
          .setPlaceholder("Choose an event")
          // Values are list positions, so long or duplicate names are fine.
          .addOptions(events.map((name, i) => ({ label: `${offset + i + 1}. ${name}`.slice(0, 100), value: String(i) })))
      )
    );
  }
  components.push(pagingRow("events", data));
  return { embeds: [embed], components };
}

export function boardView(data) {
  const rows = (data.leaderboard ?? []).slice(0, PAGE_SIZE);
  const lines = rows.map(({ rank, name, points }) => {
    const medal = MEDALS[rank] ? `${MEDALS[rank]} ` : "";
    return `${medal}**#${rank}** ${escape(name)} — ${points} pts`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(String(data.event ?? "Leaderboard").slice(0, 256))
    .setDescription(lines.length ? lines.join("\n") : "No points yet.")
    .setFooter({ text: footer(data, "participants") });

  return { embeds: [embed], components: [pagingRow("board", data, button("lb:events", "Events", false, ButtonStyle.Primary))] };
}

export function errorView(message) {
  const embed = new EmbedBuilder().setColor(ERROR_COLOR).setDescription(`⚠️ ${message}`);
  const row = new ActionRowBuilder().addComponents(button("lb:events", "Events", false, ButtonStyle.Primary));
  return { embeds: [embed], components: [row] };
}

export const expiredView = { components: [] };
