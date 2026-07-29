# Applying the VRENT theme improvements

These are **original snippets** (not vendor code). Because your theme is the
paid **Flow** theme by Eight Themes, the store's live theme files are *not*
committed to this public repo — only these additive snippets are. You paste
them into your theme; the vendor code stays yours.

> Do this on a **duplicate** of your live theme first (Online Store → Themes →
> ⋯ → Duplicate), preview it, then publish. Nothing here touches checkout.

---

## 1. Structured data (JSON-LD) — biggest SEO win

Your theme currently outputs **no** structured data, so Google can't show
rich results (price, availability, star ratings, breadcrumbs, search box).

1. In the theme editor: **Edit code** → `Snippets` → **Add a new snippet** →
   name it `vrent-structured-data`.
2. Paste the full contents of
   [`snippets/vrent-structured-data.liquid`](snippets/vrent-structured-data.liquid).
3. Open `Layout/theme.liquid`, find this line (~line 60):

   ```liquid
   {% render 'social-meta-tags' %}
   ```

   and add directly **below** it:

   ```liquid
   {% render 'vrent-structured-data' %}
   ```

4. Save. Verify with Google's
   [Rich Results Test](https://search.google.com/test/rich-results) on a
   product URL — you should see **Product** and **Breadcrumb** detected.

*(Star ratings only appear if you have a reviews app that writes the standard
`reviews.rating` / `reviews.rating_count` product metafields — e.g. Shopify's
Product Reviews or Judge.me. The snippet shows them automatically when present.)*

---

## 2. Meta-description fallback

The stock theme only prints a `<meta name="description">` when one is set by
hand, so pages without a manual SEO description have **none**.

1. Add a new snippet `vrent-meta-description` with the contents of
   [`snippets/vrent-meta-description.liquid`](snippets/vrent-meta-description.liquid).
2. In `Layout/theme.liquid`, find (~line 56):

   ```liquid
   {% if page_description %}
     <meta name="description" content="{{ page_description | escape }}">
   {% endif %}
   ```

   and replace the whole block with:

   ```liquid
   {% render 'vrent-meta-description' %}
   ```

---

## 3. Image alt-text fallback (optional, vendor-file tweak)

The main product gallery (`snippets/product-media.liquid`) and
`snippets/product-cross-sell.liquid` output `alt` from the image's alt field
with **no fallback**, so blank alts stay blank. Two small edits:

- `product-media.liquid` line ~114:
  `alt="{{ product.media[0].alt }}"` →
  `alt="{{ product.media[0].alt | default: product.title | escape }}"`
- `product-cross-sell.liquid` line ~31:
  `alt="{{ product.featured_image.alt }}"` →
  `alt="{{ product.featured_image.alt | default: product.title | escape }}"`

Longer term, fill in real alt text per image in Shopify admin — it's better for
accessibility and image SEO than an auto-fallback.

> These edits touch vendor files, so re-apply them after a theme update.
> The cleanest long-term fix is filling alt text in the admin.
