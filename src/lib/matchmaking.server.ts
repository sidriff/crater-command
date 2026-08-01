/**
 * Tiny matchmaking only — no game state.
 * Shape mirrors a drop-in Convex matcher: host | join | bot after wait.
 */
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";

const ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const Race = z.enum(["operators", "blight", "mandate"]);

const WAIT_MS = 10_000;

const globalRef = globalThis as typeof globalThis & {
  __matchSchemaPromise__?: Promise<void>;
};

function ensureSchema(sql: Sql): Promise<void> {
  globalRef.__matchSchemaPromise__ ??= (async () => {
    await sql.query(
      `CREATE TABLE IF NOT EXISTS match_lobbies (
         room_id TEXT PRIMARY KEY,
         host_id TEXT NOT NULL,
         host_race TEXT NOT NULL,
         guest_id TEXT,
         guest_race TEXT,
         status TEXT NOT NULL DEFAULT 'waiting',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  })().catch((err) => {
    globalRef.__matchSchemaPromise__ = undefined;
    throw err;
  });
  return globalRef.__matchSchemaPromise__;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function roomId() {
  return `m-${Math.random().toString(36).slice(2, 10)}`;
}

export async function handleMatch(request: Request): Promise<Response> {
  try {
    const sql = await getSql();
    await ensureSchema(sql);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const room = url.searchParams.get("room");
      const player = url.searchParams.get("player");
      if (!room || !player) return json({ error: "room and player required" }, 400);
      const rows = await sql.query<{
        room_id: string;
        host_id: string;
        host_race: string;
        guest_id: string | null;
        guest_race: string | null;
        status: string;
        created_at: string;
      }>(`SELECT * FROM match_lobbies WHERE room_id = $1`, [room]);
      const row = rows[0];
      if (!row) return json({ error: "not found" }, 404);

      const age = Date.now() - new Date(row.created_at).getTime();
      if (row.status === "waiting" && !row.guest_id && age >= WAIT_MS) {
        await sql.query(`UPDATE match_lobbies SET status = 'bot' WHERE room_id = $1 AND status = 'waiting'`, [
          room,
        ]);
        row.status = "bot";
      }

      return json({
        roomId: row.room_id,
        status: row.status,
        hostId: row.host_id,
        hostRace: row.host_race,
        guestId: row.guest_id,
        guestRace: row.guest_race,
        waitMs: Math.max(0, WAIT_MS - age),
        youAreHost: row.host_id === player,
      });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const parsed = z
        .object({
          op: z.enum(["find", "cancel", "bot_now"]),
          playerId: ID,
          race: Race,
          roomId: ID.optional(),
        })
        .safeParse(body);
      if (!parsed.success) return json({ error: "invalid body" }, 400);
      const { op, playerId, race } = parsed.data;

      if (op === "cancel" && parsed.data.roomId) {
        await sql.query(
          `DELETE FROM match_lobbies WHERE room_id = $1 AND host_id = $2 AND status = 'waiting'`,
          [parsed.data.roomId, playerId],
        );
        return json({ ok: true });
      }

      if (op === "bot_now" && parsed.data.roomId) {
        await sql.query(
          `UPDATE match_lobbies SET status = 'bot' WHERE room_id = $1 AND host_id = $2 AND status = 'waiting'`,
          [parsed.data.roomId, playerId],
        );
        return json({ status: "bot", roomId: parsed.data.roomId });
      }

      // find: join oldest waiting lobby or create
      await sql.query(
        `DELETE FROM match_lobbies WHERE status = 'waiting' AND created_at < now() - interval '2 minutes'`,
      );

      const waiting = await sql.query<{
        room_id: string;
        host_id: string;
        host_race: string;
      }>(
        `SELECT room_id, host_id, host_race FROM match_lobbies
         WHERE status = 'waiting' AND guest_id IS NULL AND host_id <> $1
         ORDER BY created_at ASC LIMIT 1`,
        [playerId],
      );

      if (waiting[0]) {
        const w = waiting[0];
        await sql.query(
          `UPDATE match_lobbies
           SET guest_id = $1, guest_race = $2, status = 'matched'
           WHERE room_id = $3 AND status = 'waiting' AND guest_id IS NULL`,
          [playerId, race, w.room_id],
        );
        return json({
          status: "join",
          roomId: w.room_id,
          hostId: w.host_id,
          hostRace: w.host_race,
          guestId: playerId,
          guestRace: race,
          role: "guest",
        });
      }

      const rid = roomId();
      await sql.query(
        `INSERT INTO match_lobbies (room_id, host_id, host_race, status)
         VALUES ($1, $2, $3, 'waiting')`,
        [rid, playerId, race],
      );
      return json({
        status: "host",
        roomId: rid,
        hostId: playerId,
        hostRace: race,
        role: "host",
        waitMs: WAIT_MS,
      });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error("[match]", e);
    return json({ error: "match failed" }, 500);
  }
}
