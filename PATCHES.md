# Ready-to-apply patches

Exact copy-paste fixes for the highest-value findings in [`AUDIT.md`](AUDIT.md).
Work on a **duplicated theme** (Online Store → Themes → ⋯ → Duplicate → Edit code),
preview, then publish. Each patch is a find → replace in the file's code editor.

> These edit theme files. `[custom]` files are your own `vrent-*` code; `[vendor]`
> files are Flow's — re-apply `[vendor]` patches after a theme update. Nothing here
> touches checkout.

---

## 0.1 — Fix wrong FR/IT rental return-dates 🟥 `[custom]`
**File:** `sections/template--product.liquid` — **two** places.

**A) In `daysFor()` (~line 16). Find:**
```js
    if ((m = v.match(/(\d+)\s*(week|woche)/))) return parseInt(m[1], 10) * 7;
    if ((m = v.match(/(\d+)\s*(month|monat)/))) return parseInt(m[1], 10) * 30;
    if ((m = v.match(/(\d+)\s*(day|tag)/))) return parseInt(m[1], 10);
```
**Replace with:**
```js
    if ((m = v.match(/(\d+)\s*(week|woche|semaine|settimana)/))) return parseInt(m[1], 10) * 7;
    if ((m = v.match(/(\d+)\s*(month|monat|mois|mese)/))) return parseInt(m[1], 10) * 30;
    if ((m = v.match(/(\d+)\s*(day|tag|jour|giorno)/))) return parseInt(m[1], 10);
```

**B) In `periodDays()` (~line 455). Find:**
```js
                            if((m = l.match(/(\d+)\s*(week|woche)/)))  return parseInt(m[1],10) * 7;
                            if((m = l.match(/(\d+)\s*(month|monat)/))) return parseInt(m[1],10) * 30;
                            if((m = l.match(/(\d+)\s*(day|tag)/)))     return parseInt(m[1],10);
```
**Replace with:**
```js
                            if((m = l.match(/(\d+)\s*(week|woche|semaine|settimana)/)))  return parseInt(m[1],10) * 7;
                            if((m = l.match(/(\d+)\s*(month|monat|mois|mese)/))) return parseInt(m[1],10) * 30;
                            if((m = l.match(/(\d+)\s*(day|tag|jour|giorno)/)))     return parseInt(m[1],10);
```
> Stopgap that fixes the bug today. The robust fix (derive the day-count from the
> variant option **index** instead of parsing translated text) is a follow-up.

---

## 0.2 — Fix the "Unavailable" buy button 🟥 `[admin]` (+ optional `[custom]`)
**Root cause (verified in code):** the button word comes from **Shopify's own**
variant state, not the date-picker. The template shows the *"Unavailable"* span
whenever the product's **currently-selected (default) variant is not available**
(`sections/template--product.liquid` L783; the initial paint shows it when
`current_variant.available` is false). The date-gate only *greys* the button via
the `.vrd-blocked` class — it never writes "Unavailable".

**So fix it in admin first (no code):**
1. Products → **Meta Quest 3** (and each rental product) → check each variant's
   **inventory**. If variants show 0 / "unavailable":
   - either set stock quantities, **or**
   - under each variant, tick **"Continue selling when out of stock"** (correct for
     rentals — availability is really governed by the delivery calendar, not stock).
2. Make sure the **default/first variant is an available** rental period, so the
   page loads reading **"Add to cart"** rather than "Unavailable".

**Optional polish (only if you also want the greyed pre-date state to say something
friendlier):** that's the `.vrd-blocked` state. Tell me if you want it and I'll add
a small, tested JS label swap — it's safe but touches the Vue-mounted button, so I'd
rather verify it live (via Theme Access) than have you paste it blind.

> Do **0.2 admin check + 0.3 together** — 0.3 stops the "In stock" badge lying while
> a variant is genuinely unavailable; 0.2 makes the variant actually available.

---

## 0.3 — Stop the fake "In stock" badge on sold-out products 🟥 `[custom]`
**File:** `sections/template--product.liquid` (~line 64). **Find:**
```js
    var gal = document.querySelector('.product-images-container');
    if (gal && !gal.querySelector('.vr-stock-badge')) {
```
**Replace with:**
```js
    var gal = document.querySelector('.product-images-container');
    var anyAvail = product.variants.some(function (v) { return v.available; });
    if (gal && anyAvail && !gal.querySelector('.vr-stock-badge')) {
```

