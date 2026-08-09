---
name: blanche-brand
description: Design system and brand rules for the Blanche Beauty website (blanchebeautyuk.com). Use whenever designing, redesigning, restyling, writing copy for, or reviewing the look and feel of any Blanche page, section, or component — before writing any layout, choosing any colour, or drafting any customer-facing text.
---

# Blanche Beauty — design system

Blanche Beauty is a **London beauty studio at 61 Cleveland Street, W1T 4JH** (Fitzrovia),
offering nails, lashes, brows and makeup. Prices run **£3–£115**, most treatments
**£25–£85**, deposits **£10–£50**. Currency GBP. Audience: local professionals and
residents in central London who book treatments repeatedly, not one-off tourists.

The brand sits in the **premium-but-approachable** band: a Fitzrovia studio, not a
budget high-street chain and not a five-star hotel spa. Everything below serves that.

## The one job of this website

**Get a customer from landing to a confirmed appointment in as few taps as possible.**

Every design decision is judged against that. A page that is beautiful and does not
book is a failed page. Before shipping any screen, answer: *where is the booking
action, and is it visible without scrolling?*

Secondary jobs, in order: prove quality (real work, real space), state prices plainly,
make the location and hours findable.

## Non-negotiable rules

1. **Book now is always reachable.** A persistent booking action in the header on every
   page, repeated at the end of every major section. Never bury it in a submenu.
2. **Prices are public.** Never "prices on request". This audience filters on price;
   hiding it loses the booking. Show price *and* duration together — a customer
   booking a 195-minute lash set needs to know it takes over three hours.
3. **Deposits are disclosed before checkout, not at it.** Most treatments carry a
   £25 deposit. Surprise deposits at the payment step are the single biggest
   abandonment cause in salon booking. State it on the service card.
4. **Real photography only.** No stock images of generic manicures. Photos of the
   actual studio, the actual team, and actual work done at Blanche. If a real photo
   does not exist for a section, use type and space rather than a stock substitute.
5. **Mobile is the design target.** Design the phone layout first and let desktop be
   the adaptation. Salon customers book on phones, often standing up, often one-handed.
   Tap targets ≥44px. Nothing important below a fold that requires two scrolls.
6. **One typeface family, two weights.** Restraint reads as expensive. Mixing three
   display fonts reads as a template.
7. **Never invent brand assets.** The logo exists in the Wix media library
   (live site: `28eff9_6bb55a138ef84f2f8ada2e7140a617fc~mv2.png`). Use it. Do not
   redraw, recolour, or "modernise" the mark without explicit approval.

## Layout system

- **Vertical rhythm on an 8px scale.** Section padding 64/96/128px depending on weight.
- **One idea per section.** A section states one thing and offers one action.
- **Generous whitespace is the primary luxury signal** — more than colour, more than
  type. When a section feels cheap, the fix is usually space, not decoration.
- **Max content width ~1200px**, text columns ~65 characters. Long full-bleed lines of
  body copy read as amateur.
- **Image treatment consistent across the site**: pick one corner radius and one
  aspect-ratio family and hold it everywhere.

## Colour

The palette must be confirmed against the existing logo before it is applied —
**do not assume hex values**. The structure to fill in:

| Role | Use |
|---|---|
| Ground | Page background. Warm off-white/ivory, not pure `#fff`. |
| Ink | Body and headings. Near-black with warmth, not `#000`. |
| Accent | Booking actions only. One accent, used sparingly — it must mean "act". |
| Support | Section grounds and cards. A single muted tone, low saturation. |
| Line | Hairlines and dividers at low contrast. |

Rules: the accent is reserved for the primary action. If the accent appears on a
decorative element, the booking button stops reading as the booking button. Aim for
WCAG AA (4.5:1) on all body text — an ivory-on-beige "aesthetic" that cannot be read
in daylight on a phone is a defect, not a style.

## Voice

Write **to the customer, about their experience** — not about the business.

- Good: "Book your lash lift — 60 minutes, £70, £25 deposit."
- Bad: "Blanche Beauty is proud to offer a wide range of premium beauty services."

Short sentences. No exclamation marks. No "pamper yourself", "indulge", "unleash your
inner glow" — that vocabulary is worn out and reads as filler. Name the treatment,
the time, the price. British English throughout (colour, jewellery, specialise).

## Trust signals a salon page must carry

Present on the site or it is incomplete:

- Real photos of the studio interior and of work done there
- Genuine reviews with names (Google reviews are the strongest available proof)
- The full address **61 Cleveland Street, London W1T 4JH** with a map, plus the
  nearest tube and a note on getting there — Fitzrovia customers arrive on foot or by tube
- Opening hours, stated plainly
- Phone **07831753970** as a tappable `tel:` link, and an email that actually receives
- Cancellation and deposit policy, in plain language, linked from the booking flow

## Applying this on Wix

The live site runs the **classic Wix Editor with Velo disabled**. That constrains
implementation:

- No custom React components, no Velo page code, unless Velo is deliberately enabled.
- Layout is built from Editor sections, strips and containers — design within that grid
  rather than fighting it.
- Global styling belongs in the site's theme (text themes and colour palette) so a change
  propagates. Overriding fonts and colours element-by-element is how a Wix site drifts
  into inconsistency; treat per-element overrides as a defect.
- Reusable headers/footers must be edited once, on the master, not per page.

## Before shipping any page

- [ ] Booking action visible without scrolling, on mobile
- [ ] Every service shows price, duration and deposit
- [ ] No stock photography, no placeholder text, no "Lorem ipsum"
- [ ] Address, hours and tappable phone reachable within one tap
- [ ] Body text passes 4.5:1 contrast on the real background
- [ ] Renders correctly at 375px wide
- [ ] Headings run h1 → h2 → h3 with no skipped levels, one h1 per page
- [ ] Every image has meaningful alt text
