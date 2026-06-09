export default async () => {
  const body = {
    ok: true,
    service: "quant-trade-remote",
    mode: "netlify-functions",
    supports: ["mobile", "desktop", "web"],
    endpoints: ["/api/health", "/api/analyze"],
    generatedAt: new Date().toISOString()
  };

  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};

export const config = {
  path: "/api/health"
};