---

## 0.4 — Fix dead `meta-quest-3-s` links 🟥 `[custom]`
**First confirm** the real handle in admin (Products → Meta Quest 3S → the URL).
It is `meta-quest-3s` (no dash before the "s"). Then in **Edit code → search**
the whole theme for `meta-quest-3-s` and replace each with `meta-quest-3s`.
Occurs in: `sections/vrent-all-products.liquid`, `templates/collection.json`,
`sections/product-explorer.liquid`, and `sections/vrent-use-case.liquid` (×16).

Also fix: `/pages/corporate-services` → `/pages/corporate-clients`
(`vrent-vr-corner.liquid`), and the `…wayfarer-trasitions` handle typo
(`product-explorer.liquid` — verify correct handle in admin).

---

## 1.3 — Give collection pages an `<h1>` 🟧 `[custom]`
**File:** `sections/vrent-all-products.liquid` (~line 38). **Find:**
```liquid
    {%- if section.settings.heading != blank -%}<h2 class="vap-h2">{{ section.settings.heading }}</h2>{%- endif -%}
```
**Replace with:**
```liquid
    {%- if section.settings.heading != blank -%}<h1 class="vap-h2">{{ section.settings.heading }}</h1>{%- endif -%}
```

---

## 1.4 — Fix broken Twitter/X cards 🟧 `[vendor]`
**File:** `snippets/social-meta-tags.liquid` (~lines 59-64). **Find:**
```liquid
{% unless settings.sm_x_link == blank %}
  <meta name="x:site" content="{{ settings.sm_x_link | split: 'x.com/' | last | prepend: '@' }}">
{% endunless %}
<meta name="x:card" content="summary_large_image">
<meta name="x:title" content="{{ og_title }}">
<meta name="x:description" content="{{ og_description }}">
```
**Replace with:**
```liquid
{% unless settings.sm_x_link == blank %}
  <meta name="twitter:site" content="{{ settings.sm_x_link | split: 'x.com/' | last | prepend: '@' }}">
{% endunless %}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{ og_title }}">
<meta name="twitter:description" content="{{ og_description }}">
{% if page_image %}<meta name="twitter:image" content="https:{{ page_image | image_url }}">{% endif %}
```

---

## 1.5 — Serve `og:image` over HTTPS 🟧 `[vendor]`
**File:** `snippets/social-meta-tags.liquid` — lines 8, 17, 27, 36. In each, change
the `http:` prefix to `https:`. Example (line 8) **Find:**
```liquid
{%- capture og_image_tags -%}<meta property="og:image" content="http:{{ page_image | image_url }}">{%- endcapture -%}
```
**Replace with:**
```liquid
{%- capture og_image_tags -%}<meta property="og:image" content="https:{{ page_image | image_url }}">{%- endcapture -%}
```
Repeat for the `media | image_url` (L17), `article.image | image_url` (L27), and
`collection.image | image_url` (L36) captures.

---

## 1.15 — Fix unreadable package-builder button 🟧 `[custom]`
**File:** `sections/vrent-package-builder.liquid` (~line 183). **Find:**
```css
  .vpb-cta{display:inline-block;background:#2846A6;color:#1d1d20;border:none;border-radius:999px;padding:12px 22px;font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;}
```
**Replace with** (only `color` changes, `#1d1d20` → `#fff`):
```css
  .vpb-cta{display:inline-block;background:#2846A6;color:#fff;border:none;border-radius:999px;padding:12px 22px;font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;}
```

---

## 2.7 — Stop preloading product-only CSS on every page 🟨 `[vendor]`
**File:** `layout/theme.liquid` (~line 18). **Find:**
```liquid
  {{ 'vrent-trust-banner.css' | asset_url | stylesheet_tag: preload: true }}
```
**Replace with:**
```liquid
  {% if template contains 'product' %}{{ 'vrent-trust-banner.css' | asset_url | stylesheet_tag }}{% endif %}
```

---

## Still to do (need a careful pass or your input — see AUDIT.md)
- **1.6 / 1.7** duplicate/empty H1 cleanup
- **1.8** FAQ + Service schema snippets (LocalBusiness already added)
- **1.10–1.14** conversion changes (deposit line, member pricing, B2B proof)
- **Tier 2** performance, **Tier 3** a11y, **Tier 4** i18n, **Tier 5** structural
