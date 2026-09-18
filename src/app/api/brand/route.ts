import { db } from "@/db";
import { brand } from "@/db/schema";
import { BRAND_ROW_ID, DEFAULT_BRAND, getBrand } from "@/lib/server/brand";
import { ImageError, normalizeImage, readUploadedImage } from "@/lib/server/images";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const MAX_RAW_BYTES = 15 * 1024 * 1024;
const LOGO_EDGE = 512;

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function GET() {
  return Response.json(await getBrand());
}

/** Update ministry name / tagline and optionally upload a new logo (multipart or JSON). */
export async function POST(request: Request) {
  try {
    const { bytes, fields } = await readUploadedImage(request, MAX_RAW_BYTES);

    const name = fields.name?.trim() ? fields.name.trim().slice(0, 60) : undefined;
    const tagline = fields.tagline !== undefined ? fields.tagline.trim().slice(0, 60) : undefined;

    let logo: { data: Buffer; mime: string } | null = null;
    if (bytes) {
      const normalized = await normalizeImage(bytes, { maxEdge: LOGO_EDGE, output: "png" });
      logo = { data: normalized.data, mime: normalized.mime };
    }

    await db
      .insert(brand)
      .values({
        id: BRAND_ROW_ID,
        name: name ?? DEFAULT_BRAND.name,
        tagline: tagline ?? DEFAULT_BRAND.tagline,
        logoMime: logo?.mime ?? null,
        logoData: logo?.data ?? null,
        logoVersion: logo ? 1 : 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: brand.id,
        set: {
          ...(name !== undefined ? { name } : {}),
          ...(tagline !== undefined ? { tagline } : {}),
          ...(logo
            ? {
                logoMime: logo.mime,
                logoData: logo.data,
                logoVersion: sql`${brand.logoVersion} + 1`,
              }
            : {}),
          updatedAt: new Date(),
        },
      });

    return Response.json({ ok: true, brand: await getBrand() });
  } catch (err) {
    if (err instanceof ImageError) return fail(err.message, err.status);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[brand] save failed:", message);
    return fail(`Could not save on the server: ${message}`, 500);
  }
}

/** Remove the uploaded logo (keeps the ministry name). */
export async function DELETE() {
  try {
    await db
      .insert(brand)
      .values({
        id: BRAND_ROW_ID,
        name: DEFAULT_BRAND.name,
        tagline: DEFAULT_BRAND.tagline,
        logoMime: null,
        logoData: null,
        logoVersion: 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: brand.id,
        set: { logoMime: null, logoData: null, logoVersion: 0, updatedAt: new Date() },
      });
    return Response.json({ ok: true, brand: await getBrand() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return fail(`Could not remove the logo: ${message}`, 500);
  }
}
