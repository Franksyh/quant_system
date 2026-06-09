import type { Config } from "@netlify/functions";
import { handleApiRequest } from "../../server.js";

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    const result = await handleApiRequest(new URL(req.url));
    if (!result) {
      return json({ ok: false, error: "API route not found." }, 404);
    }

    return json(result.data, result.status);
  } catch (error) {
    console.error(error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      500
    );
  }
};

export const config: Config = {
  path: "/api/*",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
