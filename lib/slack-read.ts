import { BenSlackClient, SlackApiError, type SlackClient, type SlackResponse } from "@/lib/slack-client";

const workspace = "owner-workspace-hq.slack.com";

type SlackMessage = {
  type?: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  user_id?: string;
  username?: string;
  user_name?: string;
  bot_id?: string;
  permalink?: string;
  channel_id?: string;
  channel_name?: string;
  channel?: { id?: string; name?: string };
  user_profile?: { real_name?: string; display_name?: string };
  reply_count?: number;
};

type SearchResponse = SlackResponse & {
  messages?: {
    matches?: SlackMessage[];
    total?: number;
    paging?: { count?: number; total?: number; page?: number; pages?: number };
    pagination?: { total_count?: number; page?: number; page_count?: number; per_page?: number };
  };
};

type RepliesResponse = SlackResponse & { messages?: SlackMessage[] };
type HistoryResponse = SlackResponse & { messages?: SlackMessage[] };

type MessageReference = {
  v: 1;
  c: string;
  m: string;
  r?: string;
  n?: string;
};

export type SlackMessageResult = {
  message_ref: string;
  timestamp: string;
  text: string;
  author: { id?: string; name?: string };
  conversation: { id: string; name?: string };
  permalink: string;
  thread_root_timestamp: string;
  is_reply: boolean;
  reply_count?: number;
};

export type SlackSearchInput = {
  query?: string;
  keywords?: string[];
  author?: string;
  conversation?: string;
  after?: string;
  before?: string;
  sort?: "score" | "timestamp";
  sort_direction?: "asc" | "desc";
  limit?: number;
  page?: number;
};

