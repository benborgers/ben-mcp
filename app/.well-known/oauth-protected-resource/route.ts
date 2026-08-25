import { baseUrl, mcpUrl, scopes } from "@/lib/config";

export function GET() {
  return Response.json({
    resource: mcpUrl,
    authorization_servers: [baseUrl],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
