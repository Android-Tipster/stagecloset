# StageCloset

**The costume closet binder, computerized.** Local-first costume and prop inventory for school and community theater.

**Live app: https://android-tipster.github.io/stagecloset/**

Every drama program has the same system: a binder, a half-maintained spreadsheet, and one person who remembers where the Victorian gowns live. When that person graduates or moves on, the knowledge goes with them. After every production, pieces walk away and nobody can say who had them.

StageCloset runs entirely in your browser. No account, no subscription, nothing uploads. It works on the Chromebook in the costume loft with the WiFi down.

## What it does

- **Tagged catalog**: every piece gets a tag ID (DR-0012), category, size, era, colors, condition, location (room / rack / bin), replacement value, notes, and up to 3 photos.
- **Smart sizes**: "42R", "W32 L34", "10", "M", and "OSFA" all normalize so a search for a Large finds them.
- **Check in / check out**: who took it, when it is due back, overdue flags with days late, and a per-borrower rollup of value out the door.
- **Productions**: build a pull list with live search, track piece status (planned, pulled, fitted, returned), and record character / actor / scene per piece.
- **Pull sheets by rack** (Pro): the printout walks the storage room in physical order, tick boxes included.
- **Costume plot** (Pro): per character, in scene order, ready for the fitting binder.
- **Strike report** (Pro): after the show closes, every assigned piece not returned, with replacement values and the last name attached to it.
- **Tag labels** (Pro): print cut-out labels for any filtered set of items.
- **Spreadsheet import**: paste your existing CSV, columns are auto-detected (Item, Size, Color, Room, Value, and 40+ other header spellings).
- **Vault handover**: one file exports the whole closet, photos included. Hand it to the next wardrobe manager. This is the answer to volunteer turnover.

## Free vs Pro

| | Free | Pro ($29 one time) |
|---|---|---|
| Items | 150 | Unlimited |
| Active productions | 1 | Unlimited |
| Catalog, photos, search, check-outs | Yes | Yes |
| CSV import / export, vault backup | Yes | Yes |
| Pull sheets, costume plot, tag labels | Locked | Yes |
| Strike report with dollar values | Locked | Yes |

The Pro key validates offline and never expires. No account, no server, no subscription.

## Privacy by construction

There is no backend. State lives in `localStorage`, photos in IndexedDB, all in your browser. Student and volunteer names on checkout records never leave the machine. The only network request this app ever makes is loading itself.

## Development

Zero dependencies. The engine is plain ES modules shared between browser and Node.

```
node test/run.mjs   # 140 assertions
node build.mjs      # bundles src/ into docs/index.html (self-contained, works over file://)
```

## License

MIT for the code. The Pro key gates convenience features, not your data: everything you enter is exportable on the free plan, always.
