# Backend connector

A reference Orbit Commerce integration for the shape people ask about most: **a
service whose real work happens in a background process rather than in a page.**
An ERP, WMS or accounting connector, a stock feed. Often a daemon, a cron job
or a Windows service. After the install, the merchant may never open it again.

Every Orbit app runs on your own infrastructure — that part is the same
whatever you build. What differs here is that the page is nearly vestigial, and
almost everything that matters happens where nobody is watching.

## The thing that surprises people

There is no API key to paste into a config file. Credentials come from an
install, and the first one arrives through a browser:

```
merchant installs the app
        │
        ▼
your page loads in their dashboard ──── receives a SHORT-LIVED session token
        │                                         (postMessage)
        ▼
your backend exchanges it ───────────── access token (1h) + refresh token (90d)
        │
        ▼
stored encrypted ────────────────────── your worker runs from here, headless,
                                        for as long as it keeps refreshing
```

So a backend integration still needs one web page, and that page needs to do
nothing but the handshake. Everything else belongs in the worker. This sample
keeps them as **two separate processes** — `app/` and `worker/` — sharing only
the token store, because that is the honest shape of the problem.

## Read these four files

| File               | Why                                                    |
| ------------------ | ------------------------------------------------------ |
| `lib/connection.ts`| The whole token lifecycle. Start here.                 |
| `lib/webhooks.ts`  | Subscribing without duplicating on every restart.      |
| `worker/sync.ts`   | One pass of a two-way sync, running with no browser.   |
| `app/embed/page.tsx` | The entire user interface: connect, report, done.    |

`lib/erp.ts` is the seam you replace — it stubs the system on your side.
`lib/orbit-auth.ts` holds the token exchange and the encryption; in our own
plugins these sit behind a shared package, and they are written out here
because a sample should not hide the two things you most need to get right.

`lib/orbit-api.ts` uses plain `fetch` rather than `@orbitcommerce/sdk`, because
the protocol is the portable part and plenty of connectors are written in
languages the SDK does not cover. Use the SDK if you are on Node; it does all
of this for you.

## The mistake this sample exists to prevent

**A refresh rotates the pair.** The refresh token you just used is dead the
moment the API answers, and the response carries its replacement. Fail to
persist that replacement and your next refresh presents a token the server
already invalidated — every call 401s, with no recovery except reinstalling.

It is a nasty failure because it is silent when caused and only surfaces an
hour later, when the access token expires. `__tests__/connection.test.ts`
asserts against it; reintroduce the bug and that test goes red.

Two corollaries worth designing around:

- **Only one process may hold a refresh token.** Two workers refreshing
  concurrently means one holds a dead one. Elect a leader rather than running
  redundant copies.
- **A 401 on refresh is terminal.** Treat it as "credential lost, tell a
  human", never as something to retry.

## Webhooks or polling

Prefer webhooks. Set `ORBIT_WEBHOOK_URL` and the connect route subscribes to
`order.created` and `order.updated` at install, skipping anything already
subscribed so restarts do not duplicate them. Subscriptions belong to the
installation and disappear when the merchant uninstalls.

Leave it unset and the worker polls instead. That is the right choice when your
service cannot accept inbound HTTPS, which is common inside a corporate
network — just know you are choosing it.

## Running it

```bash
cp .env.example .env      # set TOKEN_ENCRYPTION_KEY: openssl rand -hex 32
npm install
npm run dev               # the connect page, port 3030
```

Register the app in the partner dashboard with visibility `unlisted`, point its
extension point at your `/embed` URL, generate an install link and install it on
a store. Open the plugin once — that is the handshake.

```bash
npm run worker
```

There is nothing to configure. The worker reads whatever has connected, and
syncs each store: orders updated since that store's checkpoint go to the stub
ERP, then stock levels come back.

**One app serves every merchant who installs it**, so a store id is never
configuration. Merchants appear when they install and stop appearing when their
credential is revoked, without a deployment. Each store gets its own checkpoint,
and one store's broken credential does not stop the others.

Even a connector built for a single client is worth writing this way. It costs
one loop, and it makes the second merchant a non-event rather than a rewrite.
(`ORBIT_STORE_ID` exists purely as a development filter for working on one
store at a time.)

**Do not develop against a store that is trading.** A two-way sync under
development writes real orders into a real shop.

## Further reading

- [Backend integrations](https://developers.orbitcommerce.net/guides/backend-integrations)
- [Authentication & tokens](https://developers.orbitcommerce.net/guides/authentication)
- [Webhooks](https://developers.orbitcommerce.net/guides/webhooks)
