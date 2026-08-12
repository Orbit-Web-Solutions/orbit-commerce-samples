"use client";

import { useEffect, useState } from "react";
import { OrbitClient } from "@orbitcommerce/sdk";

type State =
  | { status: "connecting" }
  | { status: "connected"; storeId: string }
  | { status: "failed"; message: string };

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The entire user interface of this connector.
 *
 * A backend integration still needs one page, because this is where the
 * credential comes from: the dashboard hands the iframe a short-lived session
 * token over postMessage, and that token is the only way to obtain the
 * long-lived pair the worker runs on. There is no API key to paste instead.
 *
 * So the page has exactly one job — perform that handshake and report whether
 * it worked. Everything else your connector does belongs in the worker, which
 * runs with no browser at all.
 */
export default function ConnectPage() {
  const [state, setState] = useState<State>({ status: "connecting" });

  useEffect(() => {
    const orbit = new OrbitClient();

    void (async () => {
      try {
        // Waits for the dashboard's postMessage handshake to complete.
        await orbit.ready(15000);

        const sessionToken = orbit.getToken();
        if (!sessionToken) {
          setState({
            status: "failed",
            message: "The dashboard did not provide a session token.",
          });
          return;
        }

        // Hand it to our own backend, which exchanges it for the durable pair.
        // The token never goes anywhere else, and never into a URL.
        const response = await fetch(`${basePath}/api/connect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setState({
            status: "failed",
            message: body.error ?? `Connect failed (${response.status})`,
          });
          return;
        }

        const { storeId } = await response.json();
        setState({ status: "connected", storeId });
      } catch (error) {
        setState({
          status: "failed",
          message: error instanceof Error ? error.message : "Connection failed",
        });
      }
    })();

    return () => orbit.destroy();
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>ERP connector</h1>

      {state.status === "connecting" && <p>Connecting…</p>}

      {state.status === "connected" && (
        <>
          <p style={{ color: "#0a7d32" }}>
            Connected. The sync runs in the background.
          </p>
          <p style={{ marginTop: 16, fontSize: 13, color: "#555" }}>
            Store id — set this as <code>ORBIT_STORE_ID</code> for the worker:
          </p>
          <code style={{ fontSize: 13 }}>{state.storeId}</code>
        </>
      )}

      {state.status === "failed" && (
        <>
          <p style={{ color: "#b3261e" }}>Could not connect: {state.message}</p>
          <p style={{ marginTop: 12, fontSize: 13, color: "#555" }}>
            Reload this page to try again. Until it succeeds the background sync
            has no credential and will not run.
          </p>
        </>
      )}
    </main>
  );
}
