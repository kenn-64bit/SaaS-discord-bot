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
