import { db } from "@/db";
import { brand } from "@/db/schema";
import { BRAND_ROW_ID } from "@/lib/server/brand";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select().from(brand).where(eq(brand.id, BRAND_ROW_ID)).limit(1);
    const row = rows[0];
    if (!row?.logoData || !row.logoMime) {
      return new Response("No logo", { status: 404 });
    }
    const body = new Uint8Array(row.logoData);
    return new Response(body, {
      headers: {
        "Content-Type": row.logoMime,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        ETag: `"logo-${row.logoVersion}"`,
      },
    });
  } catch {
    return new Response("No logo", { status: 404 });
  }
}
