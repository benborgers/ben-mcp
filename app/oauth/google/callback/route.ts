import { createRemoteJWKSet, jwtVerify } from "jose";
import { allowedEmail, baseUrl } from "@/lib/config";
import { assertAllowedEmail, signToken, verifyToken } from "@/lib/tokens";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

type OAuthState = { clientId: string; redirectUri: string; clientState?: string; challenge: string; scope: string };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    const code = params.get("code");
    if (!state || !code) throw new Error("Google authorization was not completed");
    const oauth = await verifyToken<OAuthState>(state, "oauth_state");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: `${baseUrl}/oauth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json() as { id_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.id_token) throw new Error(tokens.error_description ?? "Google token exchange failed");
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    assertAllowedEmail(payload.email);
    if (payload.email_verified !== true) throw new Error("Google email is not verified");
    const authorizationCode = await signToken("authorization_code", {
      sub: allowedEmail,
      email: allowedEmail,
      clientId: oauth.clientId,
      redirectUri: oauth.redirectUri,
      challenge: oauth.challenge,
      scope: oauth.scope,
    }, "5m");
    const redirect = new URL(oauth.redirectUri);
    redirect.searchParams.set("code", authorizationCode);
    if (oauth.clientState) redirect.searchParams.set("state", oauth.clientState);
    return Response.redirect(redirect);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Authorization failed", { status: 403 });
  }
}
