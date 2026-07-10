import { randomBytes } from "node:crypto";
import { Context, Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { Store } from "./store.js";
import { DraftPoll, Poll } from "./types.js";
import {
  buildPollKeyboard,
  isResultsAlertTruncated,
  renderPollText,
  renderResultsAlert,
  renderResultsMessages,
  renderResultsNoticeAlert,
  renderResultsSummaryAlert,
} from "./render.js";

const drafts = new Map<number, DraftPoll>();

export function createBot(token: string, store: Store): Telegraf<Context> {
  const bot = new Telegraf(token);

  bot.start((ctx) => sendHelp(ctx));
  bot.help((ctx) => sendHelp(ctx));

  bot.on("inline_query", async (ctx) => {
    const pollId = ctx.inlineQuery.query.trim();
    const poll = store.getPoll(pollId);

    if (!poll) {
      await ctx.answerInlineQuery([], {
        cache_time: 0,
        is_personal: true
      });
      return;
    }

    await ctx.answerInlineQuery([inlinePollResult(poll)], {
      cache_time: 0,
      is_personal: true
    });
  });

  bot.command("cancel", async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.reply("Создание опроса отменено.");
  });

  bot.command("newpoll", async (ctx) => {
    drafts.set(ctx.from.id, {
      chatId: ctx.chat.id,
      creatorId: ctx.from.id,
      step: "question",
      isAnonymous: false,
      allowMultiple: false
    });

    await ctx.reply("Введите вопрос опроса.", forceReply());
  });

  bot.command("sharepoll", async (ctx) => {
    const pollId = ctx.message.text.split(/\s+/)[1];
    if (!pollId) {
      await ctx.reply("Укажите код опроса: /sharepoll <код>");
      return;
    }

    const poll = store.getPoll(pollId);
    if (!poll) {
      await ctx.reply("Опрос с таким кодом не найден.");
      return;
    }

    const messageId = await sendPollMessage(ctx, poll, ctx.chat.id);
    await store.addPublication(poll.id, { chatId: ctx.chat.id, messageId });
    await ctx.reply("Опрос опубликован в этом чате.");
  });

  bot.action(/^toggle:(anonymous|multiple)$/, async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft) {
      await ctx.answerCbQuery("Черновик не найден. Начните с /newpoll.");
      return;
    }

    const [, key] = ctx.match;
    if (key === "anonymous") {
      draft.isAnonymous = !draft.isAnonymous;
    } else {
      draft.allowMultiple = !draft.allowMultiple;
    }

    await ctx.answerCbQuery("Настройка обновлена.");
    await ctx.editMessageText(renderDraftSettings(draft), settingsKeyboard(draft));
  });

  bot.action("poster:add", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft) {
      await ctx.answerCbQuery("Черновик не найден. Начните с /newpoll.");
      return;
    }

    draft.step = "poster";
    await ctx.answerCbQuery();
    await ctx.reply(
      "Отправьте картинку для постера одним фото. Если передумали, нажмите /cancel или опубликуйте без постера в настройках.",
      forceReply()
    );
  });

  bot.action("poster:remove", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft) {
      await ctx.answerCbQuery("Черновик не найден. Начните с /newpoll.");
      return;
    }

    delete draft.posterFileId;
    draft.step = "settings";
    await ctx.answerCbQuery("Постер удалён.");
    await ctx.editMessageText(renderDraftSettings(draft), settingsKeyboard(draft));
  });

  bot.action("publish", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft || !draft.question || !draft.options) {
      await ctx.answerCbQuery("Черновик не готов. Начните с /newpoll.");
      return;
    }

    const poll: Poll = {
      id: makeId(),
      chatId: draft.chatId,
      creatorId: draft.creatorId,
      question: draft.question,
      options: draft.options.map((text, index) => ({ id: String(index + 1), text })),
      isAnonymous: draft.isAnonymous,
      allowMultiple: draft.allowMultiple,
      posterFileId: draft.posterFileId,
      isClosed: false,
      createdAt: new Date().toISOString(),
      votes: []
    };

    await store.createPoll(poll);

    const messageId = await sendPollMessage(ctx, poll, poll.chatId);
    await store.updatePollMessage(poll.id, messageId);
    drafts.delete(ctx.from.id);
    await ctx.answerCbQuery("Опрос опубликован.");
  });

  bot.action(/^vote:([^:]+):([^:]+)$/, async (ctx) => {
    const [, pollId, optionId] = ctx.match;
    const poll = store.getPoll(pollId);
    if (!poll) {
      await ctx.answerCbQuery("Опрос не найден.");
      return;
    }
    if (poll.isClosed) {
      await ctx.answerCbQuery("Опрос закрыт.");
      return;
    }

    const currentVote = poll.votes.find((vote) => vote.userId === ctx.from.id);
    if (!poll.allowMultiple && currentVote?.optionIds.includes(optionId)) {
      await ctx.answerCbQuery("Этот вариант уже выбран.");
      return;
    }

    const optionIds = poll.allowMultiple
      ? toggleOption(currentVote?.optionIds ?? [], optionId)
      : [optionId];

    await store.saveVote(poll.id, {
      userId: ctx.from.id,
      displayName: poll.isAnonymous ? "anonymous" : displayName(ctx.from),
      username: poll.isAnonymous ? undefined : ctx.from.username,
      optionIds,
      votedAt: new Date().toISOString()
    });

    const inlineMessageId = "inline_message_id" in ctx.callbackQuery
      ? ctx.callbackQuery.inline_message_id
      : undefined;
    if (inlineMessageId) {
      await store.addPublication(poll.id, { inlineMessageId });
    }

    await ctx.answerCbQuery(optionIds.length === 0 ? "Выбор снят." : poll.allowMultiple ? "Выбор обновлён." : "Голос принят.");

    const updated = store.getPoll(poll.id);
    if (updated) {
      await updatePollMessages(ctx, updated);
    }
  });

  bot.action(/^results:([^:]+)$/, async (ctx) => {
    const [, pollId] = ctx.match;
    const poll = store.getPoll(pollId);
    if (!poll) {
      await ctx.answerCbQuery("Опрос не найден.");
      return;
    }

    if (!isResultsAlertTruncated(poll)) {
      await ctx.answerCbQuery(renderResultsAlert(poll), { show_alert: true });
      return;
    }

    if (ctx.chat) {
      await ctx.answerCbQuery(renderResultsNoticeAlert(poll, "Полный список отправлен сообщением."), {
        show_alert: true
      });
      for (const messageText of renderResultsMessages(poll)) {
        await ctx.reply(messageText, { parse_mode: "HTML" });
      }
      return;
    }

    await ctx.answerCbQuery(renderResultsNoticeAlert(poll, "Полный список не помещается во всплывающее окно Telegram."), {
      show_alert: true
    });
  });

  bot.action(/^sharecode:([^:]+)$/, async (ctx) => {
    const [, pollId] = ctx.match;
    const instruction = `Чтобы опубликовать этот опрос в другом чате, добавьте туда бота и отправьте:\n/sharepoll ${pollId}`;

    if (ctx.chat) {
      await ctx.answerCbQuery("Отправьте /sharepoll " + pollId + " в нужном чате.");
      await ctx.reply(instruction);
      return;
    }

    await ctx.answerCbQuery(instruction, { show_alert: true });
  });

  bot.action(/^close:([^:]+)$/, async (ctx) => {
    await ctx.answerCbQuery("Закрытие опросов отключено.");
  });

  bot.on(message("text"), async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft) {
      return;
    }

    if (draft.step === "question") {
      draft.question = ctx.message.text.trim();
      draft.step = "options";
      await ctx.reply("Введите варианты ответов, каждый с новой строки. Минимум 2 варианта.", forceReply());
      return;
    }

    if (draft.step === "options") {
      const options = ctx.message.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (options.length < 2) {
        await ctx.reply("Нужно минимум 2 варианта. Отправьте список ещё раз, каждый вариант с новой строки.", forceReply());
        return;
      }

      draft.options = options.slice(0, 10);
      draft.step = "settings";
      await ctx.reply(renderDraftSettings(draft), settingsKeyboard(draft));
    }
  });

  bot.on(message("photo"), async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft || draft.step !== "poster") {
      return;
    }

    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await ctx.reply("Не удалось прочитать фото. Попробуйте отправить картинку ещё раз.");
      return;
    }

    draft.posterFileId = photo.file_id;
    draft.step = "settings";
    await ctx.reply(renderDraftSettings(draft), settingsKeyboard(draft));
  });

  return bot;
}

