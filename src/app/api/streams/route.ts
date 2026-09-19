import { db } from "@/db";
import { participants, streams } from "@/db/schema";
import { ensureSchema } from "@/lib/server/ensureSchema";
import {
  PRESENCE_WINDOW_MS,
  makeCode,
  makeToken,
  sanitizeName,
  summarize,
  systemMessage,
} from "@/lib/server/room";
import type { StreamSummary } from "@/lib/types";
import { and, desc, eq, gt, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
  const rows = await db
    .select()
    .from(streams)
    .where(eq(streams.status, "live"))
    .orderBy(desc(streams.createdAt))
    .limit(40);

  const counts = await db
    .select({
      streamId: participants.streamId,
      role: participants.role,
      total: sql<number>`count(*)::int`,
    })
    .from(participants)
    .where(and(eq(participants.active, true), gt(participants.lastSeenAt, cutoff)))
    .groupBy(participants.streamId, participants.role);

  const byStream = new Map<number, { viewers: number; onStage: number }>();
  for (const row of counts) {
    const entry = byStream.get(row.streamId) ?? { viewers: 0, onStage: 0 };
    const total = Number(row.total ?? 0);
    entry.viewers += total;
    if (row.role === "host" || row.role === "guest") entry.onStage += total;
    byStream.set(row.streamId, entry);
  }

  const live: StreamSummary[] = rows
    .map((r) => ({
      summary: summarize(r, []),
      viewers: byStream.get(r.id)?.viewers ?? 0,
      onStage: byStream.get(r.id)?.onStage ?? 0,
      fresh: Date.now() - r.createdAt.getTime() < 45_000,
    }))
    .filter((r) => r.viewers > 0 || r.fresh)
    .map(({ summary, viewers, onStage }) => ({ ...summary, viewers, onStage }));

  return Response.json({ streams: live });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const hostName = sanitizeName(body.hostName, "Host");
  const mode = body.mode === "audio" ? "audio" : "video";
  const rawTitle = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
  const title = rawTitle || `${hostName}'s live`;
  const tagline =
    typeof body.tagline === "string" && body.tagline.trim()
      ? body.tagline.trim().slice(0, 120)
      : null;
  const scheduledFor =
    typeof body.scheduledFor === "string" && body.scheduledFor.trim()
      ? body.scheduledFor.trim().slice(0, 60)
      : null;

  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await db
      .select({ id: streams.id })
      .from(streams)
      .where(eq(streams.code, code))
      .limit(1);
    if (clash.length === 0) break;
    code = makeCode();
  }

  const [stream] = await db
    .insert(streams)
    .values({
      code,
      title,
      hostName,
      mode,
      status: "live",
      phase: "prelive",
      tagline,
      scheduledFor,
    })
    .returning();

  const token = makeToken();
  const [host] = await db
    .insert(participants)
    .values({
      streamId: stream.id,
      name: hostName,
      token,
      role: "host",
      media: mode,
      micOn: true,
      camOn: mode === "video",
    })
    .returning();

  await systemMessage(stream.id, `${hostName} opened the room — starting soon`);

  return Response.json({
    code: stream.code,
    participantId: host.id,
    token,
    name: host.name,
    role: "host",
  });
}

export async function PATCH() {
  // Housekeeping: auto-end lives whose host stopped sending heartbeats.
  await db.execute(sql`
    update streams s
    set status = 'ended', ended_at = now()
    where s.status = 'live'
      and s.created_at < now() - interval '2 minutes'
      and not exists (
        select 1 from participants p
        where p.stream_id = s.id
          and p.role = 'host'
          and p.last_seen_at > now() - interval '2 minutes'
      )
  `);
  return Response.json({ ok: true });
}
