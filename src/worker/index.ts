import { eventDate, isEventKey, tallinnToday } from "../shared/events";
import { ADDRESS_MAX, NOTE_MAX, RULES, type House, type RuleKey } from "../shared/houses";

interface Env {
  DB: D1Database;
  GOOGLE_MAPS_API_KEY?: string;
  MAP_ID_MARDI: string;
  MAP_ID_KADRI: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY?: string;
}

interface HouseRow {
  id: string;
  event: "mardi" | "kadri";
  event_date: string;
  address: string;
  lat: number;
  lng: number;
  time_from: string;
  time_to: string;
  rules: string;
  note: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// A listing disappears from the map after this many reports, until someone looks at it.
const REPORTS_TO_HIDE = 3;

// Rough bounding box of Estonia, islands included.
const BOUNDS = { minLat: 57.4, maxLat: 59.9, minLng: 21.5, maxLng: 28.3 };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PUBLIC_COLUMNS = "id, event, event_date, address, lat, lng, time_from, time_to, rules, note";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Midagi läks valesti. Proovi hiljem uuesti." }, 500);
    }
  },

  async scheduled(_controller, env) {
    await purgePast(env);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(2); // drop "", "api"
  const method = request.method;

  if (parts[0] === "config" && parts.length === 1 && method === "GET") {
    return json({
      mapsApiKey: env.GOOGLE_MAPS_API_KEY ?? "",
      mapIds: { mardi: env.MAP_ID_MARDI, kadri: env.MAP_ID_KADRI },
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    });
  }

  if (parts[0] !== "houses") throw new HttpError(404, "Sellist aadressi pole.");
  const id = parts[1];

  if (!id && method === "GET") return listHouses(env, url);
  if (!id && method === "POST") return createHouse(request, env);
  if (id && parts.length === 2 && method === "GET") return json(await getHouse(env, id));
  if (id && parts.length === 2 && method === "PATCH") return updateHouse(request, env, id);
  if (id && parts.length === 2 && method === "DELETE") return deleteHouse(request, env, id);
  if (id && parts[2] === "report" && method === "POST") return reportHouse(env, id);

  throw new HttpError(405, "Seda toimingut siin ei saa teha.");
}

async function listHouses(env: Env, url: URL): Promise<Response> {
  const event = url.searchParams.get("event");
  if (!isEventKey(event)) throw new HttpError(400, "Vali mardipäev või kadripäev.");
  const date = eventDate(event, tallinnToday());
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS} FROM houses WHERE event = ? AND event_date = ? AND hidden = 0`,
  ).bind(event, date).all<HouseRow>();
  return json({ eventDate: date, houses: results.map(toHouse) });
}

async function getHouse(env: Env, id: string): Promise<House> {
  const row = await env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM houses WHERE id = ?`).bind(id).first<HouseRow>();
  if (!row) throw new HttpError(404, "Seda maja pole enam kaardil.");
  return toHouse(row);
}

async function createHouse(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!isEventKey(body.event)) throw new HttpError(400, "Vali mardipäev või kadripäev.");
  const input = validate(body);
  await verifyTurnstile(env, body.turnstileToken, request.headers.get("CF-Connecting-IP"));

  const id = crypto.randomUUID();
  const token = randomToken();
  const date = eventDate(body.event, tallinnToday());
  await env.DB.prepare(
    `INSERT INTO houses (id, event, event_date, address, lat, lng, time_from, time_to, rules, note, edit_token_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.event, date, input.address, input.lat, input.lng,
    input.timeFrom, input.timeTo, JSON.stringify(input.rules), input.note, await sha256(token),
  ).run();

  return json({ id, editToken: token, eventDate: date }, 201);
}

async function updateHouse(request: Request, env: Env, id: string): Promise<Response> {
  await authorize(request, env, id);
  const input = validate(await readJson(request));
  await env.DB.prepare(
    `UPDATE houses SET address = ?, lat = ?, lng = ?, time_from = ?, time_to = ?, rules = ?, note = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(
    input.address, input.lat, input.lng, input.timeFrom, input.timeTo,
    JSON.stringify(input.rules), input.note, id,
  ).run();
  return json(await getHouse(env, id));
}

async function deleteHouse(request: Request, env: Env, id: string): Promise<Response> {
  await authorize(request, env, id);
  await env.DB.prepare("DELETE FROM houses WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

async function reportHouse(env: Env, id: string): Promise<Response> {
  await env.DB.prepare(
    "UPDATE houses SET reports = reports + 1, hidden = (reports + 1 >= ?) WHERE id = ?",
  ).bind(REPORTS_TO_HIDE, id).run();
  return new Response(null, { status: 204 });
}

/** Deletes every listing whose evening has passed. Runs from the cron trigger. */
async function purgePast(env: Env): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM houses WHERE event_date < ?").bind(tallinnToday()).run();
  console.log(`Purged ${result.meta.changes} past listings`);
}

function validate(body: Record<string, unknown>) {
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address) throw new HttpError(400, "Lisa aadress.");
  if (address.length > ADDRESS_MAX) throw new HttpError(400, "Aadress on liiga pikk.");

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!(lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng)) {
    throw new HttpError(400, "Asukoht peab olema Eestis.");
  }

  const timeFrom = String(body.timeFrom ?? "");
  const timeTo = String(body.timeTo ?? "");
  if (!TIME_RE.test(timeFrom) || !TIME_RE.test(timeTo)) throw new HttpError(400, "Kellaaeg on vales vormingus.");
  if (timeFrom >= timeTo) throw new HttpError(400, "Lõpuaeg peab olema hilisem kui algusaeg.");

  const rules = Array.isArray(body.rules)
    ? [...new Set(body.rules.filter((r): r is RuleKey => typeof r === "string" && r in RULES))]
    : [];

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) throw new HttpError(400, `Märkus võib olla kuni ${NOTE_MAX} tähemärki.`);

  return { address, lat, lng, timeFrom, timeTo, rules, note };
}

async function authorize(request: Request, env: Env, id: string): Promise<void> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const row = await env.DB.prepare("SELECT edit_token_hash FROM houses WHERE id = ?").bind(id).first<{ edit_token_hash: string }>();
  if (!row) throw new HttpError(404, "Seda maja pole enam kaardil.");
  if (!token || (await sha256(token)) !== row.edit_token_hash) {
    throw new HttpError(403, "Muutmislink ei kehti.");
  }
}

async function verifyTurnstile(env: Env, token: unknown, ip: string | null): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) return; // not configured, e.g. local development
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", typeof token === "string" ? token : "");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const outcome = await res.json<{ success: boolean }>();
  if (!outcome.success) throw new HttpError(400, "Robotikontroll ebaõnnestus. Proovi uuesti.");
}

function toHouse(row: HouseRow): House {
  return {
    id: row.id,
    event: row.event,
    eventDate: row.event_date,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    rules: JSON.parse(row.rules),
    note: row.note,
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Vigane päring.");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