async function sendHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Я помогаю создать опрос с кнопками голосования.",
      "",
      "/newpoll - создать опрос",
      "/cancel - отменить создание",
      "",
      "В опросе можно настроить анонимность, мультивыбор и картинку-постер.",
      "Чтобы отправить опрос в канал или другой чат, нажмите Поделиться под опросом."
    ].join("\n")
  );
}

function renderDraftSettings(draft: DraftPoll): string {
  return [
    "Проверьте опрос перед публикацией",
    "",
    `Вопрос: ${draft.question}`,
    `Вариантов: ${draft.options?.length ?? 0}`,
    `Тип: ${draft.isAnonymous ? "анонимный" : "открытый"}`,
    `Выбор: ${draft.allowMultiple ? "несколько вариантов" : "один вариант"}`,
    `Постер: ${draft.posterFileId ? "добавлен" : "не добавлен"}`
  ].join("\n");
}

function settingsKeyboard(draft: DraftPoll) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        draft.isAnonymous ? "Тип: анонимный" : "Тип: открытый",
        "toggle:anonymous"
      )
    ],
    [
      Markup.button.callback(
        draft.allowMultiple ? "Выбор: несколько" : "Выбор: один",
        "toggle:multiple"
      )
    ],
    [
      draft.posterFileId
        ? Markup.button.callback("Убрать постер", "poster:remove")
        : Markup.button.callback("Добавить постер", "poster:add")
    ],
    [Markup.button.callback("Опубликовать опрос", "publish")]
  ]);
}

