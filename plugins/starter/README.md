# Starter

A complete, minimal Orbit Commerce plugin. It does nothing useful on purpose —
its job is to show each fundamental once, in the smallest honest form, so you
can delete what you do not need and keep the shape.

```bash
cp .env.example .env      # set TOKEN_ENCRYPTION_KEY: openssl rand -hex 32
npm install
npm run dev               # port 3030 — creates the SQLite database on first run
```

Then register it in the partner dashboard, point its extension point at your
`/embed` URL, and install it on a store.

## What it covers

| Fundamental             | Where                                            | What is worth reading                                        |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| The install handshake   | `app/api/connect/route.ts`                       | How a plugin gets a credential at all                        |
| Keeping that credential | `lib/orbit.ts`                                   | **Start here.** Token rotation, and the bug it prevents      |
| The SDK                 | `lib/orbit.ts`, `worker/sync.ts`                 | Typed client, auto-refresh, auto-chunked writes              |
| Direct REST             | `lib/orbit-rest.ts`                              | The two calls the SDK does not cover yet                     |
| UI in the dashboard     | `app/embed/page.tsx`                             | The `postMessage` handshake, and where context comes from    |
| Per-store settings      | `lib/settings.ts`                                | Merging over defaults so adding a field is safe              |
| Your own database       | `prisma/schema.prisma`, `app/api/notes/route.ts` | CRUD scoped by store — every query, every time               |
| Inbound webhooks        | `app/api/webhooks/orbit/route.ts`                | Signature verification, fast ack, duplicate handling         |
| Subscribing             | `lib/webhooks.ts`                                | Reconciling, so a moved endpoint is corrected not duplicated |
| Billing                 | `lib/billing.ts`, `app/embed/page.tsx`           | Entitlement checked on the server, not in the page           |
| Background work         | `worker/`                                        | A separate process, iterating every connected store          |

## Pricing, and where it actually lives

The `pricing` block in `plugin.json` is a **display summary for the store
listing**. It does not create anything billable. Sellable plans and their
prices are configured on the plugin's detail page in the partner dashboard,
and that is what `orbit.billing.getPlans()` returns.

So a manifest saying `"model": "subscription"` with no plans configured shows a
price on the listing and sells nothing. The four models are `free`, `one_time`,
and `subscription` with or without `trialDays`.

Two rules for anything you charge for:

- **Decide entitlement on the server.** `lib/billing.ts` does. The page checks
  too, so the UI is right, but the page runs on the merchant's machine.
- **Request the `billing:read` scope.** Without it the status endpoint answers
  401, and code that treats an error as "not subscribed" shows a free tier to
  paying customers. Treat `unknown` as its own state — an outage must not
  silently downgrade someone.

## Two things that are easy to get wrong

**Persist the rotated refresh token.** A refresh invalidates the token it
consumed and returns a replacement. Miss it and everything works for an hour,
then the process restarts and gets a 401 it can never recover from — the
merchant has to reinstall. `lib/orbit.ts` does this in `onTokenRefreshed`;
omitting that callback is the single most expensive mistake on this platform,
and two of our own plugins shipped it.

**Scope every query by store.** One plugin serves every merchant who installs
it. There is no global state, no configured store id, and no query without a
`storeId` filter. `app/api/notes/route.ts` shows the pattern, including why
deletes use `deleteMany({ id, storeId })` rather than `delete({ id })`.

## The two processes

`app/` runs while a merchant has the plugin open. `worker/` runs on a schedule
whether or not anyone is looking. They share only the database.

Most plugins need both, and conflating them is how you end up with work that
only happens while someone is watching.

```bash
npm run worker
```

It picks up every store that has connected. Nothing to configure.

## Development notes

- **SQLite** so this runs with no infrastructure. Real plugins use Postgres —
  change the provider and URL in `prisma/schema.prisma`.
- **Webhooks need a public URL.** Set `ORBIT_WEBHOOK_URL` to a tunnel
  (`ngrok http 3030`) and the connect route subscribes for you. Leave it blank
  and the worker polls instead.
- **The dashboard embeds you over HTTPS**, so a browser will not frame a plain
  `http://` origin next to it. Same tunnel solves it.
- **Do not develop against a store that is trading.** Anything that writes
  back writes to a real shop.

## Further reading

- [Getting started](https://developers.orbitcommerce.net/guides/getting-started)
- [Authentication & tokens](https://developers.orbitcommerce.net/guides/authentication)
- [Background jobs](https://developers.orbitcommerce.net/guides/background-jobs)
- [Webhooks](https://developers.orbitcommerce.net/guides/webhooks)
- [Testing your plugin](https://developers.orbitcommerce.net/guides/testing)
