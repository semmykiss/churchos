import { db } from "@/server/db";
import { forbidden } from "@/server/http";

/**
 * Per-church feature flags for the "AI Beyond the Chat" suite (backend only).
 * Each new feature ships behind its own flag for independent rollback. Flags
 * live in the existing Organization.settings JSON blob — no schema change,
 * owner-editable from Admin → Settings (default: enabled).
 */
export type FeatureKey =
  | "featureCareRadar"
  | "featureBoardReports"
  | "featureSermonStudio"
  | "featureServingAi";

export const FEATURE_KEYS: FeatureKey[] = [
  "featureCareRadar",
  "featureBoardReports",
  "featureSermonStudio",
  "featureServingAi",
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  featureCareRadar: "Care Radar (at-risk member detection)",
  featureBoardReports: "Board reports (natural-language, permission-scoped)",
  featureSermonStudio: "Sermon Studio (AI sermon prep)",
  featureServingAi: "Smart volunteer scheduling (rota engine)",
};

/** Read one flag — defaults to true (features ship enabled; owner can roll back). */
export async function featureEnabled(orgId: string, key: FeatureKey): Promise<boolean> {
  try {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    if (!org?.settings) return true;
    const settings = JSON.parse(org.settings) as Record<string, unknown>;
    return settings[key] !== false;
  } catch {
    return true;
  }
}

/** Read all four flags in one query (for GET /features + UI gating). */
export async function featuresFor(orgId: string): Promise<Record<FeatureKey, boolean>> {
  const out = { featureCareRadar: true, featureBoardReports: true, featureSermonStudio: true, featureServingAi: true };
  try {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    if (org?.settings) {
      const settings = JSON.parse(org.settings) as Record<string, unknown>;
      for (const k of FEATURE_KEYS) {
        if (settings[k] === false) out[k] = false;
      }
    }
  } catch {
    /* defaults */
  }
  return out;
}

/** Server-side gate used at the top of every feature service entry point. */
export async function assertFeature(orgId: string, key: FeatureKey): Promise<void> {
  if (!(await featureEnabled(orgId, key))) {
    throw forbidden(`This feature is turned off for your church (${FEATURE_LABELS[key]}).`);
  }
}
