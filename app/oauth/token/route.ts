import { allowedEmail } from "@/lib/config";
import { resolveClient, signToken, verifyPkce, verifyToken } from "@/lib/tokens";

type AuthorizationCode = { email: string; clientId: string; redirectUri: string; challenge: string; scope: string };
type RefreshToken = { email: string; clientId: string; scope: string };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
}

async function issue(clientId: string, scope: string) {
  const accessToken = await signToken("access", { sub: clientId, email: allowedEmail, scope }, "1h");
  const refreshToken = await signToken("refresh", { sub: clientId, email: allowedEmail, clientId, scope }, "30d");
  return { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const grantType = String(form.get("grant_type") ?? "");
    const clientId = String(form.get("client_id") ?? "");
    if (!clientId) throw new Error("client_id is required");
    await resolveClient(clientId);
    if (grantType === "authorization_code") {
      const code = String(form.get("code") ?? "");
      const verifier = String(form.get("code_verifier") ?? "");
      const redirectUri = String(form.get("redirect_uri") ?? "");
      const payload = await verifyToken<AuthorizationCode>(code, "authorization_code");
      if (payload.clientId !== clientId || payload.redirectUri !== redirectUri || payload.email !== allowedEmail) throw new Error("Authorization code does not match this client");
      if (!verifyPkce(verifier, payload.challenge)) throw new Error("PKCE verification failed");
      return json(await issue(clientId, payload.scope));
    }
    if (grantType === "refresh_token") {
      const refreshToken = String(form.get("refresh_token") ?? "");
      const payload = await verifyToken<RefreshToken>(refreshToken, "refresh");
      if (payload.clientId !== clientId || payload.email !== allowedEmail) throw new Error("Refresh token does not match this client");
      return json(await issue(clientId, payload.scope));
    }
    return json({ error: "unsupported_grant_type" }, 400);
  } catch (error) {
    return json({ error: "invalid_grant", error_description: error instanceof Error ? error.message : "Token request failed" }, 400);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}
