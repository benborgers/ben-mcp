import { randomBytes } from "node:crypto";
import { baseUrl, scopes } from "@/lib/config";
import { resolveClient, signToken } from "@/lib/tokens";

function oauthError(redirectUri: string | null, state: string | null, error: string, description: string) {
  if (!redirectUri) return Response.json({ error, error_description: description }, { status: 400 });
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const challenge = params.get("code_challenge");
  const method = params.get("code_challenge_method");
  try {
    if (!clientId || !redirectUri || !challenge || method !== "S256" || params.get("response_type") !== "code") throw new Error("Authorization code flow with S256 PKCE is required");
    const client = await resolveClient(clientId);
    if (!client.redirect_uris.includes(redirectUri)) throw new Error("redirect_uri is not registered");
    const requestedScopes = (params.get("scope") ?? scopes.join(" ")).split(" ").filter(Boolean);
    if (requestedScopes.some((scope) => !scopes.includes(scope))) throw new Error("Unsupported scope");
    const oauthState = await signToken("oauth_state", {
      clientId,
      redirectUri,
      clientState: state,
      challenge,
      scope: requestedScopes.join(" "),
      nonce: randomBytes(16).toString("base64url"),
    }, "10m");
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
    google.searchParams.set("redirect_uri", `${baseUrl}/oauth/google/callback`);
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("prompt", "select_account");
    google.searchParams.set("state", oauthState);
    return Response.redirect(google);
  } catch (error) {
    return oauthError(redirectUri, state, "invalid_request", error instanceof Error ? error.message : "Invalid request");
  }
}
