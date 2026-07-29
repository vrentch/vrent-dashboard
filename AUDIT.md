# VRENT.ch — Full Site Audit & Action Plan

**Theme:** Flow by Eight Themes v38.0.1 (premium) + ~15 custom `vrent-*` sections.
**Method:** 6 specialised agents reviewed the theme source *and* the live site in
parallel (SEO, performance, accessibility, UX/conversion with user-persona
modelling, code quality/bugs, mobile & i18n).
**Date:** 2026-07-29

> The paid vendor theme is **not** committed to this public repo (licence + it's
> public). This report + the patches in [`PATCHES.md`](PATCHES.md) + the snippets
> in `shopify/` are the deliverables. Line numbers are from the theme export and
> may drift slightly with theme updates.

Tags: 🟥 critical · 🟧 high · 🟨 medium · ⬜ low · ✅ verified-OK
Apply-type: **[quick]** small safe edit · **[custom]** in your `vrent-*`/custom files · **[vendor]** edits a Flow file (re-apply after theme updates) · **[app]** app/admin setting · **[content]** copy/data you enter

---

## 🟥 Tier 0 — Fix first (breaks orders / trust / links)

| # | Finding | Where | Fix | Type · Effort |
|---|---------|-------|-----|------|
| 0.1 | **Wrong rental return-dates on FR/IT.** `periodDays()`/`daysFor()` parse the *translated* duration label but only match EN/DE words, so any FR/IT rental ≠ "1 week" silently books a **7-day return** — the wrong `[Return date]` is written to the order/line-item. | `sections/template--product.liquid` L16-21, L455-462 | Add FR/IT units (stopgap) or derive days from the variant option index (robust). Patch in PATCHES.md. | [custom] S |
| 0.2 | **Flagship buy button reads "Unavailable"** until a delivery date is chosen — looks out-of-stock/broken. | `sections/template--product.liquid` (Vue btn L783 + gate L575) | Relabel the gated state to "Select a delivery date →"; keep "Unavailable" only for genuine no-stock. Needs a careful JS pass (Vue-driven) — I'll produce the exact patch on implementation. | [custom] M |
| 0.3 | **Hardcoded fake "✓ In stock · ships in 24h" badge** injected on *every* product regardless of real inventory — contradicts 0.2. | `sections/template--product.liquid` L64-70 | Gate the badge on real variant availability. Patch in PATCHES.md. | [custom] S |
| 0.4 | **Dead product handle `meta-quest-3-s`** (real handle `meta-quest-3s`) — links 404 and the Featured-Headset card silently vanishes. | `vrent-all-products.liquid` L17/L472, `collection.json`, `product-explorer.liquid` L586, `vrent-use-case.liquid` ×16 | Find/replace `meta-quest-3-s` → `meta-quest-3s` (verify handle in admin). Patch in PATCHES.md. | [custom] S |
| 0.5 | Dead links `/pages/corporate-services` & handle typo `…wayfarer-trasitions`. | `vrent-vr-corner.liquid` L415, `product-explorer.liquid` L581 | Point to real pages/handles. | [custom] S |

## 🟧 Tier 1 — High ROI, low/medium effort

### SEO
| # | Finding | Where | Fix | Type · Effort |
|---|---------|-------|-----|------|
| 1.1 | **No structured data** (rich snippets: price, availability, ratings, breadcrumbs, search box). | theme-wide | ✅ **Done** — `shopify/snippets/vrent-structured-data.liquid` (now also LocalBusiness). | [quick] — |
| 1.2 | **No meta-description fallback.** | `theme.liquid` L56 | ✅ **Done** — `shopify/snippets/vrent-meta-description.liquid`. | [quick] — |
| 1.3 | **Collection pages render ZERO `<h1>`** (theme title disabled; custom section uses `<h2>`). | `vrent-all-products.liquid` L38 | `<h2 class="vap-h2">` → `<h1 class="vap-h2">`. Patch in PATCHES.md. | [custom] S |
| 1.4 | **Twitter/X cards dead** — tags use non-standard `x:` prefix, no `twitter:image`. | `social-meta-tags.liquid` L59-64 | Rename `x:*`→`twitter:*`, add `twitter:image`. Patch in PATCHES.md. | [vendor] S |
| 1.5 | **`og:image` served over `http://`.** | `social-meta-tags.liquid` L8,17,27 | Change `http:` → `https:`. Patch in PATCHES.md. | [vendor] S |
| 1.6 | **Homepage has 2 `<h1>` (one empty logo).** | `header.liquid` L746-747 | Make the index logo a `<div>` (leave hero as sole H1). | [vendor] S |
| 1.7 | **Latent double-H1** on vrent landing pages (only avoided by per-page toggles). | `template--page.liquid` L12 + vrent hero H1s | Demote hero headings to `<h2>` or hard-disable the template page title. | [custom/vendor] S |
| 1.8 | Add **LocalBusiness**, **FAQPage** (page.faq), **Service** (service pages) schema. | new snippets | LocalBusiness ✅ added to snippet; FAQ/Service = follow-up snippets. | [custom] M |
| 1.9 | Breadcrumbs missing on product/collection; no final crumb; no schema. | `theme.liquid` L173, `breadcrumb.liquid` | Enable + add final crumb + BreadcrumbList (JSON-LD already emitted by our snippet). | [vendor] M |

