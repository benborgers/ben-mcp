type SlackUser = {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string; real_name_normalized?: string; display_name_normalized?: string };
};

const api = "https://slack.com/api";
const reviewChannel = "C09FG5PS9NH";
const workspace = "owner-workspace-hq.slack.com";
const aliases: Record<string, string> = {
  matt: "Matt Tengtrakool",
  "matt t": "Matt Tengtrakool",
  david: "David Simionescu",
  "david s": "David Simionescu",
  ryan: "Ryan Selden",
  "ryan s": "Ryan Selden",
};

function credentials() {
  const token = process.env.SLACK_XOXC;
  const cookie = process.env.SLACK_XOXD;
  if (!token || !cookie) throw new Error("Slack credentials are missing");
  return { token, cookie };
}

async function call(method: string, params: Record<string, string> = {}) {
  const { token, cookie } = credentials();
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Cookie: `d=${cookie}`,
    },
    body: new URLSearchParams({ token, ...params }),
  });
  const json = await response.json() as { ok: boolean; error?: string; [key: string]: unknown };
  if (!json.ok) throw new Error(`${method} failed: ${json.error ?? "unknown error"}`);
  return json;
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function names(user: SlackUser) {
  return [user.profile?.real_name, user.profile?.real_name_normalized, user.profile?.display_name, user.profile?.display_name_normalized, user.name]
    .filter((value): value is string => Boolean(value))
    .map(normalize);
}

function score(query: string, user: SlackUser) {
  const q = normalize(query);
  const candidates = names(user);
  if (candidates.includes(q)) return 100;
  const qParts = q.split(" ");
  let best = 0;
  for (const candidate of candidates) {
    const parts = candidate.split(" ");
    if (qParts.every((part) => parts.some((candidatePart) => candidatePart.startsWith(part)))) best = Math.max(best, 80 + qParts.length);
    if (candidate.includes(q)) best = Math.max(best, 60);
  }
  return best;
}

async function users() {
  const result: SlackUser[] = [];
  let cursor = "";
  do {
    const response = await call("users.list", { limit: "200", ...(cursor ? { cursor } : {}) });
    result.push(...((response.members as SlackUser[]) ?? []));
    cursor = String((response.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
  } while (cursor);
  return result.filter((user) => !user.deleted && !user.is_bot && user.id !== "USLACKBOT");
}

export async function resolveReviewers(requested: string[]) {
  const allUsers = await users();
  return requested.map((original) => {
    const query = aliases[normalize(original)] ?? original;
    const ranked = allUsers.map((user) => ({ user, score: score(query, user) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (ranked.length === 0 || ranked[0].score < 60) throw new Error(`No Slack user matched “${original}”`);
    const top = ranked.filter((entry) => entry.score === ranked[0].score);
    if (top.length > 1) {
      const options = top.slice(0, 5).map(({ user }) => user.profile?.real_name || user.profile?.display_name || user.name).join(", ");
      throw new Error(`“${original}” is ambiguous. Matches: ${options}`);
    }
    const user = ranked[0].user;
    return { requested: original, id: user.id, name: user.profile?.real_name || user.profile?.display_name || user.name || original };
  });
}

export async function postReviewRequest(text: string) {
  const response = await call("chat.postMessage", { channel: reviewChannel, text });
  const ts = String(response.ts);
  return {
    channel: reviewChannel,
    ts,
    permalink: `https://${workspace}/archives/${reviewChannel}/p${ts.replace(".", "")}`,
  };
}
