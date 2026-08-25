# ben-mcp

Ben Borgers's private MCP server, deployed at `mcp.ben.page` and restricted to `borgersbenjamin@gmail.com` through Google OAuth.

## Tools

### `request_pr_review`

Posts to Owner's `#plg-review-requests` as Ben using his Slack session credentials.

Inputs:

- `pr_url`: full `owner/Owner` GitHub PR URL
- `gist`: concise summary to place before the URL
- `reviewers`: natural reviewer names, resolved to real Slack mentions

## Environment

- `BASE_URL`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SLACK_XOXC`
- `SLACK_XOXD`
