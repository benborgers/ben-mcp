# ben-mcp

Ben Borgers’ private MCP server, deployed at `mcp.ben.page` and restricted to `borgersbenjamin@gmail.com` through Google OAuth.

## Tools

### `request_pr_review`

Posts to Owner's `#plg-review-requests` as Ben using his Slack session credentials.

Inputs:

- `pr_url`: full `owner/Owner` GitHub PR URL
- `gist`: concise summary to place before the URL
- `reviewers`: natural reviewer names, resolved to real Slack mentions
- `review_level` (optional): `rubberstamp`, `medium`, or `deep`; prepends the corresponding `:please-review-<level>:` emoji to the Slack message

### `search_slack_as_ben`

Searches Slack with Ben's personal browser session, so results follow Ben's own conversation visibility rather than a bot's channel membership. `query` accepts Slack search syntax. Structured `keywords`, `author`, `conversation`, `after`, and `before` inputs can be combined with it. Results default to 25 per page (maximum 100) and include message, author, conversation, thread, timestamp, and permalink metadata.

Every result includes an opaque `message_ref`. It contains only versioned Slack conversation/message/thread identifiers and can be passed unchanged to `read_slack_thread_as_ben`; it does not contain credentials. Use `page`/`next_page` to continue large result sets.

### `read_slack_thread_as_ben`

Accepts a `message_ref` from search. A reply hit is resolved to its root, and the root plus replies are returned chronologically. A non-threaded message is returned as the root with an empty reply list. Responses include at most 100 messages by default (configurable up to 1,000); if `complete` is false, pass `next_cursor` back with the same `message_ref`. Continuation responses repeat the root for context.

## Environment

- `BASE_URL`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SLACK_XOXC`
- `SLACK_XOXD`

`SLACK_XOXC` and `SLACK_XOXD` are Ben's existing browser-session token and `d` cookie value. They must be injected at runtime and must never be committed, logged, returned by a tool, or persisted elsewhere. The Slack client uses them only in requests to Slack's Web API.

## Slack authentication caveat

The tools call the supported `search.messages`, `conversations.replies`, and (for a non-threaded fallback) `conversations.history` Web API methods. However, Slack browser-session (`xoxc` plus `xoxd`) authentication is not a stable public app-auth contract. Sessions can expire, be revoked, or stop working if Slack changes its browser authentication. Authentication and Slack API failures are returned without exposing credentials; rate-limit errors include Slack's retry delay when provided. Search and reads can only return content currently visible to Ben, and inaccessible or deleted conversations/messages remain unavailable.
