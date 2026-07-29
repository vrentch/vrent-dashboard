# VRENT.ch — Shopify theme audit

**Theme:** Flow by Eight Themes, v38.0.1 (premium third-party theme)
**Scope:** SEO, functionality, structure — from theme source + live pages.
**Date:** 2026-07-29

> Because the theme is a licensed commercial theme and this repo is **public**,
> the vendor's source is **not** committed here. This report + the fixes in
> `shopify/` (all original code) are the shareable deliverables. Apply steps are
> in [`shopify/INSTALL.md`](shopify/INSTALL.md).

---

## What's already good

- **Solid `<head>`**: `preconnect` to Shopify CDN, font `preload`, critical CSS
  preloaded, `canonical`, Open Graph / Twitter tags (`social-meta-tags.liquid`),
  `theme-color`, correct `lang` per locale.
- **Internationalisation**: EN/DE/FR/IT with 70 locale files and a real-time
  multilingual sitemap.
- **robots.txt**: sensible — transactional paths blocked, sort/filter crawl
  traps handled, explicit Googlebot-Ads rules.
- **Prior custom work is clean**: ~15 `vrent-*` custom sections/snippets (trust
  banner, VR apps/tours, all-products, etc.) use proper `width/height`, lazy
  loading, and alt-text fallbacks — good habits.
- A **news blog** structure already exists (`blog.news`, `article.news`
  templates) — a natural home for curated VR/AR posts.

---

## Findings

### 🔴 High impact

| # | Finding | Status |
|---|---|---|
| 1 | **No structured data anywhere.** Zero `application/ld+json` in the entire theme → no rich results (price, availability, ratings, breadcrumbs, sitelinks search box) in Google. | ✅ **Fixed** — `snippets/vrent-structured-data.liquid` (Product, Offer, AggregateRating, BreadcrumbList, Article, Organization, WebSite). JSON validated. |

### 🟠 Medium impact

| # | Finding | Status |
|---|---|---|
| 2 | **No meta-description fallback.** `theme.liquid` prints a description only when set manually (`{% if page_description %}`), so many products/pages ship with none. | ✅ **Fixed** — `snippets/vrent-meta-description.liquid` derives one from the product/collection/article/shop when unset. |
| 3 | **Product-image alt text has no fallback** in the vendor gallery (`product-media.liquid` line ~114) and `product-cross-sell.liquid` — blank alts stay blank. | 🟡 **Fix provided** (optional vendor edit in INSTALL.md) + fill alt text in admin. |

### 🟢 Verified NOT an issue

- **"Duplicate content blocks" on the product page** (flagged by the earlier
  automated public scan) — **false positive.** The product template has 4
  distinct sections (form, reviews, description, contact), no duplicates.
- **Missing product schema on the live page** was reported by the lightweight
  reader because it can't see `<script>` JSON-LD; the real gap is #1 (there
  genuinely is none), now fixed.

---

## Recommended next (needs your go-ahead)

1. **Publish + verify the two fixes** (INSTALL.md), then run Google's Rich
   Results Test and request re-indexing in Search Console. *Fast, high ROI.*
2. **Performance pass** — audit render-blocking assets, image sizes, and
   Core Web Vitals on live pages (Flow loads Swiper, PhotoSwipe, Fancybox,
   animate.css; some may be deferrable per-template).
3. **VR/AR news** — the standalone feature in this repo (auto-updating) can be
   linked or embedded; optionally cross-post highlights to the existing
   `news` blog (now covered by Article schema).
4. **Content SEO** — per-product meta titles/descriptions and alt text in admin
   for the core rental products.

Tell me which to take next and I'll do it.
