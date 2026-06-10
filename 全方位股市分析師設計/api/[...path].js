import { handleApiRequest } from "../server.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    setCommonHeaders(res);
    res.end();
    return;
  }

  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost";
    const requestUrl = new URL(req.url || "/", `${protocol}://${host}`);

    if (!requestUrl.pathname.startsWith("/api/")) {
      const path = Array.isArray(req.query?.path) ? req.query.path.join("/") : String(req.query?.path || "");
      requestUrl.pathname = `/api/${path}`;
    }

    const result = await handleApiRequest(requestUrl);
    if (!result) {
      sendJson(res, { ok: false, error: "API route not found." }, 404);
      return;
    }

    sendJson(res, result.data, result.status);
  } catch (error) {
    console.error(error);
    sendJson(
      res,
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      500
    );
  }
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  setCommonHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

function setCommonHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
