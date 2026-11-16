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
