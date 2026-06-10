const ROOM_TTL_MS = 30 * 60 * 1000;
const PRESENCE_TTL_MS = 45 * 1000;
const MAX_EVENTS = 40;

const store = globalThis.__quantTradeRooms || new Map();
globalThis.__quantTradeRooms = store;

function now() {
  return Date.now();
}

function normalizeRoom(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function normalizeName(value) {
  const name = String(value || "").trim().slice(0, 24);
  return name || "Guest";
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function cleanup() {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [roomId, room] of store.entries()) {
    if (room.updatedAt < cutoff) {
      store.delete(roomId);
    }
  }
}

function getRoom(roomId) {
  const id = normalizeRoom(roomId);
  if (!id) return null;
  if (!store.has(id)) {
    store.set(id, {
      id,
      createdAt: now(),
      updatedAt: now(),
      users: new Map(),
      events: [],
      latestSignal: null
    });
  }
  return store.get(id);
}

function touchUser(room, clientId, name) {
  const id = String(clientId || "").slice(0, 80);
  if (!id) return;
  room.users.set(id, {
    id,
    name: normalizeName(name),
    seenAt: now()
  });
  room.updatedAt = now();
}

function roomSnapshot(room) {
  const activeAfter = now() - PRESENCE_TTL_MS;
  const users = Array.from(room.users.values())
    .filter((user) => user.seenAt >= activeAfter)
    .sort((a, b) => b.seenAt - a.seenAt)
    .map((user) => ({
      id: user.id,
      name: user.name,
      seenAt: new Date(user.seenAt).toISOString()
    }));

  return {
    ok: true,
    room: room.id,
    users,
    userCount: users.length,
    latestSignal: room.latestSignal,
    events: room.events.slice(-MAX_EVENTS),
    generatedAt: new Date().toISOString()
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  cleanup();

  if (req.method === "GET") {
    const url = new URL(req.url, "https://quant.local");
    const room = getRoom(url.searchParams.get("room"));
    if (!room) {
      json(res, 400, { ok: false, error: "Room is required" });
      return;
    }
    touchUser(room, url.searchParams.get("clientId"), url.searchParams.get("name"));
    json(res, 200, roomSnapshot(room));
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const body = await readBody(req);
  const room = getRoom(body.room);
  if (!room) {
    json(res, 400, { ok: false, error: "Room is required" });
    return;
  }

  const action = String(body.action || "heartbeat");
  touchUser(room, body.clientId, body.name);

  if (action === "leave") {
    room.users.delete(String(body.clientId || ""));
  }

  if (action === "publish") {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: body.type || "signal",
      user: normalizeName(body.name),
      signal: body.signal || null,
      strategy: body.strategy || null,
      summary: String(body.summary || "").slice(0, 240),
      at: new Date().toISOString()
    };
    room.latestSignal = event;
    room.events.push(event);
    room.events = room.events.slice(-MAX_EVENTS);
    room.updatedAt = now();
  }

  json(res, 200, roomSnapshot(room));
}
