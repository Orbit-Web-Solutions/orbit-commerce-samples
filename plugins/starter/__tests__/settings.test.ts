import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("../lib/db", () => ({ db: { connection: { findUnique, update } } }));

const { getSettings, saveSettings, DEFAULT_SETTINGS } =
  await import("../lib/settings");

describe("settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns defaults for a store that has saved nothing", async () => {
    findUnique.mockResolvedValue({ settings: "{}" });

    expect(await getSettings("store-1")).toEqual(DEFAULT_SETTINGS);
  });

  /**
   * A settings shape grows. A store that connected before a field existed must
   * not come back with it undefined — merging over the defaults is what makes
   * adding a field safe.
   */
  it("fills in fields added after the store connected", async () => {
    findUnique.mockResolvedValue({ settings: '{"label":"mine"}' });

    const settings = await getSettings("store-1");

    expect(settings.label).toBe("mine");
    expect(settings.syncIntervalMinutes).toBe(
      DEFAULT_SETTINGS.syncIntervalMinutes,
    );
  });

  it("merges a patch over what is already stored", async () => {
    findUnique.mockResolvedValue({
      settings: '{"label":"mine","syncIntervalMinutes":30}',
    });

    const result = await saveSettings("store-1", { syncIntervalMinutes: 10 });

    expect(result).toEqual({
      ...DEFAULT_SETTINGS,
      label: "mine",
      syncIntervalMinutes: 10,
    });
    expect(update).toHaveBeenCalledWith({
      where: { storeId: "store-1" },
      data: { settings: JSON.stringify(result) },
    });
  });

  it("scopes every write to the store it was given", async () => {
    findUnique.mockResolvedValue({ settings: "{}" });

    await saveSettings("store-2", { label: "x" });

    expect(update.mock.calls[0][0].where).toEqual({ storeId: "store-2" });
  });
});
