"use client";

import { useCallback, useEffect, useState } from "react";
import { OrbitClient } from "@orbitcommerce/sdk";
import type { Plan } from "@orbitcommerce/sdk";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface Settings {
  syncIntervalMinutes: number;
  label: string;
}

interface Note {
  id: string;
  body: string;
  createdAt: string;
}

/**
 * The plugin's UI, rendered inside the merchant's dashboard in an iframe.
 *
 * ## How this page gets its context
 *
 * It is not passed a store id in the URL and it does not ask the user who they
 * are. `new OrbitClient()` starts a `postMessage` handshake with the
 * dashboard; `ready()` resolves once the dashboard has replied with a
 * short-lived session token. Everything after that is authenticated by sending
 * that token to your own backend.
 *
 * The token is short-lived on purpose. Your backend exchanges it once for the
 * long-lived pair (see `/api/connect`) and works from that afterwards.
 */
export default function EmbedPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscribed, setSubscribed] = useState<string>("checking…");
  const [orbit, setOrbit] = useState<OrbitClient | null>(null);

  const authed = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(`${basePath}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      }),
    [token],
  );

  // --- handshake -----------------------------------------------------------
  useEffect(() => {
    const orbit = new OrbitClient();

    void (async () => {
      try {
        await orbit.ready(15000);

        const sessionToken = orbit.getToken();
        if (!sessionToken) {
          setError("The dashboard did not provide a session token.");
          return;
        }

        // Exchange for the durable pair before anything else — the rest of the
        // plugin, including the background worker, depends on it existing.
        const response = await fetch(`${basePath}/api/connect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setError(body.error ?? `Connect failed (${response.status})`);
          return;
        }

        const { storeId } = await response.json();
        setStoreId(storeId);
        setToken(sessionToken);

        setOrbit(orbit);

        // Billing. What the merchant may buy, and what they already have.
        //
        // This is for DISPLAY. The same check runs server-side in
        // lib/billing.ts before anything that costs money happens — a page
        // running on the merchant's machine cannot be the thing that decides
        // whether they paid.
        //
        // Requires the `billing:read` scope. Without it these 401, and a
        // handler that treats the error as "not subscribed" shows a free tier
        // to paying customers.
        try {
          const [available, status] = await Promise.all([
            orbit.billing.getPlans(),
            orbit.billing.getSubscriptionStatus(),
          ]);
          setPlans(available ?? []);
          setSubscribed(
            status.hasSubscription
              ? (status.subscription?.planName ?? "subscribed")
              : "no subscription",
          );
        } catch (e) {
          // Not "no subscription" — we genuinely do not know.
          setSubscribed(
            `billing unavailable (${e instanceof Error ? e.message : "error"})`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    })();

    return () => orbit.destroy();
  }, []);

  // --- load once authenticated ---------------------------------------------
  useEffect(() => {
    if (!token) return;
    void (async () => {
      const [s, n] = await Promise.all([
        authed("/api/settings").then((r) => r.json()),
        authed("/api/notes").then((r) => r.json()),
      ]);
      setSettings(s);
      setNotes(n.notes ?? []);
    })();
  }, [token, authed]);

  const saveSettings = async (patch: Partial<Settings>) => {
    const next = await authed("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.json());
    setSettings(next);
  };

  const addNote = async () => {
    if (!draft.trim()) return;
    const { note } = await authed("/api/notes", {
      method: "POST",
      body: JSON.stringify({ body: draft }),
    }).then((r) => r.json());
    setNotes((prev) => [note, ...prev]);
    setDraft("");
  };

  const deleteNote = async (id: string) => {
    await authed(`/api/notes?id=${id}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  if (error) {
    return (
      <Shell>
        <p style={{ color: "#b3261e" }}>Could not connect: {error}</p>
        <p style={S.hint}>
          Reload to try again. Until this succeeds the plugin has no credential
          and the background worker will not run.
        </p>
      </Shell>
    );
  }

  if (!token || !settings) {
    return (
      <Shell>
        <p>Connecting…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p style={{ color: "#0a7d32", marginBottom: 4 }}>Connected</p>
      <p style={S.hint}>
        Store {storeId?.slice(0, 8)}… · {subscribed}
      </p>

      <Section
        title="Settings"
        note="Stored per store, in the plugin's own database."
      >
        <label style={S.row}>
          <span>Sync every (minutes)</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={settings.syncIntervalMinutes}
            onChange={(e) =>
              saveSettings({ syncIntervalMinutes: Number(e.target.value) })
            }
            style={S.input}
          />
        </label>

        <label style={S.row}>
          <span>Label</span>
          <input
            value={settings.label}
            onChange={(e) =>
              setSettings({ ...settings, label: e.target.value })
            }
            onBlur={(e) => saveSettings({ label: e.target.value })}
            style={S.input}
          />
        </label>
      </Section>

      <Section
        title="Billing"
        note="What this plugin charges for, and what this store has."
      >
        {plans.length === 0 ? (
          <p style={S.hint}>
            No plans. The <code>pricing</code> block in <code>plugin.json</code>{" "}
            is only a display summary for the store listing — it does not create
            anything sellable. Real plans and prices are configured on the
            plugin&apos;s detail page in the partner dashboard, and that is what
            appears here.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {plans.map((p) => {
              const price = p.prices?.[0];
              return (
                <li key={p.id} style={S.note}>
                  <span>
                    {p.name}
                    {price
                      ? ` — ${price.currencyCode} ${price.price}/${price.billingPeriod}`
                      : ""}
                  </span>
                  <button
                    style={S.button}
                    onClick={async () => {
                      if (!orbit || !price) return;
                      try {
                        // The dashboard renders the payment UI; your plugin
                        // never touches card details.
                        await orbit.billing.requestPurchase({
                          planId: p.id,
                          priceId: price.id,
                        });
                        orbit.toast({ message: "Purchased", type: "success" });
                      } catch (e) {
                        orbit.toast({
                          message:
                            e instanceof Error
                              ? e.message
                              : "Purchase cancelled",
                          type: "error",
                        });
                      }
                    }}
                  >
                    Buy
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Your own records"
        note="CRUD against the plugin's database, scoped to this store."
      >
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={draft}
            placeholder="Add a note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={addNote} style={S.button}>
            Add
          </button>
        </div>

        {notes.length === 0 ? (
          <p style={S.hint}>Nothing yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
            {notes.map((note) => (
              <li key={note.id} style={S.note}>
                <span>{note.body}</span>
                <button
                  onClick={() => deleteNote(note.id)}
                  style={{
                    ...S.button,
                    background: "transparent",
                    color: "#b3261e",
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 32,
        maxWidth: 640,
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Starter plugin</h1>
      {children}
    </main>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, marginBottom: 2 }}>{title}</h2>
      <p style={{ ...S.hint, marginBottom: 12 }}>{note}</p>
      {children}
    </section>
  );
}

const S = {
  hint: { fontSize: 13, color: "#666", margin: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 0",
    fontSize: 14,
  },
  input: {
    padding: "6px 8px",
    border: "1px solid #ccc",
    borderRadius: 6,
    fontSize: 14,
  },
  button: {
    padding: "6px 12px",
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  note: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderTop: "1px solid #eee",
    fontSize: 14,
  },
} as const;
