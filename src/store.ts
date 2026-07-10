import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database, Poll, PollPublication, PollVote } from "./types.js";

const EMPTY_DB: Database = { polls: [] };

export class Store {
  private data: Database = EMPTY_DB;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = JSON.parse(raw) as Database;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
      this.data = { polls: [] };
      await this.persist();
    }
  }

  getPoll(id: string): Poll | undefined {
    return this.data.polls.find((poll) => poll.id === id);
  }

  async createPoll(poll: Poll): Promise<void> {
    this.data.polls.push(poll);
    await this.persist();
  }

  async updatePollMessage(id: string, messageId: number): Promise<void> {
    const poll = this.requirePoll(id);
    poll.messageId = messageId;
    poll.publications = upsertPublication(poll.publications, {
      chatId: poll.chatId,
      messageId
    });
    await this.persist();
  }

  async addPublication(id: string, publication: PollPublication): Promise<Poll> {
    const poll = this.requirePoll(id);
    poll.publications = upsertPublication(poll.publications, publication);
    await this.persist();
    return poll;
  }

  async closePoll(id: string): Promise<Poll> {
    const poll = this.requirePoll(id);
    poll.isClosed = true;
    poll.closedAt = new Date().toISOString();
    await this.persist();
    return poll;
  }

  async saveVote(pollId: string, vote: PollVote): Promise<Poll> {
    const poll = this.requirePoll(pollId);
    if (poll.isClosed) {
      return poll;
    }

    const existing = poll.votes.find((item) => item.userId === vote.userId);
    if (vote.optionIds.length === 0) {
      poll.votes = poll.votes.filter((item) => item.userId !== vote.userId);
      await this.persist();
      return poll;
    }

    if (existing) {
      existing.optionIds = vote.optionIds;
      existing.displayName = vote.displayName;
      existing.votedAt = vote.votedAt;
    } else {
      poll.votes.push(vote);
    }

    await this.persist();
    return poll;
  }

  private requirePoll(id: string): Poll {
    const poll = this.getPoll(id);
    if (!poll) {
      throw new Error(`Poll ${id} was not found`);
    }
    return poll;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}

function upsertPublication(
  publications: PollPublication[] | undefined,
  publication: PollPublication
): PollPublication[] {
  const current = publications ?? [];
  const exists = current.some((item) => {
    if (publication.inlineMessageId) {
      return item.inlineMessageId === publication.inlineMessageId;
    }

    return item.chatId === publication.chatId && item.messageId === publication.messageId;
  });

  return exists ? current : [...current, publication];
}
