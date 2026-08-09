# Selling Memory XR

Operator guide: what the product costs, why, how to demo it, and how to get it
in front of a customer.

Every price below lives in `shared/editions.ts`. Change it there and the app,
the showcase page and the in-headset upgrade prompts all follow. Nothing else
hardcodes a number.

---

## The pricing model

Memory XR is priced as **content attached to a headset rental**, not as
standalone software.

That is a deliberate choice. A customer booking an event is already committing
CHF 450–6,000 to hardware. Against that, a few hundred francs for content that
makes the event memorable is an easy yes. The same number on a standalone
software price list, next to app-store titles that cost twenty francs, reads as
absurd. Same figure, completely different conversation — so always quote it
alongside the rental, never on its own.

### Demo — included

Ships with every rental at no charge. It is the lead magnet, and the reason it
is worth giving away is that it needs nothing: no server, no signup, no wifi.
Put a headset on a stand, and any visitor gets a complete game against an AI
opponent within a minute. The ten-minute session limit exists so the headset
frees itself up for the next person without staff intervention.

### Pro — per event, sized to the package

| Hardware package | Headsets | Game licence |
| --- | --- | --- |
| Bronze | up to 4 | CHF 150 |
| Silver | up to 10 | CHF 350 |
| Gold | up to 20 | CHF 590 |
| Platinum | up to 50 | CHF 990 |

The attach rate falls from roughly a third of the hardware spend on Bronze to
about a sixth on Platinum. That is intentional: a fifty-headset booking is
already a serious commitment and should feel rewarded, not taxed. It also means
the upsell gets easier as the deal gets bigger, which is the opposite of how
per-seat software usually behaves.

**Annual, unlimited events: CHF 2,400.** Break-even is under three Silver
events. Any customer running events monthly should be on this, and it converts
a variable line item into predictable recurring revenue.

### Enterprise — from CHF 4,900 setup, CHF 1,800 per year

Their branding, their card artwork, three of their own 360 rooms shot at their
site, delivered as their own app with their own package id.

The number that matters in this conversation is the alternative. Commissioning
a bespoke branded VR game starts around CHF 10,000 and routinely runs past
CHF 50,000. This is a re-skin of a finished, tested product, so it lands at a
fraction of that and ships in days rather than months. Lead with that
comparison — it is the whole argument.

The annual fee covers hosting, the multiplayer server, updates and support. Do
not waive it; it is what keeps their build working after launch.

All figures exclude VAT.

---

## Running a demo

**On a headset (best).** Deploy the web build (below), open the URL in the
Quest Browser, tap **Enter Mixed Reality**. The board lands on the real table
in front of the customer. This is the moment that sells it — passthrough on
their own furniture, not a rendered room.

**On a laptop.** Open the same URL and click **Play on this screen**. Drag to
look around. Good for a first call or a page a prospect browses alone.

**For a stand.** Use the Demo build. It needs no network, so venue wifi cannot
embarrass you, and it resets itself between visitors.

Order of the pitch, tested against what people react to:

1. Passthrough first. The board on their real table gets the reaction.
2. Then the room code. Say a code out loud, have a colleague join from a second
   headset. Eight people around one board is the thing nobody expects.
3. Then the environments. Switch rooms live — it takes one tap and takes the
   conversation straight to "could that be *our* space?", which is the
   Enterprise sale.
4. Only then talk price, and always as a fraction of the rental.

---

## Getting it on the web

The game is a static site. Any HTTPS host works. HTTPS is not optional —
WebXR refuses to start outside a secure context, so a plain LAN address will
run the flat-screen version but never enter VR.

**GitHub Pages** — Settings → Pages → Source: "GitHub Actions", then run the
**Quest web demo** workflow. Private repositories need GitHub Pro or above.

**Vercel or Netlify** — import the repository, set the root directory to
`quest`, build command `npm run build:pro`, output directory `dist`. Both have
a free tier that covers this.

**Your own hosting** — `npm run build:pro` and upload `dist/`.

For multiplayer, deploy `server/` (Docker, Render and Fly configs are in
`server/README.md`) and set `VITE_SERVER_URL` at build time. Without it the
game still runs; it just offers solo and AI play only.

---

## Answering the three questions that always come up

**"Can we use our own space?"** Yes — that is Enterprise. Any 360 photograph
becomes a playable room. If they have a showroom, a factory floor or a venue,
that is the pitch.

**"How many people?"** Eight in one room, joining with a six-character code
read out loud. No accounts, no app install for guests.

**"Does it need wifi?"** Solo and AI play, no. Multiplayer, yes — but the
Demo build is specifically built to survive a venue with no usable network.

---

## Do not

- Quote the game price before the hardware price. It only makes sense as a
  proportion.
- Discount the Enterprise annual fee to close a deal. Discount the setup
  instead; the annual fee is what pays for the customer still working in a
  year.
- Promise a feature that is not in `shared/editions.ts`. The feature lists in
  there are what the software actually enforces, edition by edition.