### Conversion (from persona modelling)
| # | Finding | Fix | Type · Effort |
|---|---------|-----|------|
| 1.10 | No **deposit / damage-cover** reassurance on the product page (only on FAQ/Membership) — anxiety peaks here. | Add one line under price: "No deposit · free damage cover · disinfected & charged". | [custom] S |
| 1.11 | **Member discount is a manual code** at checkout; members never see their price while browsing. | Auto-apply the member discount on login, or render member pricing site-wide. | [custom] M |
| 1.12 | **B2B credibility gap** — 8 logos, zero case studies/ROI/testimonials for 5-figure decisions; no volume price anchor; no insurance/data-wipe line. | Add 2-3 case studies + testimonial + trust line + indicative volume price band. | [content] M |
| 1.13 | Package builder promises "price in a minute" but needs a form submit. | Show a live estimate range before the form. | [custom] M |
| 1.14 | Customer account not membership-aware; no fast reorder. | Show tier, member code, orders-remaining, lifetime savings, "Rent again". | [custom] M |
| 1.15 | `vrent-package-builder` primary CTA has **near-black text on dark blue** (unreadable). | `.vpb-cta{…color:#1d1d20}` → `color:#fff`. Patch in PATCHES.md. | [custom] S |

## 🟨 Tier 2 — Performance (mostly upgrade-safe Liquid + app settings)

| # | Finding | Fix | Type · Effort |
|---|---------|-----|------|
| 2.1 | **Swiper/PhotoSwipe/Animate CSS load globally** + preloading an **empty `custom.css`** and 6 blocking sheets (self-defeating). | Move carousel CSS into the sections that use them (theme already does this for 33 section CSS files); drop the empty `custom.css` link; preload only 1 critical sheet. | [vendor] M |
| 2.2 | Custom **hero images have no `srcset`/`fetchpriority`/preload** → inflated mobile LCP. | Add `srcset`+`sizes`, `fetchpriority="high"` on eager hero `<img>`, preload the LCP image. (`vrent-club-landing`/`vrent-vr-corner-intro` already do it right — copy that.) | [custom] M |
| 2.3 | **Homepage loads 3 third-party app widgets** (Google Reviews, Instafeed, Judge.me) → mobile CWV drag + CLS. | Keep one review widget above the fold; lazy-mount the rest; preconnect their CDNs; reserve heights. | [app] M |
| 2.4 | **369 KB `theme.min.css` render-blocking** on every page. | Inline critical CSS + load the rest non-blocking (media-swap). | [vendor] M |
| 2.5 | **Swiper library duplicated inside four 300 KB+ component bundles**; **Vue (705 KB) loads globally.** | Vendor build issue — raise with Eight Themes (share as a single external Swiper + code-split Vue). | [vendor] L |
| 2.6 | `product-explorer` runs a **`setInterval` 12×** re-parsing product JSON & rewriting swatches → wasted CPU + CLS. | Render price chips server-side or use a MutationObserver. | [custom] M |
| 2.7 | Product-only `vrent-trust-banner.css` **preloaded on every page**. | Load it only on product templates; drop `preload`. Patch in PATCHES.md. | [vendor] S |

## 🟨 Tier 3 — Accessibility (WCAG 2.1 AA)