function forceReply() {
  return { reply_markup: { force_reply: true as const, selective: true } };
}

function toggleOption(current: string[], optionId: string): string[] {
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  return [...current, optionId];
}

function makeId(): string {
  return randomBytes(6).toString("base64url");
}

function displayName(user: NonNullable<Context["from"]>): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return user.username ? `${name || user.username} (@${user.username})` : name || String(user.id);
}

function inlinePollResult(poll: Poll) {
  if (poll.posterFileId) {
    return {
      type: "photo" as const,
      id: `poll:${poll.id}`,
      photo_file_id: poll.posterFileId,
      title: poll.question,
      caption: renderPollText(poll),
      parse_mode: "HTML" as const,
      reply_markup: buildPollKeyboard(poll)
    };
  }

  return {
    type: "article" as const,
    id: `poll:${poll.id}`,
    title: poll.question,
    description: "Опрос",
    input_message_content: {
      message_text: renderPollText(poll),
      parse_mode: "HTML" as const
    },
    reply_markup: buildPollKeyboard(poll)
  };
}

async function sendPollMessage(ctx: Context, poll: Poll, chatId: number): Promise<number> {
  const extra = {
    parse_mode: "HTML" as const,
    reply_markup: buildPollKeyboard(poll)
  };

  const sent = poll.posterFileId
    ? await ctx.telegram.sendPhoto(chatId, poll.posterFileId, {
        caption: renderPollText(poll),
        ...extra
      })
    : await ctx.telegram.sendMessage(chatId, renderPollText(poll), extra);

  return sent.message_id;
}

async function updatePollMessages(ctx: Context, poll: Poll): Promise<void> {
  const publications = pollPublications(poll);

  for (const publication of publications) {
    await updatePollMessage(ctx, poll, publication);
  }
}

async function updatePollMessage(
  ctx: Context,
  poll: Poll,
  publication: NonNullable<Poll["publications"]>[number]
): Promise<void> {
  const extra = {
    parse_mode: "HTML" as const,
    reply_markup: buildPollKeyboard(poll)
  };

  try {
    if (publication.inlineMessageId) {
      if (poll.posterFileId) {
        await ctx.telegram.editMessageCaption(undefined, undefined, publication.inlineMessageId, renderPollText(poll), extra);
      } else {
        await ctx.telegram.editMessageText(undefined, undefined, publication.inlineMessageId, renderPollText(poll), extra);
      }
    } else if (publication.chatId && publication.messageId) {
      if (poll.posterFileId) {
        await ctx.telegram.editMessageCaption(publication.chatId, publication.messageId, undefined, renderPollText(poll), extra);
      } else {
        await ctx.telegram.editMessageText(publication.chatId, publication.messageId, undefined, renderPollText(poll), extra);
      }
    } else {
      return;
    }
  } catch (error) {
    const description = (error as { description?: string }).description ?? "";
    if (description.includes("message is not modified")) {
      return;
    }

    console.warn(`Failed to update poll ${poll.id} publication: ${description}`);
  }
}

function pollPublications(poll: Poll) {
  const publications = poll.publications ?? [];
  if (!poll.messageId) {
    return publications;
  }

  const hasOriginal = publications.some(
    (publication) => publication.chatId === poll.chatId && publication.messageId === poll.messageId
  );

  return hasOriginal
    ? publications
    : [{ chatId: poll.chatId, messageId: poll.messageId }, ...publications];
}
