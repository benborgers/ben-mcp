import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { allowedEmail, baseUrl } from "./config";

const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(value);
};

export type ClientMetadata = {
  client_id?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
};

export async function signToken(type: string, claims: Record<string, unknown>, expiresIn: string) {
  return new SignJWT({ ...claims, type })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(baseUrl)
    .setAudience(baseUrl)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifyToken<T extends Record<string, unknown>>(token: string, type: string) {
  const { payload } = await jwtVerify(token, secret(), { issuer: baseUrl, audience: baseUrl });
  if (payload.type !== type) throw new Error(`Expected ${type} token`);
  return payload as T & { sub?: string; scope?: string };
}

export async function createClientId(metadata: ClientMetadata) {
  return signToken("client", { metadata }, "365d");
}

export async function resolveClient(clientId: string): Promise<ClientMetadata> {
  if (clientId.startsWith("https://")) {
    const url = new URL(clientId);
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Unable to read client metadata document");
    const metadata = (await response.json()) as ClientMetadata;
    if (metadata.client_id !== clientId) throw new Error("Client metadata document ID mismatch");
    validateClientMetadata(metadata);
    return metadata;
  }
  const payload = await verifyToken<{ metadata: ClientMetadata }>(clientId, "client");
  validateClientMetadata(payload.metadata);
  return payload.metadata;
}

export function validateClientMetadata(metadata: ClientMetadata) {
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) throw new Error("redirect_uris is required");
  for (const redirect of metadata.redirect_uris) {
    const url = new URL(redirect);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Redirect URIs must use HTTPS or localhost");
    }
  }
}

export function verifyPkce(verifier: string, challenge: string) {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(actual);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertAllowedEmail(email: unknown) {
  if (email !== allowedEmail) throw new Error("This MCP server is private");
}
