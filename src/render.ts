import { InlineKeyboardMarkup } from "telegraf/types";
import { Poll, PollVote } from "./types.js";

const BUTTON_TEXT_LIMIT = 56;
const ALERT_TEXT_LIMIT = 190;
const INLINE_QUESTION_LIMIT = 120;
const INLINE_OPTION_TEXT_LIMIT = 32;
const INLINE_VOTER_NAME_LIMIT = 14;
const INLINE_VOTERS_PER_OPTION = 2;
const TELEGRAM_MESSAGE_LIMIT = 3900;

export function renderPollText(poll: Poll): string {
  const title = `<b>${escapeHtml(truncatePlainText(poll.question, INLINE_QUESTION_LIMIT))}</b>`;
  const mode = poll.isAnonymous ? "анонимный опрос" : "открытый опрос";
  const choice = poll.allowMultiple ? "можно выбрать несколько вариантов" : "можно выбрать один вариант";
  const total = poll.votes.length;

  return [
    title,
    "",
    `<i>${escapeHtml(mode)}, ${escapeHtml(choice)}</i>`,
    `Всего проголосовало: <b>${total}</b>`,
    "",
    renderInlinePollResults(poll)
  ].join("\n");
}

export function renderResultsText(poll: Poll): string {
  return `<b>Результаты: ${escapeHtml(poll.question)}</b>\n\n${renderCompactResults(poll)}`;
}

export function renderResultsMessages(poll: Poll): string[] {
  const title = `<b>Результаты: ${escapeHtml(poll.question)}</b>`;
  const sections = renderCompactResultSections(poll);
  const messages: string[] = [];
  let current = title;

  for (const section of sections) {
    const next = `${current}\n\n${section}`;
    if (next.length <= TELEGRAM_MESSAGE_LIMIT) {
      current = next;
      continue;
    }

    messages.push(current);
    current = section.length <= TELEGRAM_MESSAGE_LIMIT ? section : truncateMessage(section);
  }

  messages.push(current);
  return messages;
}

export function renderResultsAlert(poll: Poll): string {
  return truncateAlert(renderResultsAlertFull(poll));
}

export function isResultsAlertTruncated(poll: Poll): boolean {
  return renderResultsAlertFull(poll).length > ALERT_TEXT_LIMIT;
}

export function renderResultsSummaryAlert(poll: Poll): string {
  return truncateAlert(renderResultsSummaryAlertFull(poll));
}

export function renderResultsNoticeAlert(poll: Poll, notice: string): string {
  return truncateAlert(`${renderResultsSummaryAlertFull(poll)}\n\n${notice}`);
}

function renderResultsSummaryAlertFull(poll: Poll): string {
  const totalVoters = poll.votes.length;
  const lines = poll.options.map((option, index) => {
    const voters = poll.votes.filter((vote) => vote.optionIds.includes(option.id));
    const percent = totalVoters === 0 ? 0 : Math.round((voters.length / totalVoters) * 100);
    return `${index + 1}. ${option.text}: ${voters.length}/${totalVoters} (${percent}%)`;
  });

  return [poll.question, "", ...lines].join("\n");
}

export function buildPollKeyboard(poll: Poll): InlineKeyboardMarkup {
  const optionRows = poll.options.map((option, index) => [
    {
      text: `${index + 1}. ${truncateButtonText(option.text)}`,
      callback_data: `vote:${poll.id}:${option.id}`
    }
  ]);

  return {
    inline_keyboard: [
      ...optionRows,
      [
        { text: "Показать результаты", callback_data: `results:${poll.id}` },
        { text: "Поделиться", switch_inline_query: poll.id }
      ]
    ]
  };
}

export function renderStats(poll: Poll, includeVoters: boolean): string {
  const totalVoters = poll.votes.length;

  return poll.options
    .map((option, index) => {
      const voters = poll.votes.filter((vote) => vote.optionIds.includes(option.id));
      const percent = totalVoters === 0 ? 0 : Math.round((voters.length / totalVoters) * 100);
      const header = `${index + 1}. ${escapeHtml(option.text)} - ${voters.length}/${totalVoters} (${percent}%)`;

      if (!includeVoters || poll.isAnonymous) {
        return header;
      }

      const names = voters.length > 0
        ? voters.map((vote) => `- ${escapeHtml(vote.displayName)}`).join("\n")
        : "- пока нет голосов";

      return `${header}\n${names}`;
    })
    .join("\n\n");
}

