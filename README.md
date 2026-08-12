# Orbit Commerce samples

Working reference implementations for building on
[Orbit Commerce](https://orbitcommerce.net). Each sample is small, runnable,
and written to be read — the comments explain _why_, not just what.

These are teaching code, not libraries. Copy from them freely.

## Plugins

| Sample                                 | What it shows                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`plugins/starter`](./plugins/starter) | A complete, minimal plugin: the install handshake, the SDK, dashboard UI, per-store settings, CRUD against its own database, inbound webhooks, billing, and a background worker. |

## Where to start

Clone `plugins/starter`, run it, then read
[`lib/orbit.ts`](./plugins/starter/lib/orbit.ts). It is short, and it answers
the question everyone arrives with: where does my credential come from, and
how do I keep it?

Then delete what you do not need. The starter shows each fundamental once so
that removing things is easier than assembling them.

## Documentation

- [Developer portal](https://developers.orbitcommerce.net)
- [Guides](https://developers.orbitcommerce.net/guides)
- [API reference](https://developers.orbitcommerce.net/api-reference)
- [Scope catalog](https://developers.orbitcommerce.net/scope-catalog)

## Licence

MIT — see [LICENSE](./LICENSE). Use these however you like.
