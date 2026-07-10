import "dotenv/config";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createBot } from "./bot.js";
import { Store } from "./store.js";

const token = process.env.BOT_TOKEN;
const STARTUP_RETRIES = 10;

if (!token) {
  throw new Error("BOT_TOKEN is required. Copy .env.example to .env and set your Telegram bot token.");
}

const dataFile = process.env.DATA_FILE ?? path.resolve(process.cwd(), "data/db.json");
const store = new Store(dataFile);
await store.load();

const bot = createBot(token, store);

bot.catch((error) => {
  console.error("Bot error:", formatError(error));
});

await launchWithRetry();
console.log("Vote bot is running");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

async function launchWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= STARTUP_RETRIES; attempt += 1) {
    try {
      await bot.launch();
      return;
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt === STARTUP_RETRIES) {
        throw new Error(`Telegram bot launch failed: ${formatError(error)}`);
      }

      const delayMs = Math.min(30_000, 1_500 * attempt);
      console.warn(
        `Telegram API is not reachable (${formatError(error)}). Retry ${attempt}/${STARTUP_RETRIES} in ${Math.round(delayMs / 1000)}s.`
      );
      await sleep(delayMs);
    }
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error);

  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].some((value) => {
    return code === value || message.includes(value);
  });
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>");
}
