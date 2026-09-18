import { db } from "@/db";
import { brand } from "@/db/schema";
import { eq } from "drizzle-orm";

export type BrandInfo = {
  name: string;
  tagline: string;
  logoVersion: number;
  hasLogo: boolean;
};

export const BRAND_ROW_ID = 1;

export const DEFAULT_BRAND: BrandInfo = {
  name: "Apostle Kwame Ministry",
  tagline: "Live Streaming",
  logoVersion: 0,
  hasLogo: false,
};

export async function getBrand(): Promise<BrandInfo> {
  try {
    const rows = await db.select().from(brand).where(eq(brand.id, BRAND_ROW_ID)).limit(1);
    const row = rows[0];
    if (!row) return DEFAULT_BRAND;
    return {
      name: row.name?.trim() || DEFAULT_BRAND.name,
      tagline: row.tagline?.trim() || DEFAULT_BRAND.tagline,
      logoVersion: row.logoVersion,
      hasLogo: row.logoVersion > 0 && Boolean(row.logoData),
    };
  } catch {
    // Database may not be migrated yet (e.g. during a cold build).
    return DEFAULT_BRAND;
  }
}
