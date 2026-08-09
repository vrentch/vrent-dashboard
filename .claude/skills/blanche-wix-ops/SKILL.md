---
name: blanche-wix-ops
description: Safe operating procedure and hard facts for working on the Blanche Beauty Wix sites — site IDs, what data lives where, which API calls are proven to work, and the rules that stop a change from destroying live customer data or connectivity. Use before ANY read or write against a Blanche Wix site.
---

# Blanche Wix — operating procedure

## The two sites (never confuse them)

| | **Blanche** — THE LIVE SITE | **Blanchebeauty** — the old site |
|---|---|---|
| `siteId` | `29edc430-baa6-440a-b35c-9c90957e5be1` | `264e1ed7-0215-451b-8bdd-b8968486a2ae` |
| URL | https://www.blanchebeautyuk.com/ | https://hello90650.wixsite.com/blanchebeauty |
| Plan | Premium + custom domain | Free |
| Editor | Classic Editor | Classic Editor |
| Velo | **Disabled** | Enabled |
| Created | Jan 2025 | Jun 2022 |

**All work happens on the LIVE site** (`29edc430…`) unless explicitly told otherwise.
The old site is a **read-only source of truth for data and content** — treat it as an
archive to migrate *from*, never a place to publish *to*.

## Where the business's data actually lives (measured 2026-08-09)

| Data | Live site | Old site |
|---|---|---|
| CRM contacts | **10** | **302** ← the real customer list |
| Site members | 5 | 13 |
| Booking services | **0** | **39** (full catalogue, £3–£115) |
| Future bookings | 0 | **0** (verified — nothing stranded) |
| Events | 1 (ended, sold out) | — |

The consequence: **the customer database and the entire service catalogue are on the
old free site, not the live one.** Any plan that abandons the old site without
migrating those first destroys 302 customer records.

## Standing decisions from the owner (2026-08-09)

These are settled. Do not reopen them or design around alternatives.

1. **Phorest owns all bookings.** Wix Bookings is NOT to be installed on the live site.
   The website's job is to route customers into Phorest cleanly.
2. **Phorest owns all client records.** Wix contacts are not the system of record.
3. **Site members have their own accounts in Phorest.** Wix Members is not the identity
   system.
4. **Nothing is deleted or moved without explicit per-item approval** — not the old
   site, not the 302 contacts, not anything else. The old site stays published for now.
5. The contact email `hello@blanchebeauty.co.uk` is **correct as written**. (It still
   carries `deliverabilityStatus: BOUNCED` on the live site's own contact record, which
   is a mail-delivery matter, not a typo — worth checking, not worth "fixing" in Wix.)

## Live-site state

Fixed on 2026-08-09, verified via `GET /site-properties/v4/properties` (version 29):

- `timeZone` = **`Europe/London`** ✅ — was `Europe/Kyiv`. Corrected by updating the
  default location record, which is what actually drives it.
- `address` = **61 Cleveland Street, London, W1T 4JH** ✅ (51.5206123, -0.1390749)
- `phone` = **07831753970** ✅

Still outstanding:

- `businessSchedule` = **absent** — opening hours are set on neither site, and the
  owner has not yet supplied them. Do not invent salon hours.
- Default location is still named **"Location 1"** — a template leftover.
- No booking route to Phorest exists on the site yet.

## Rules

1. **Read before you write. Always.** Fetch the current value of anything you are about
   to change, and keep it in the session so it can be restored.
2. **Never call a write endpoint without explicit, specific approval** for that change.
   "Approved the plan" is not approval for every call in it.
3. **Overwrite semantics are the main hazard.** Several Wix endpoints replace whole
   objects rather than patching — `Update Business Schedule` overwrites the entire
   schedule array; `Update Location` fully overrides a location. Read the current value,
   modify it, send it back whole.
4. **Locations cannot be deleted, only archived, and archiving is permanent.** Never
   archive without written approval.
5. **Do not uninstall apps.** Uninstalling a Wix app can take its data with it.
   Installed on live: Instagram Feed, Promote SEO, Wix Events & Tickets, Wix Invoices,
   Wix Members Area.
