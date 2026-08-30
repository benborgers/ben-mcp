import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { allowedEmail, scopes } from "@/lib/config";
import { normalizeGist, normalizePrUrl } from "@/lib/review";
import { readSlackThreadAsBen, searchSlackAsBen } from "@/lib/slack-read";
import { postReviewRequest, resolveReviewers } from "@/lib/slack";
import { verifyToken } from "@/lib/tokens";

const slackAuthorSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
}).strict();

const slackMessageSchema = z.object({
  message_ref: z.string(),
  timestamp: z.string(),
  text: z.string(),
  author: slackAuthorSchema,
  conversation: z.object({ id: z.string(), name: z.string().optional() }).strict(),
  permalink: z.string().url(),
  thread_root_timestamp: z.string(),
  is_reply: z.boolean(),
  reply_count: z.number().int().nonnegative().optional(),
}).strict();

const handler = createMcpHandler((server) => {
  server.registerTool(
    "request_pr_review",
    {
      title: "Request PR review",
      description: "Post a review request for one owner/Owner GitHub pull request in Owner's #plg-review-requests Slack channel as Ben. Use the PR's concise gist and the natural names of the people Ben wants to review it. This sends a real Slack message.",
      inputSchema: z.object({
        pr_url: z.string().url().describe("The full GitHub URL for one owner/Owner pull request."),
        gist: z.string().min(3).max(140).describe("A concise plain-English gist of what the PR changes. Do not include the PR URL, reviewer names, or a trailing colon."),
        reviewers: z.array(z.string().min(1).max(100)).min(1).max(10).describe("Reviewer names as a human would say them, such as ['Matt', 'David S']. The server resolves these to real Slack users and refuses ambiguous matches."),
      }).strict(),
      outputSchema: z.object({
        message: z.string(),
        permalink: z.string().url(),
        reviewers: z.array(z.object({ id: z.string(), name: z.string() })),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ pr_url, gist, reviewers }) => {
      const url = normalizePrUrl(pr_url);
      const resolved = await resolveReviewers(reviewers);
      const message = `${normalizeGist(gist)}: ${url}\n${resolved.map(({ id }) => `<@${id}>`).join(" ")}`;
      const posted = await postReviewRequest(message);
      return {
        content: [{ type: "text", text: `Posted review request: ${posted.permalink}` }],
        structuredContent: {
          message,
          permalink: posted.permalink,
          reviewers: resolved.map(({ id, name }) => ({ id, name })),
        },
      };
    },
  );

  server.registerTool(
    "search_slack_as_ben",
    {
      title: "Search Slack as Ben",
      description: "Search every Slack conversation visible to Ben through his personal Slack session. Start here, then pass any result's opaque message_ref unchanged to read_slack_thread_as_ben. Supports Slack search syntax in query plus optional structured filters. This may return private Slack content.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500).optional().describe("A Slack-style search query. Slack modifiers such as exact phrases, has:link, from:, in:, after:, and before: are accepted."),
        keywords: z.array(z.string().trim().min(1).max(100)).max(20).optional().describe("Additional words or exact quoted phrases, combined with query and filters."),
        author: z.string().trim().min(1).max(100).optional().describe("Slack username/handle for a from: filter; a leading @ is optional."),
        conversation: z.string().trim().min(1).max(100).optional().describe("Channel or conversation name for an in: filter; a leading # is optional."),
        after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only messages after this date (YYYY-MM-DD)."),
        before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only messages before this date (YYYY-MM-DD)."),
        sort: z.enum(["score", "timestamp"]).default("score"),
        sort_direction: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(25).describe("Messages per page."),
        page: z.number().int().min(1).max(1000).default(1).describe("One-based Slack result page. Use next_page from a prior response."),
      }).strict().refine((input) => Boolean(input.query || input.keywords?.length || input.author || input.conversation || input.after || input.before), {
        message: "Provide query, keywords, author, conversation, after, or before.",
      }),
      outputSchema: z.object({
        query: z.string(),
        results: z.array(slackMessageSchema),
        pagination: z.object({
          page: z.number().int(),
          page_size: z.number().int(),
          total: z.number().int(),
          total_pages: z.number().int(),
          has_more: z.boolean(),
          next_page: z.number().int().optional(),
        }).strict(),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await searchSlackAsBen(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "read_slack_thread_as_ben",
    {
      title: "Read Slack thread as Ben",
      description: "Read the root and replies for a Slack search hit using its message_ref. A reply reference is resolved to its root. A non-threaded message is returned as the root with no replies. Long threads return next_cursor for continuation. This may return private Slack content.",
      inputSchema: z.object({
        message_ref: z.string().min(1).max(1000).describe("The opaque message_ref from search_slack_as_ben. Pass it unchanged whether the hit is a root or reply."),
        max_messages: z.number().int().min(1).max(1000).default(100).describe("Maximum total messages returned, including the root."),
        cursor: z.string().min(1).max(2000).optional().describe("next_cursor from a prior response for the same message_ref."),
      }).strict(),
      outputSchema: z.object({
        root: slackMessageSchema,
        replies: z.array(slackMessageSchema),
        pagination: z.object({
          complete: z.boolean(),
          returned_messages: z.number().int().positive(),
          next_cursor: z.string().optional(),
        }).strict(),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await readSlackThreadAsBen(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
});

async function verifyAccessToken(_request: Request, token?: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
  try {
    const payload = await verifyToken<{ email: string; scope: string }>(token, "access");
    if (payload.email !== allowedEmail) return undefined;
    return {
      token,
      clientId: payload.sub ?? payload.email,
      scopes: payload.scope.split(" "),
      extra: { email: payload.email },
    };
  } catch {
    return undefined;
  }
}

const authHandler = withMcpAuth(handler, verifyAccessToken, {
  required: true,
  requiredScopes: scopes,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST };
