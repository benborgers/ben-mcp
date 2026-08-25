export function normalizePrUrl(value: string) {
  const match = value.match(/^https?:\/\/github\.com\/owner\/owner\/pull\/(\d+)\/?$/i);
  if (!match) throw new Error("pr_url must be an owner/Owner GitHub pull request URL");
  return `github.com/owner/owner/pull/${match[1]}`;
}

export function normalizeGist(value: string) {
  const gist = value.trim().replace(/\s+/g, " ").replace(/:+$/, "");
  if (!gist) throw new Error("gist is required");
  return gist;
}