6. **Migrate before you delete.** The old site stays published and untouched until the
   contacts and services are confirmed present on the live site.
7. **One calendar owns bookings.** Running Wix Bookings and Phorest simultaneously
   creates two calendars that do not talk to each other, and double-bookings follow.
   Decide which system owns availability before installing anything.

## Proven-working API calls

Route everything through `mcp__Wix__CallWixSiteAPI` with the target `siteId`.
Discover endpoints with `mcp__Wix__SearchWixRESTDocumentation` — **never guess a URL**.

```
GET  https://www.wixapis.com/site-properties/v4/properties
GET  https://www.wixapis.com/contacts/v4/contacts?paging.limit=1        → pagingMetadata.total
GET  https://www.wixapis.com/members/v1/members?paging.limit=1          → metadata.total
POST https://www.wixapis.com/bookings/v2/services/count          {"query":{}}
POST https://www.wixapis.com/bookings/v2/services/query          {"query":{"paging":{"limit":13,"offset":0}}}
POST https://www.wixapis.com/bookings/bookings-reader/v2/extended-bookings/count
                                                                 {"filter":{"startDate":{"$gte":"<ISO>"}}}
POST https://www.wixapis.com/events/v3/events/query              {"query":{"paging":{"limit":20}}}
```

**Paging note:** `services/query` responses are large. A limit above ~13 exceeds the
tool's output cap and gets spilled to a file. Page at 13 and merge, deduping by
service `id`.

## Proven-working writes

```
POST https://www.wixapis.com/site-properties/v4/properties/business-contact
     {"businessContact": {...}, "fields": {"paths": ["phone","address"]}}
```
`fields.paths` is a fieldmask — only the listed paths change. Always set it as narrowly
as possible; it is the main safety rail on this endpoint.

```
PUT  https://www.wixapis.com/locations/v1/locations/{id}
     {"location": { ...entire object..., "revision": "<current>" }}
```
**Full override, no partial update.** GET the location first, change one field, send the
whole object back with its current `revision`. The site `timeZone` lives here — editing
site properties alone does not move it.

The live site's default location is `02fe6f44-4107-4ac2-a598-921378eab0e7`.

## Getting code onto the site without Velo

The **Custom Embeds API** injects HTML/JS into `HEAD`, `BODY_START` or `BODY_END`
without Velo and without opening the Editor:

```
GET  https://www.wixapis.com/embeds/v1/custom-embeds     (list — was empty as of 2026-08-09)
POST .../custom-embeds                                   (create)
PATCH .../custom-embeds/{id}                             (update — needs id + revision)
```

Embeds are categorised `ESSENTIAL` / `FUNCTIONAL` / `ANALYTICS` / `ADVERTISING`, which
controls whether cookie consent gates them. A booking widget that must always work is
`ESSENTIAL`; get this wrong and the widget silently fails to load for visitors who
decline cookies.

**This is the route for a Phorest script or floating booking widget.**

## What the API cannot do

There is no public Wix API that edits page layout on a classic Editor site. You cannot
add a section, place a button, or drop an inline iframe into the middle of a page
through REST. Those changes require the Wix Editor UI.

So any work of the form "put a Book Now button in the header" or "add a booking section
to the homepage" must be **specified here and executed by a human in the Editor**. Write
the spec precisely — exact text, exact link, exact placement — rather than pretending
it can be automated.

## Environment limitation

This session's network policy **blocks all general web egress**. `blanchebeautyuk.com`,
`wixsite.com`, `phorest.com` and every other public host return `EGRESS_BLOCKED` through
both WebFetch and curl.

Therefore: **the rendered site cannot be inspected from here.** Anything requiring the
live pages — visual QA, crawling, link checking, Phorest documentation research — must
either be done by a human with a browser, or unblocked by allowlisting those domains in
the environment's network settings. Do not report a visual finding you could not observe;
say it is unverifiable from this environment.

## Rollback

Wix keeps **site history** in the Editor (Site → History), which is the practical undo
for layout and content changes. Data changes made through the REST API are **not**
covered by it. Before any bulk data write, export or record the current values first.
