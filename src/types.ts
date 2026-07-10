export type PollOption = {
  id: string;
  text: string;
};

export type PollVote = {
  userId: number;
  displayName: string;
  username?: string;
  optionIds: string[];
  votedAt: string;
};

export type PollPublication = {
  chatId?: number;
  messageId?: number;
  inlineMessageId?: string;
};

export type Poll = {
  id: string;
  chatId: number;
  creatorId: number;
  question: string;
  options: PollOption[];
  isAnonymous: boolean;
  allowMultiple: boolean;
  posterFileId?: string;
  messageId?: number;
  publications?: PollPublication[];
  isClosed: boolean;
  createdAt: string;
  closedAt?: string;
  votes: PollVote[];
};

export type Database = {
  polls: Poll[];
};

export type DraftPoll = {
  chatId: number;
  creatorId: number;
  step: "question" | "options" | "poster" | "settings";
  question?: string;
  options?: string[];
  isAnonymous: boolean;
  allowMultiple: boolean;
  posterFileId?: string;
};
