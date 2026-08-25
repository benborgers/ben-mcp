import { createClientId, type ClientMetadata, validateClientMetadata } from "@/lib/tokens";

export async function POST(request: Request) {
  try {
    const metadata = await request.json() as ClientMetadata;
    validateClientMetadata(metadata);
    const clientId = await createClientId(metadata);
    return Response.json({
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
    }, { status: 201, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    return Response.json({ error: "invalid_client_metadata", error_description: error instanceof Error ? error.message : "Invalid client metadata" }, { status: 400 });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
