import { db } from "@/db";
import { messages, participants } from "@/db/schema";
import { ImageError, normalizeImage, readUploadedImage } from "@/lib/server/images";
import { authenticate, avatarFor } from "@/lib/server/room";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** A viewer or host uploads their own profile photo. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  try {
    const { bytes, fields } = await readUploadedImage(request, 8 * 1024 * 1024);
    const auth = await authenticate(code, fields.token);
    if (!auth) return fail("Not part of this live", 401);
    if (!bytes) return fail("No image received", 400);

    const image = await normalizeImage(bytes, { maxEdge: 512, output: "auto" });
    const [updated] = await db
      .update(participants)
      .set({
        photoMime: image.mime,
        photoData: image.data,
        photoVersion: sql`${participants.photoVersion} + 1`,
      })
      .where(eq(participants.id, auth.me.id))
      .returning({ photoVersion: participants.photoVersion });

    const version = updated?.photoVersion ?? 1;
    const url = avatarFor(auth.me.id, auth.me.name, version);
    await db
      .update(messages)
      .set({ avatar: url })
      .where(
        and(eq(messages.streamId, auth.stream.id), eq(messages.participantId, auth.me.id)),
      );

    return Response.json({ ok: true, photoVersion: version, avatar: url });
  } catch (err) {
    if (err instanceof ImageError) return fail(err.message, err.status);
    return fail(err instanceof Error ? err.message : "Upload failed", 500);
  }
}
