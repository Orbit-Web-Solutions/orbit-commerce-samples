# Orbit Commerce samples

Working reference implementations for building on
[Orbit Commerce](https://orbitcommerce.net). Each sample is small, runnable,
and written to be read — the comments explain *why*, not just what.

These are teaching code, not libraries. Copy from them freely.

## Plugins

| Sample | What it shows |
| --- | --- |
| [`plugins/backend-connector`](./plugins/backend-connector) | A service whose real work happens in a background process — an ERP, WMS or accounting connector. The full token lifecycle, refresh-token rotation, webhook subscription, and a two-way sync. |

## Where to start

If you are building an integration that runs on a schedule with no user
interface of its own, read
[`plugins/backend-connector/lib/connection.ts`](./plugins/backend-connector/lib/connection.ts)
first. It is the file that answers the question everyone arrives with: *where
does my credential come from, and how do I keep it?*

## Documentation

- [Developer portal](https://developers.orbitcommerce.net)
- [Guides](https://developers.orbitcommerce.net/guides)
- [API reference](https://developers.orbitcommerce.net/api-reference)
- [Scope catalog](https://developers.orbitcommerce.net/scope-catalog)

## Licence

MIT — see [LICENSE](./LICENSE). Use these however you like.
