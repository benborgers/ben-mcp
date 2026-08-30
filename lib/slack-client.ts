export type SlackResponse = {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [key: string]: unknown;
};

export interface SlackClient {
  call<T extends SlackResponse>(method: string, params?: Record<string, string>): Promise<T>;
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

function credentials() {
  const token = process.env.SLACK_XOXC;
  const cookie = process.env.SLACK_XOXD;
  if (!token || !cookie) {
    throw new SlackApiError(
      "Slack authentication is unavailable. Ben's Slack session credentials are missing or expired.",
      "missing_auth",
    );
  }
  return { token, cookie };
}

export class BenSlackClient implements SlackClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiUrl = "https://slack.com/api",
  ) {}

  async call<T extends SlackResponse>(method: string, params: Record<string, string> = {}): Promise<T> {
    const { token, cookie } = credentials();
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          Cookie: `d=${cookie}`,
        },
        body: new URLSearchParams({ token, ...params }),
      });
    } catch {
      throw new SlackApiError(`Slack ${method} could not be reached.`, "network_error");
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader);
    if (response.status === 429) {
      throw new SlackApiError(
        `Slack rate-limited ${method}${retryAfter !== undefined && Number.isFinite(retryAfter) ? `; retry after ${retryAfter} seconds` : ""}.`,
        "rate_limited",
        429,
        retryAfter !== undefined && Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    let json: T;
    try {
      json = await response.json() as T;
    } catch {
      throw new SlackApiError(`Slack ${method} returned an invalid response.`, "invalid_response", response.status);
    }

    if (!json || typeof json !== "object" || typeof json.ok !== "boolean") {
      throw new SlackApiError(`Slack ${method} returned an invalid response.`, "invalid_response", response.status);
    }

    if (!response.ok) {
      throw new SlackApiError(`Slack ${method} failed with HTTP ${response.status}.`, "http_error", response.status);
    }
    if (!json.ok) {
      const code = json.error || "unknown_error";
      const authMessage = ["invalid_auth", "not_authed", "token_expired", "account_inactive"].includes(code)
        ? " Ben's Slack session may need to be refreshed."
        : "";
      throw new SlackApiError(`Slack ${method} failed: ${code}.${authMessage}`, code, response.status);
    }
    return json;
  }
}