function modifier(name: string, rawValue: string) {
  const value = rawValue.trim().replace(/^[@#]/, "");
  if (!value) throw new Error(`${name} cannot be empty.`);
  if (/[\r\n]/.test(value)) throw new Error(`${name} cannot contain line breaks.`);
  return `${name}:${/\s/.test(value) ? JSON.stringify(value) : value}`;
}

function date(value: string, field: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

export function buildSlackSearchQuery(input: SlackSearchInput) {
  const parts = [input.query?.trim(), ...(input.keywords ?? []).map((keyword) => keyword.trim())].filter(Boolean) as string[];
  if (input.author) parts.push(modifier("from", input.author));
  if (input.conversation) parts.push(modifier("in", input.conversation));
  if (input.after) parts.push(`after:${date(input.after, "after")}`);
  if (input.before) parts.push(`before:${date(input.before, "before")}`);
  if (input.after && input.before && input.after > input.before) throw new Error("after must not be later than before.");
  if (parts.length === 0) throw new Error("Provide query, keywords, author, conversation, after, or before.");
  return parts.join(" ");
}

function rootFromPermalink(permalink?: string) {
  if (!permalink) return undefined;
  try {
    return new URL(permalink).searchParams.get("thread_ts") ?? undefined;
  } catch {
    return undefined;
  }
}

export function encodeMessageRef(reference: MessageReference) {
  return Buffer.from(JSON.stringify(reference)).toString("base64url");
}

export function decodeMessageRef(encoded: string): MessageReference {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("message_ref is malformed. Pass the value returned by search_slack_as_ben unchanged.");
  }
  const ref = value as Partial<MessageReference>;
  const channelPattern = /^[A-Z][A-Z0-9]+$/;
  const timestampPattern = /^\d+\.\d+$/;
  if (
    ref.v !== 1 || typeof ref.c !== "string" || !channelPattern.test(ref.c) ||
    typeof ref.m !== "string" || !timestampPattern.test(ref.m) ||
    (ref.r !== undefined && (typeof ref.r !== "string" || !timestampPattern.test(ref.r))) ||
    (ref.n !== undefined && typeof ref.n !== "string")
  ) {
    throw new Error("message_ref is invalid. Pass the value returned by search_slack_as_ben unchanged.");
  }
  return ref as MessageReference;
}

function permalink(channel: string, timestamp: string, rootTimestamp: string) {
  const base = `https://${workspace}/archives/${channel}/p${timestamp.replace(".", "")}`;
  return timestamp === rootTimestamp ? base : `${base}?thread_ts=${encodeURIComponent(rootTimestamp)}&cid=${channel}`;
}

function formatMessage(message: SlackMessage, channelId: string, channelName?: string, knownRoot?: string): SlackMessageResult {
  if (!/^\d+\.\d+$/.test(message.ts)) {
    throw new SlackApiError("Slack returned a message without a valid timestamp.", "invalid_response");
  }
  const rootTimestamp = message.thread_ts || knownRoot || message.ts;
  const isReply = rootTimestamp !== message.ts;
  const name = message.user_profile?.display_name || message.user_profile?.real_name || message.username || message.user_name;
  return {
    message_ref: encodeMessageRef({ v: 1, c: channelId, m: message.ts, ...(isReply ? { r: rootTimestamp } : {}), ...(channelName ? { n: channelName } : {}) }),
    timestamp: message.ts,
    text: message.text ?? "",
    author: { ...(message.user || message.user_id ? { id: message.user || message.user_id } : message.bot_id ? { id: message.bot_id } : {}), ...(name ? { name } : {}) },
    conversation: { id: channelId, ...(channelName ? { name: channelName } : {}) },
    permalink: message.permalink || permalink(channelId, message.ts, rootTimestamp),
    thread_root_timestamp: rootTimestamp,
    is_reply: isReply,
    ...(typeof message.reply_count === "number" ? { reply_count: message.reply_count } : {}),
  };
}

export async function searchSlackAsBen(input: SlackSearchInput, client: SlackClient = new BenSlackClient()) {
  const limit = input.limit ?? 25;
  const page = input.page ?? 1;
  const response = await client.call<SearchResponse>("search.messages", {
    query: buildSlackSearchQuery(input),
    count: String(limit),
    page: String(page),
    sort: input.sort ?? "score",
    sort_dir: input.sort_direction ?? "desc",
    highlight: "0",
  });
  const container = response.messages;
  const matches = container?.matches ?? [];
  const results = matches.map((message) => {
    const channelId = message.channel?.id || message.channel_id;
    if (!channelId) throw new SlackApiError("Slack search returned a message without a conversation identifier.", "invalid_response");
    const threadRoot = message.thread_ts || rootFromPermalink(message.permalink);
    return formatMessage({ ...message, ...(threadRoot ? { thread_ts: threadRoot } : {}) }, channelId, message.channel?.name || message.channel_name);
  });
  const paging = container?.paging;
  const pagination = container?.pagination;
  const total = paging?.total ?? pagination?.total_count ?? container?.total ?? results.length;
  const pages = paging?.pages ?? pagination?.page_count ?? Math.max(1, Math.ceil(total / limit));
  const currentPage = paging?.page ?? pagination?.page ?? page;
  return {
    query: buildSlackSearchQuery(input),
    results,
    pagination: {
      page: currentPage,
      page_size: limit,
      total,
      total_pages: pages,
      has_more: currentPage < pages,
      ...(currentPage < pages ? { next_page: currentPage + 1 } : {}),
    },
  };
}

async function standaloneMessage(ref: MessageReference, client: SlackClient) {
  const response = await client.call<HistoryResponse>("conversations.history", {
    channel: ref.c,
    oldest: ref.m,
    latest: ref.m,
    inclusive: "true",
    limit: "1",
  });
  const message = response.messages?.find((candidate) => candidate.ts === ref.m);
  if (!message) throw new SlackApiError("The Slack message was not found or is no longer accessible.", "message_not_found");
  return message;
}

export async function readSlackThreadAsBen(
  input: { message_ref: string; max_messages?: number; cursor?: string },
  client: SlackClient = new BenSlackClient(),
) {
  const ref = decodeMessageRef(input.message_ref);
  const rootTimestamp = ref.r || ref.m;
  const maxMessages = input.max_messages ?? 100;
  const collected: SlackMessage[] = [];
  let root: SlackMessage | undefined;
  let cursor = input.cursor ?? "";

  if (cursor) {
    const rootResponse = await client.call<RepliesResponse>("conversations.replies", {
      channel: ref.c,
      ts: rootTimestamp,
      limit: "1",
    });
    root = rootResponse.messages?.find((message) => message.ts === rootTimestamp);
    if (!root) throw new SlackApiError("The Slack thread root was not found or is no longer accessible.", "message_not_found");
    collected.push(root);
  }

  do {
    const remaining = maxMessages - collected.length;
    if (remaining <= 0) break;
    let response: RepliesResponse;
    try {
      response = await client.call<RepliesResponse>("conversations.replies", {
        channel: ref.c,
        ts: rootTimestamp,
        limit: String(Math.min(100, remaining)),
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      if (!ref.r && !cursor && error instanceof SlackApiError && error.code === "thread_not_found") {
        const message = await standaloneMessage(ref, client);
        return {
          root: formatMessage(message, ref.c, ref.n),
          replies: [],
          pagination: { complete: true, returned_messages: 1 },
        };
      }
      throw error;
    }

    const messages = response.messages ?? [];
    root ??= messages.find((message) => message.ts === rootTimestamp);
    for (const message of messages) {
      if (!collected.some((existing) => existing.ts === message.ts)) collected.push(message);
    }
    cursor = response.response_metadata?.next_cursor ?? "";
  } while (cursor && collected.length < maxMessages);

  if (!root) throw new SlackApiError("The Slack thread root was not found or is no longer accessible.", "message_not_found");
  const replies = collected
    .filter((message) => message.ts !== rootTimestamp)
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .map((message) => formatMessage(message, ref.c, ref.n, rootTimestamp));
  return {
    root: formatMessage(root, ref.c, ref.n),
    replies,
    pagination: {
      complete: !cursor,
      returned_messages: 1 + replies.length,
      ...(cursor ? { next_cursor: cursor } : {}),
    },
  };
}
