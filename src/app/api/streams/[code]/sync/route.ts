import { db } from "@/db";
import { participants, signals } from "@/db/schema";
import {
  activeParticipants,
  authenticate,
  recentMessages,
  summarize,
  toPublicParticipant,
} from "@/lib/server/room";
import type { IncomingSignal, SignalKind, SyncResponse } from "@/lib/types";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticate(code, body.token);
  if (!auth) {
    return Response.json({ error: "Not part of this live" }, { status: 401 });
  }
  const { stream, me } = auth;
  const sinceMessageId = Number(body.sinceMessageId ?? 0) || 0;

  await db
    .update(participants)
    .set({ lastSeenAt: sql`now()`, active: true })
    .where(eq(participants.id, me.id));

  const drained = await db
    .delete(signals)
    .where(and(eq(signals.streamId, stream.id), eq(signals.toId, me.id)))
    .returning();

  const inbox: IncomingSignal[] = drained
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      fromId: row.fromId,
      toId: row.toId,
      kind: row.kind as SignalKind,
      epoch: row.epoch,
      payload: row.payload,
    }));

  const people = await activeParticipants(stream.id);
  const fresh = people.find((p) => p.id === me.id) ?? { ...me, lastSeenAt: new Date() };
  const chat = await recentMessages(stream.id, sinceMessageId);

  const payload: SyncResponse = {
    stream: summarize(stream, people),
    me: toPublicParticipant(fresh),
    participants: people.map(toPublicParticipant),
    messages: chat,
    signals: inbox,
    serverTime: new Date().toISOString(),
  };

  return Response.json(payload);
}
