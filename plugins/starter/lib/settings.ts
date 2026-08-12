import { db } from "./db";

/**
 * Per-store plugin settings.
 *
 * Two places these can live, and the difference matters:
 *
 * - **Here, in your own database** — anything only your plugin understands.
 *   That is what this file does, and what most plugins need.
 * - **In Orbit**, via `orbit.settings.get()` / `.update()` — for values the
 *   dashboard itself renders from your manifest's `settingsSchema`. Use that
 *   when you want the merchant editing settings in Orbit's own UI rather than
 *   inside your iframe.
 *
 * Either way, settings are per store. A plugin has no global configuration,
 * because every merchant configures it differently.
 */
export interface StarterSettings {
  /**
   * How often the background worker runs a pass for this store, in minutes.
   * Read by `worker/index.ts` — this is a real setting, not a display value.
   */
  syncIntervalMinutes: number;
  /** Free-text label, showing a string field round-tripping. */
  label: string;
}

export const DEFAULT_SETTINGS: StarterSettings = {
  syncIntervalMinutes: 5,
  label: "",
};

export async function getSettings(storeId: string): Promise<StarterSettings> {
  const row = await db.connection.findUnique({
    where: { storeId },
    select: { settings: true },
  });

  // Merged over the defaults rather than returned raw: a settings shape grows
  // over time, and a store that connected before you added a field must not
  // come back with it undefined.
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row?.settings ?? "{}") };
}

export async function saveSettings(
  storeId: string,
  patch: Partial<StarterSettings>,
): Promise<StarterSettings> {
  const current = await getSettings(storeId);
  const next = { ...current, ...patch };

  await db.connection.update({
    where: { storeId },
    data: { settings: JSON.stringify(next) },
  });

  return next;
}
