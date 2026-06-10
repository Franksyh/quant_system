export const config = {
  runtime: "edge"
};

export default async () => {
  const body = {
    ok: true,
    service: "quant-trade-remote",
    mode: "vercel-functions",
    supports: ["mobile", "desktop", "web", "multi-user-room"],
    endpoints: ["/api/health", "/api/analyze", "/api/room"],
    generatedAt: new Date().toISOString()
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
};