function renderInlinePollResults(poll: Poll): string {
  const totalVoters = poll.votes.length;

  return poll.options
    .map((option, index) => {
      const voters = poll.votes.filter((vote) => vote.optionIds.includes(option.id));
      const percent = totalVoters === 0 ? 0 : Math.round((voters.length / totalVoters) * 100);
      const optionText = escapeHtml(truncatePlainText(option.text, INLINE_OPTION_TEXT_LIMIT));
      const header = `<b>${index + 1}. ${optionText}</b> - ${voters.length}/${totalVoters} (${percent}%)`;

      if (poll.isAnonymous) {
        return header;
      }

      if (voters.length === 0) {
        return `${header}\n<i>пока нет голосов</i>`;
      }

      return `${header}\n${renderInlineVoters(voters)}`;
    })
    .join("\n\n");
}

function renderCompactResults(poll: Poll): string {
  return renderCompactResultSections(poll).join("\n\n");
}

function renderCompactResultSections(poll: Poll): string[] {
  const totalVoters = poll.votes.length;

  return poll.options
    .map((option, index) => {
      const voters = poll.votes.filter((vote) => vote.optionIds.includes(option.id));
      const percent = totalVoters === 0 ? 0 : Math.round((voters.length / totalVoters) * 100);
      const header = `<b>${index + 1}. ${escapeHtml(option.text)}</b> - ${voters.length}/${totalVoters} (${percent}%)`;

      if (poll.isAnonymous) {
        return header;
      }

      const names = voters.length > 0
        ? voters.map(renderLinkedVoter).join(", ")
        : "<i>пока нет голосов</i>";

      return `${header}\n${names}`;
    });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function truncateAlert(value: string): string {
  return value.length <= ALERT_TEXT_LIMIT ? value : `${value.slice(0, ALERT_TEXT_LIMIT - 3)}...`;
}

function truncateButtonText(value: string): string {
  return value.length <= BUTTON_TEXT_LIMIT ? value : `${value.slice(0, BUTTON_TEXT_LIMIT - 3)}...`;
}

function renderLinkedVoter(vote: PollVote): string {
  const label = vote.username ? `@${vote.username}` : compactName(vote.displayName);
  return `<a href="tg://user?id=${vote.userId}">${escapeHtml(label)}</a>`;
}

function renderInlineVoters(voters: PollVote[]): string {
  const visible = voters.slice(0, INLINE_VOTERS_PER_OPTION).map((vote) => {
    const label = vote.username ? `@${vote.username}` : compactName(vote.displayName, INLINE_VOTER_NAME_LIMIT);
    return escapeHtml(label);
  });
  const hidden = voters.length - visible.length;

  return hidden > 0 ? `${visible.join(", ")} +${hidden}` : visible.join(", ");
}

function compactName(value: string, limit = 24): string {
  const withoutUsername = value.replace(/\s+\(@[^)]+\)$/, "").trim();
  const name = withoutUsername || value;
  return truncatePlainText(name, limit);
}

function truncatePlainText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function truncateMessage(value: string): string {
  return value.length <= TELEGRAM_MESSAGE_LIMIT
    ? value
    : `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - 3)}...`;
}

function renderResultsAlertFull(poll: Poll): string {
  const totalVoters = poll.votes.length;
  const lines = poll.options.map((option, index) => {
    const voters = poll.votes.filter((vote) => vote.optionIds.includes(option.id));
    const percent = totalVoters === 0 ? 0 : Math.round((voters.length / totalVoters) * 100);
    const stats = `${index + 1}. ${option.text}: ${voters.length}/${totalVoters} (${percent}%)`;

    if (poll.isAnonymous) {
      return stats;
    }

    const names = voters.length > 0
      ? voters.map((vote) => vote.displayName).join(", ")
      : "нет голосов";

    return `${stats}\n${names}`;
  });

  return [poll.question, "", ...lines].join("\n");
}
