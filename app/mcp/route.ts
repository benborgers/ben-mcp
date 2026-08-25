import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { allowedEmail, scopes } from "@/lib/config";
import { normalizeGist, normalizePrUrl } from "@/lib/review";
import { postReviewRequest, resolveReviewers } from "@/lib/slack";
import { verifyToken } from "@/lib/tokens";

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
