import { describe, it, expect, vi, beforeEach } from "vitest";

import { OrbitConnection } from "../lib/connection";
import type { TokenStore, StoredConnection } from "../lib/token-store";

const { exchangeSessionToken, refreshAccessToken } = vi.hoisted(() => ({
  exchangeSessionToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock("../lib/orbit-auth", () => ({
  exchangeSessionToken,
  refreshAccessToken,
}));

const STORE = "store-1";

/** A JWT whose `exp` is `secondsFromNow` away. Only the payload is read. */
function tokenExpiringIn(secondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

class MemoryStore implements TokenStore {
  rows = new Map<string, StoredConnection>();
  writes = 0;

  async get(storeId: string) {
    return this.rows.get(storeId) ?? null;
  }

  async put(connection: StoredConnection) {
    this.writes += 1;
    this.rows.set(connection.storeId, connection);
  }
}

describe("OrbitConnection", () => {
  let store: MemoryStore;
  let connection: OrbitConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MemoryStore();
    connection = new OrbitConnection(store);
  });

  it("exchanges the session token and stores the pair", async () => {
    exchangeSessionToken.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    await connection.save(STORE, "session-token");

    expect(exchangeSessionToken).toHaveBeenCalledWith("session-token");
    expect(store.rows.get(STORE)).toEqual({
      storeId: STORE,
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("returns the stored token while it is still valid, without refreshing", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(3600),
      refreshToken: "refresh-1",
    });

    const token = await connection.accessToken(STORE);

    expect(token).toBe(store.rows.get(STORE)!.accessToken);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is close to expiry", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(10),
      refreshToken: "refresh-1",
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    const token = await connection.accessToken(STORE);

    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-1");
    expect(token).toBe("access-2");
  });

  /**
   * The regression this whole sample exists to demonstrate. A refresh
   * invalidates the token it consumed, so failing to persist the replacement
   * locks the integration out permanently.
   */
  it("persists the ROTATED refresh token, not just the access token", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(10),
      refreshToken: "refresh-1",
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await connection.accessToken(STORE);

    expect(store.rows.get(STORE)).toEqual({
      storeId: STORE,
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
  });

  it("persists before returning, so a crash cannot lose the rotation", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(10),
      refreshToken: "refresh-1",
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    let writesAtReturn = -1;
    const original = store.put.bind(store);
    store.put = async (c) => {
      await original(c);
      writesAtReturn = store.writes;
    };

    await connection.accessToken(STORE);

    expect(writesAtReturn).toBe(1);
  });

  it("keeps the existing refresh token when the API returns none", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(10),
      refreshToken: "refresh-1",
    });
    refreshAccessToken.mockResolvedValue({ accessToken: "access-2" });

    await connection.accessToken(STORE);

    // Blanking a working credential on a partial response would be worse than
    // keeping a possibly-stale one.
    expect(store.rows.get(STORE)!.refreshToken).toBe("refresh-1");
  });

  it("returns null when the store has never connected", async () => {
    expect(await connection.accessToken("unknown-store")).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("returns null when there is no refresh token to rotate", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: tokenExpiringIn(10),
      refreshToken: "",
    });

    expect(await connection.accessToken(STORE)).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("treats an unreadable token as expired rather than trusting it", async () => {
    store.rows.set(STORE, {
      storeId: STORE,
      accessToken: "not-a-jwt",
      refreshToken: "refresh-1",
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await connection.accessToken(STORE);

    expect(refreshAccessToken).toHaveBeenCalled();
  });
});