| # | Finding | Fix | Type · Effort |
|---|---------|-----|------|
| 3.1 | **No skip-to-content link.** | Add `<a class="sr-only sr-only-focusable" href="#MainContent">` (classes already exist). | [vendor] S |
| 3.2 | **No `<main>` landmark** around content. | Change the content wrapper `<div>` → `<main id="MainContent" tabindex="-1">`. | [vendor] S |
| 3.3 | **Contact form fields have no real labels** (`has_label:false`, `aria-labelledby` points at non-existent ids). | Render real (visually-hidden) `<label>`s; expose required state properly. | [vendor] M |
| 3.4 | Accordion trigger (FAQ/product tabs) not an accessible button (no `role`/`aria-expanded`/`aria-controls`). | Add role + toggled aria + key handling. | [vendor] M |
| 3.5 | **Contrast fails:** sale price `#919191` on white (3.15:1); overlay header white text on hero (opacity 0, no scrim). | Darken sale price ≥ `#767676`; add ≥30% overlay/scrim. | [vendor/quick] S |
| 3.6 | Carousel arrows, product thumbnails, mobile menu close = `href="#"` links, not buttons; nav/menus lack `aria-expanded`. | Convert to `<button>`; manage `aria-expanded`. | [vendor] M |

## 🟨 Tier 4 — i18n / multilingual correctness (EN/DE/FR/IT)

| # | Finding | Fix | Type · Effort |
|---|---------|-----|------|
| 4.1 | **Whole product-template UX is hardcoded English** (trust bar, calendar labels, months/weekdays, included-items) → shows English on DE/FR/IT. | Move strings to locale files; feed the JS a `T` object via `\| t`; localise dates via `request.locale.iso_code`. | [custom] M |
| 4.2 | ~30 **hardcoded `/pages/…` `/collections/…` links** in custom JS/markup drop the language prefix → visitors kicked out of their locale. | Route load-bearing links through settings / localized `routes`. | [custom] M |
| 4.3 | Currency/date not locale-aware (`money()` hardcodes `CHF`, dates forced `en-GB`). | Use Shopify money formatting + locale dates. | [custom] S |
| 4.4 | `"Popular"` label baked into CSS `content:`; other English literals in settings-driven sections. | Move to translatable JS/Liquid labels. | [custom] S |
| 4.5 | Verify each `vrent-*` section instance has **DE/FR/IT entries in Translate & Adapt** (architecture is fine; content may be missing). | Operational check in localization admin. | [content] M |

## ⬜ Tier 5 — Structural cleanup & bigger bets

| # | Finding | Fix | Effort |
|---|---------|-----|------|
| 5.1 | `product-explorer.liquid` **hardcodes a 13-product catalogue** (static prices + absolute CDN image URLs) on the homepage → drifts from real catalogue, images break on re-version. | Rebuild from live `product`/`collection` objects, or replace with `vrent-all-products`. | L |
| 5.2 | Duplicated pricing/plan logic across `vrent-package-builder` & `vrent-vr-corner` (two sources of truth). | Extract to one shared config snippet. | M |
| 5.3 | CSS class collisions in `vrent-package-builder` (`.vpb-step`, `.vpb-eyebrow` defined twice); non-scoped DOM id `vrc2` in `vrent-vr-corner` (breaks with 2 instances). | Rename/scope. | S |
| 5.4 | **New feature — VR/AR news blog** (your request). | ✅ Built: `api/publish-news.ts` auto-posts a weekly original roundup to your news blog (drafts for approval). Needs Admin API key to switch on. | — |

---

## ✅ Verified OK — no action (so you don't chase ghosts)
- **hreflang** and **canonical** tags: correct & complete across all page types (live-checked).
- **Fonts:** preloaded, `font-display:swap`, preconnects present.
- Deferred bottom-of-body JS; per-section CSS pattern; CDN immutable caching.
- Customer login/register inputs have real labels; `<html lang>` correct per locale.
- Most brand colours pass contrast (primary blue 8.3:1); 70 locale files present (theme strings fully covered).
- Image `width/height` + lazy loading via `responsive-image.liquid`.
- The **earlier "duplicate content on product page" flag was a false positive** (retracted).
- No deprecated `{% include %}`; `img_url` only in one vendor file; no stray `console.log` in custom code.

---

## Suggested order of execution
1. **Tier 0** (0.1, 0.3, 0.4, 0.5 have exact patches; 0.2 needs one careful pass) — protects orders, trust, and link equity.
2. **Tier 1 SEO quick wins** (1.3, 1.4, 1.5, 1.6, 1.15) — minutes each, direct search/UX gains; then the two snippets (done) verified in Search Console.
3. **Tier 1 conversion** (1.10, 1.11) — highest revenue leverage.
4. **Tier 2 performance** safe Liquid wins (2.1, 2.2, 2.7); raise 2.5 with Eight Themes.
5. **Tier 3 a11y** quick wins (3.1, 3.2, 3.5); **Tier 4 i18n** (4.1, 4.2).
6. **Tier 5** structural bets as capacity allows.
