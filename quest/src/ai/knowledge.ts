/**
 * The offline knowledge base.
 *
 * This is the assistant when there is no wifi, which at a trade show is most of
 * the time. It has to be good enough to stand in front of a paying customer on
 * its own, so it covers the whole product rather than a handful of FAQs, and it
 * says "I do not have that one" instead of inventing an answer.
 *
 * Retrieval is a scored keyword match, not a search engine: questions are
 * normalised, lightly stemmed and canonicalised through a synonym table, then
 * matched against each entry's title, keywords and body, with title hits
 * weighted highest. Multi-intent questions ("how do I host and add a bot?") are
 * split on their connectives and answered as two paragraphs.
 *
 * Everything here is data plus twenty lines of scoring. It adds no
 * dependencies, costs nothing at runtime and cannot fail on a stand.
 */

import { EDITIONS, allowsEnvironment } from "../../shared/editions.ts";
import { ENVIRONMENTS } from "../../shared/environments.ts";
import { BOARD_PRESETS, GAME_MODES } from "../../shared/game.ts";
import { brand } from "../../shared/brand.ts";
import type { AssistantContext } from "../contracts.ts";
import { AI_PROFILES } from "./opponent.ts";

// ── Shape ───────────────────────────────────────────────────────────────────

export type AnswerBody = string | ((ctx: AssistantContext) => string);

export interface KnowledgeEntry {
  id: string;
  /** Also the strongest matching signal, so it is worded the way people ask. */
  title: string;
  /** Search terms and their synonyms. Order does not matter. */
  keywords: readonly string[];
  /** The answer. A function when it depends on the edition or the settings. */
  body: AnswerBody;
  /** Extra text folded into the index but never shown. */
  search?: string;
  /** Follow-up chips offered under the answer. */
  followUps?: readonly string[];
  /** UI region to highlight while the answer is up. */
  highlight?: string;
  /** Screens this entry is especially relevant to. Small scoring nudge. */
  screens?: readonly string[];
}

export interface ScoredEntry {
  entry: KnowledgeEntry;
  score: number;
}

export interface OfflineAnswer {
  text: string;
  suggestions: string[];
  highlight?: string;
  /** False when nothing matched and the honest fallback was returned. */
  matched: boolean;
}

// ── Small copy helpers ──────────────────────────────────────────────────────

const site = brand.website.replace(/^https?:\/\//, "");

function list(items: readonly string[], joiner = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

// ── The knowledge base ──────────────────────────────────────────────────────

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  {
    id: "how-to-play",
    title: "How to play",
    keywords: ["play", "rule", "start", "basic", "memory", "pair", "card", "flip", "turn", "match", "beginner"],
    screens: ["home", "game", "lobby"],
    body:
      "Turn over two cards. If they match you keep the pair and go again; if they do not, both turn back over and play passes on. " +
      "The round ends when every pair has been found, and the highest score wins.\n\n" +
      "Point at a card and pull the trigger, or pinch if you are using your hands. That is the whole game — the difficulty is entirely in remembering where things were.",
    followUps: ["How does scoring work?", "What are the game modes?", "How do I add an AI opponent?"],
  },
  {
    id: "solo-game",
    title: "Starting a solo game",
    keywords: ["solo", "alone", "single", "myself", "practice", "quick", "start", "begin", "own"],
    screens: ["home"],
    body:
      "Play, then Solo. Choose a card count and an environment, add an AI opponent if you want someone to beat, and start.\n\n" +
      "No code, no account and no connection needed. This is the mode to leave running on a stand.",
    followUps: ["How do I add an AI opponent?", "How many cards should I use?"],
    highlight: "menu-solo",
  },
  {
    id: "scoring",
    title: "Scoring and streaks",
    keywords: ["score", "scoring", "point", "streak", "win", "accuracy", "stat", "result", "bonus", "combo"],
    screens: ["game", "results"],
    body:
      "A pair is worth one point. A second pair in the same turn is worth two, a third is worth three, and so on. The run resets the moment you miss, so one good streak usually decides the game.\n\n" +
      "Accuracy on the results screen is pairs found divided by turns taken. It is the honest number: a lucky first flip barely moves it, a remembered pair does.",
    followUps: ["What are the game modes?", "How does the leaderboard work?"],
  },
  {
    id: "game-modes",
    title: "Game modes",
    keywords: ["mode", "classic", "time", "attack", "sudden", "death", "timed", "race", "variant", "rule"],
    screens: ["lobby", "home"],
    body: () =>
      "Three ways to play, chosen in the lobby before the round starts:\n\n" +
      GAME_MODES.map((m) => `${m.name} — ${m.blurb}`).join("\n") +
      "\n\nEveryone in the room plays the same mode. You can change it between rounds without leaving the room.",
    followUps: ["How does scoring work?", "Can I put a clock on each turn?"],
    highlight: "lobby-mode",
  },
  {
    id: "turn-timer",
    title: "Turn timer and peek time",
    keywords: ["timer", "clock", "second", "slow", "fast", "peek", "deadline", "wait", "pace", "long", "queue"],
    screens: ["lobby", "settings"],
    body:
      "By default there is no clock on a turn. Set a turn timer in the lobby and a ring appears around the board for whoever is up; run out of time and the turn passes. It is worth using when there is a queue behind the headset.\n\n" +
      "Peek time is how long a mismatched pair stays face-up before it flips back. The default is a little over a second. Longer is kinder to new players, shorter makes the game considerably harder.",
    followUps: ["How many cards should I use?", "What are the game modes?"],
  },
  {
    id: "mixed-reality",
    title: "Mixed reality",
    keywords: ["mixed", "reality", "passthrough", "mr", "ar", "real", "room", "table", "see", "through", "colour", "color", "vr"],
    screens: ["home", "settings", "environments", "game"],
    body:
      "Mixed reality puts the board in the room you are actually sitting in. The headset's colour cameras show your table, your walls and the people next to you, and the cards sit on the real surface in front of you.\n\n" +
      "It is the same game underneath — same rules, same multiplayer, same leaderboard. Only the backdrop changes. It is also the demo that sells the product, so it is worth leading with.",
    followUps: ["How do I switch to mixed reality?", "Passthrough is black"],
  },
  {
    id: "switch-mixed-reality",
    title: "Switch to mixed reality",
    keywords: ["switch", "turn", "enable", "on", "off", "passthrough", "mixed", "reality", "change", "toggle", "your", "room", "ar", "mr"],
    screens: ["settings", "environments", "game", "lobby"],
    body:
      "Open Environment and choose Your Room. The virtual scene fades out and your room fades in over about half a second.\n\n" +
      "You can switch at any point, including mid-game. The board stays exactly where it is and nobody loses their turn. To go back, pick any other environment.",
    followUps: ["Passthrough is black", "What environments are there?"],
    highlight: "environment-picker",
  },
  {
    id: "environments",
    title: "Choosing an environment",
    keywords: ["environment", "world", "scene", "background", "backdrop", "skybox", "place", "setting", "look", "theme", "choose", "change"],
    screens: ["settings", "environments", "lobby"],
    body: (ctx) => {
      const allowed = ENVIRONMENTS.filter((e) => allowsEnvironment(ctx.edition, e.id));
      const scenes = allowed.filter((e) => e.kind === "procedural").map((e) => e.name);
      const photos = allowed.filter((e) => e.kind === "panorama").map((e) => e.name);
      const room = allowed.some((e) => e.kind === "passthrough");
      const lines: string[] = [];
      if (scenes.length > 0) lines.push(`Built scenes: ${list(scenes)}. These are drawn by the headset, so they cost nothing to load and never pixelate.`);
      if (photos.length > 0) lines.push(`360 photographs: ${list(photos)}. Real places, wrapped around you.`);
      if (room) lines.push("Your Room: mixed reality, with the board on your real table.");
      return (
        "Open Environment and pick one. It changes immediately, mid-game included, and the board does not move.\n\n" +
        lines.join("\n") +
        (ctx.edition.features.onlineMultiplayer
          ? "\n\nIn a room game the host chooses, and everyone sees the same place."
          : "")
      );
    },
    followUps: ["How do I switch to mixed reality?", "Can I use my own 360 photos?"],
    highlight: "environment-picker",
  },
  {
    id: "custom-360",
    title: "Using your own 360 photos",
    keywords: ["360", "panorama", "own", "upload", "custom", "photo", "image", "equirectangular", "photosphere", "import", "add", "picture", "space"],
    screens: ["settings", "environments"],
    body: (ctx) => {
      const base =
        "Settings, Environments, Add 360. Pick an equirectangular JPG or PNG — the flat 2:1 image any 360 camera produces — give it a name, and it appears in the picker beside the built-in scenes.\n\n" +
        "It is stored on the headset, so it survives a restart and needs no connection. 4096 by 2048 or larger holds up well; below that the horizon goes soft.";
      if (ctx.edition.features.custom360) return base;
      return (
        `Your own 360 photography becomes a playable room — your showroom, your office, a site you have shot. That is an Enterprise feature, and this build is ${ctx.edition.name}.\n\n` +
        `On an Enterprise build it works like this. ${base}\n\n` +
        `To have it enabled, write to ${brand.contactEmail}.`
      );
    },
    followUps: ["What is in each edition?", "How do I get a custom build?"],
  },
  {
    id: "board-size",
    title: "How many cards",
    keywords: ["card", "count", "many", "size", "board", "pair", "big", "small", "grid", "difficulty", "hard", "easy", "long"],
    screens: ["lobby", "settings", "home"],
    body: (ctx) => {
      const max = ctx.edition.features.maxPairs;
      const usable = BOARD_PRESETS.filter((p) => p.pairs <= max);
      const smallest = usable[0];
      const largest = usable[usable.length - 1];

      // Only ever describe sizes this build can actually select.
      const notes = ["12 cards is a 30-second round and the right size for a queue."];
      if (max >= 10) notes.push("20 is the everyday game.");
      if (max >= 18) notes.push("36 and up is a long, genuinely hard match and is better with two or more players sharing the board.");
      else notes.push(`${largest.label} is the longest match this build offers.`);

      return (
        `Board sizes run from ${smallest.label} to ${largest.label} on this build, set in the lobby.\n\n` +
        `${notes.join(" ")}\n\n` +
        "Every layout is wider than it is tall on purpose: turning your head sideways is comfortable, tipping it up and down is not."
      );
    },
    followUps: ["What are the game modes?", "How do I add an AI opponent?"],
    highlight: "lobby-size",
  },
  {
    id: "host-room",
    title: "Hosting a room",
    keywords: ["host", "create", "room", "code", "invite", "friend", "multiplayer", "together", "share", "start", "online", "lobby", "people"],
    screens: ["home", "lobby", "host"],
    body: (ctx) => {
      if (!ctx.edition.features.onlineMultiplayer) {
        return (
          `${ctx.edition.name} is a single-headset build, so there are no room codes in it. You can still add AI opponents and play a full game.\n\n` +
          `Rooms of up to ${EDITIONS.pro.features.maxPlayers} players come with the full edition. ${brand.contactEmail} will sort that out.`
        );
      }
      return (
        `Play, then Host. Set the mode, the card count and the environment, and the room opens with a six-character code above the board. Up to ${ctx.edition.features.maxPlayers} players including you.\n\n` +
        "Read the code out or hold it up. It contains no vowels and no O, 0, I, 1 or L, so there is nothing to mishear and nothing awkward to read across a room.\n\n" +
        "Press Start when everyone is in. The settings lock for the round and unlock again at the results screen."
      );
    },
    followUps: ["How do I join with a code?", "Someone cannot join my room"],
    highlight: "lobby-code",
  },
  {
    id: "join-room",
    title: "Joining with a code",
    keywords: ["join", "code", "enter", "connect", "friend", "someone", "room", "type", "keyboard", "six", "invite", "online"],
    screens: ["home", "join"],
    body:
      "Play, then Join, then type the six characters on the floating keyboard. Case does not matter, and the field quietly ignores anything that is not part of the code alphabet.\n\n" +
      "You land in the lobby with everyone else. If the host has already started, you wait out the current board and come in on the next round rather than joining half a game.",
    followUps: ["A code will not join", "How do I host a room?"],
    highlight: "join-code",
  },
  {
    id: "ai-opponents",
    title: "AI opponents",
    keywords: ["ai", "bot", "computer", "cpu", "opponent", "robot", "add", "level", "difficulty", "easy", "medium", "expert", "machine", "against"],
    screens: ["lobby", "home"],
    body: (ctx) => {
      const levels = ctx.edition.features.aiLevels.map((l) => AI_PROFILES[l]);
      return (
        "In the lobby, tap an empty seat and choose Add AI. Add more than one if you want a crowded board.\n\n" +
        levels.map((p) => `${p.name} — ${p.blurb}`).join("\n") +
        "\n\nThey pause before each card because they are meant to feel like someone thinking, not a script. All three are beatable. Expert will punish a careless turn but still slips now and then, which is deliberate."
      );
    },
    followUps: ["How does scoring work?", "How many cards should I use?"],
    highlight: "lobby-seats",
  },
  {
    id: "leaderboard",
    title: "The leaderboard",
    keywords: ["leaderboard", "score", "table", "rank", "ranking", "best", "high", "top", "record", "history", "today", "global"],
    screens: ["results", "leaderboard", "home"],
    body: (ctx) =>
      "Every finished game posts a row: name, score, card count, mode and accuracy. Room is this session, Today resets at midnight, and Global is all time.\n\n" +
      (ctx.edition.features.globalLeaderboard
        ? "Scores sync to the server, so the board is shared across every headset on your account and survives a restart."
        : "This build keeps the board on the headset. It survives a restart but does not sync between headsets — the shared leaderboard comes with the full edition."),
    followUps: ["How does scoring work?", "What is in each edition?"],
    highlight: "leaderboard-panel",
  },
  {
    id: "editions",
    title: "The three editions",
    keywords: ["edition", "version", "demo", "pro", "enterprise", "difference", "tier", "plan", "include", "feature", "compare", "which"],
    screens: ["home", "settings", "store"],
    body: (ctx) =>
      `You are running ${ctx.edition.name}.\n\n` +
      (["demo", "pro", "enterprise"] as const)
        .map((id) => {
          const spec = EDITIONS[id];
          return `${spec.name} — ${spec.tagline}\n${spec.sellingPoints.map((p) => `  ${p}`).join("\n")}`;
        })
        .join("\n\n") +
      `\n\nMoving between them is a new build, not an in-app purchase, so nothing on the headset has to be unlocked. ${brand.contactEmail} for a quote.`,
    followUps: ["How do I get a custom build?", "Can I use my own 360 photos?"],
  },
  {
    id: "hands-controllers",
    title: "Hands or controllers",
    keywords: ["hand", "controller", "track", "pinch", "gesture", "finger", "trigger", "point", "input", "grip", "touch", "haptic", "select"],
    screens: ["home", "game", "settings"],
    body:
      "Both work, and you can swap mid-game — put a controller down and your hands take over within about a second.\n\n" +
      "With a controller, point and pull the trigger; you get a short buzz on a match, which hands cannot do. With hand tracking, point and pinch index finger to thumb.\n\n" +
      "For a long session most people prefer controllers. For a queue at a stand, hands are faster: nothing to hand over, nothing to clean and nothing to drop.",
    followUps: ["How do I recentre the board?", "How do I play?"],
  },
  {
    id: "recentre",
    title: "Recentring the board",
    keywords: ["recentre", "recenter", "center", "centre", "move", "position", "reposition", "far", "away", "behind", "reach", "drift", "align", "front", "height"],
    screens: ["game", "settings", "pause"],
    body:
      "Use Recentre in the pause menu to bring the board to you: look at the spot you want it, then confirm. The board and the panels come with you. Holding the Meta button recentres the whole headset view instead, which also works.\n\n" +
      "In mixed reality the board settles at table height in front of you. If you stand up or change seat, recentre rather than leaning.",
    followUps: ["Hands or controllers?", "How do I switch to mixed reality?"],
    highlight: "pause-recentre",
  },
  {
    id: "emotes",
    title: "Reacting to other players",
    keywords: ["emote", "react", "reaction", "chat", "talk", "message", "wave", "communicate", "say", "voice"],
    screens: ["game", "lobby"],
    body:
      "There is no text chat. Typing in a headset is miserable and it is the first thing an operator has to police, so instead there are five reactions on the wrist menu: wave, nice, thinking, ha and good game. They appear over your seat for a couple of seconds.\n\n" +
      "If everyone is in the same physical room, talking works better than any of this.",
    followUps: ["How do I host a room?", "How do I play?"],
  },
  {
    id: "comfort",
    title: "Comfort and seated play",
    keywords: ["comfort", "sick", "nausea", "seated", "sit", "stand", "dizzy", "motion", "neck", "accessible", "child", "age"],
    screens: ["home", "settings"],
    body:
      "The game never moves you. There is no locomotion, no teleport and no camera motion of any kind, which is why almost nobody feels unwell playing it — it is a good first VR experience for someone nervous about that.\n\n" +
      "It is built for a seated player. Nothing requires you to reach or stand, and every board is wider than it is tall to keep your neck out of it.",
    followUps: ["How do I recentre the board?", "What hardware do I need?"],
  },
  {
    id: "offline",
    title: "Playing without wifi",
    keywords: ["offline", "wifi", "internet", "network", "connection", "signal", "download", "local", "standalone", "airplane"],
    screens: ["home", "settings"],
    body:
      "A solo game against the AI needs no connection at all. The app, the environments, the AI and this assistant are all on the headset.\n\n" +
      "You only need a network for room codes, the shared leaderboard, and free-form answers from the online assistant. On a stand with unreliable wifi, run a solo game against AI opponents and there is nothing left that can fail.",
    followUps: ["Lost connection mid-game", "How do I add an AI opponent?"],
  },
  {
    id: "hardware",
    title: "What hardware you need",
    keywords: ["hardware", "headset", "quest", "device", "require", "support", "pc", "phone", "install", "spec", "compatible", "2", "3"],
    screens: ["home", "store"],
    body:
      "A Meta Quest 3 or Quest 3S. Colour passthrough is what makes the mixed-reality mode worth having, so Quest 2 is not supported.\n\n" +
      "One headset per player. No PC, no phone app, no base stations and nothing to install in the room.",
    followUps: ["What is in each edition?", "How do I get a custom build?"],
  },
  {
    id: "session-limit",
    title: "Session length on a stand",
    keywords: ["session", "limit", "kiosk", "timeout", "auto", "return", "idle", "stand", "booth", "visitor", "minute", "expire"],
    screens: ["home", "settings"],
    body: (ctx) => {
      const sec = ctx.edition.features.sessionLimitSec;
      if (sec > 0) {
        return (
          `This build returns to the lobby after ${Math.round(sec / 60)} minutes so the next visitor is not waiting on someone who has wandered off. The current round always finishes first.\n\n` +
          "The full edition has no session limit."
        );
      }
      return "There is no session limit on this build — a game runs until it is finished or someone leaves. Demo builds return to the lobby after ten minutes, which is what you want on an unattended stand.";
    },
    followUps: ["What is in each edition?", "How do I get a custom build?"],
  },
  {
    id: "white-label",
    title: "Your branding",
    keywords: ["brand", "branding", "logo", "colour", "color", "palette", "white", "label", "skin", "rebrand", "corporate", "identity", "customise", "customize"],
    screens: ["settings", "store"],
    body: (ctx) =>
      "An Enterprise build carries your identity: your logo on the entry screen and in the headset, your palette across every panel and card, your artwork on the card faces, and your own package name so it sits in the store under your name.\n\n" +
      (ctx.edition.features.whiteLabel
        ? "On this build you can change the logo and palette yourself from Settings, Branding."
        : `It is one palette file and one set of assets rather than a fork, which is why a rebrand is usually a couple of weeks. ${brand.contactEmail} for a quote.`),
    followUps: ["How do I get a custom build?", "Can I use my own 360 photos?"],
  },
  {
    id: "privacy",
    title: "What the app stores",
    keywords: ["privacy", "data", "store", "gdpr", "record", "camera", "capture", "personal", "account", "track", "send", "secure"],
    screens: ["settings", "home"],
    body:
      "A display name, your scores and your settings. Nothing else leaves the headset.\n\n" +
      "There is no voice recording, no camera capture and no room scan sent anywhere — passthrough is rendered on the headset and never transmitted. If you ask this assistant a question while the online model is enabled, the question text and a short summary of the screen you are on are sent to answer it, and nothing else.",
    followUps: ["Playing without wifi", "What is in each edition?"],
  },
  {
    id: "trouble-passthrough",
    title: "Passthrough is black or missing",
    keywords: ["black", "blank", "grey", "gray", "dark", "passthrough", "problem", "broken", "work", "nothing", "missing", "permission", "fail", "blocked", "cannot"],
    screens: ["settings", "environments", "game"],
    body:
      "Three things, in order:\n\n" +
      "Permission. Meta Settings, Privacy, Device permissions — the app needs permission to use passthrough. A denied prompt is by far the most common cause.\n" +
      "Light. The cameras need real light. In a dim room the view goes grey or black, and a spotlit stand with a dark background is worse than it looks.\n" +
      "The lenses. Check nothing is covering the front of the headset and that it is clean.\n\n" +
      "If it is still black, leave the environment and pick it again — that rebuilds the layer. A headset restart clears anything left.",
    followUps: ["How do I switch to mixed reality?", "What hardware do I need?"],
  },
  {
    id: "trouble-join",
    title: "A code will not join",
    keywords: ["cannot", "cant", "join", "code", "invalid", "wrong", "reject", "full", "fail", "problem", "not", "found", "expired", "error"],
    screens: ["join", "lobby"],
    body: (ctx) =>
      "Check the room is still open. It stops accepting players once the host presses Start, and closes when the host leaves.\n\n" +
      "Check both headsets are online. The code is looked up on our server, so joining needs a connection even though playing barely uses one.\n\n" +
      "Retype rather than correct. The keyboard drops characters that are not in the code alphabet, so a mistyped O or I never appears and the code silently ends up short.\n\n" +
      `Check the room is not full — ${ctx.edition.features.maxPlayers} players including the host.`,
    followUps: ["Lost connection mid-game", "How do I host a room?"],
  },
  {
    id: "trouble-connection",
    title: "Lost connection mid-game",
    keywords: ["disconnect", "drop", "lost", "connection", "reconnect", "lag", "freeze", "frozen", "kick", "offline", "red", "problem", "stuck", "cannot"],
    screens: ["game", "lobby"],
    body:
      "It reconnects on its own and puts you back in the same seat with your score intact. Give it about ten seconds. Your turn is skipped rather than stalling the room and comes back round to you.\n\n" +
      "If the connection pip stays red, leave and re-join with the same code. If the host is the one who dropped, the room ends and everyone returns to the lobby.\n\n" +
      "Conference wifi is almost always the cause. A phone hotspot is usually steadier than a hall's shared network.",
    followUps: ["A code will not join", "Playing without wifi"],
  },
  {
    id: "buy-custom",
    title: "Getting a custom build",
    keywords: ["buy", "price", "cost", "quote", "purchase", "licence", "license", "custom", "contact", "sale", "order", "commission", "bespoke", "hire", "talk"],
    screens: ["home", "store", "results"],
    body:
      `We rebuild the app around a client: your branding throughout, your card artwork, your own 360 spaces, your package name on the store, and any rule change the room needs.\n\n` +
      `Write to ${brand.contactEmail} with what it is for and roughly how many headsets. You will get a fixed quote and a date. A straightforward rebrand is usually a couple of weeks.\n\n` +
      `There is more at ${site}.`,
    followUps: ["What is in each edition?", "Your branding"],
    highlight: "contact-card",
  },
  {
    id: "assistant",
    title: "What I can help with",
    keywords: ["help", "assistant", "ask", "question", "support", "guide", "tour", "voice", "speak"],
    screens: ["home", "help", "settings"],
    body: (ctx) =>
      "Ask me about anything in the app: the rules, mixed reality, environments, room codes, AI opponents, the leaderboard, the editions, hand tracking, or anything that is not behaving.\n\n" +
      "I work offline, so the answer on a stand with no wifi is the same as the answer at a desk." +
      (ctx.edition.features.assistantLiveModel
        ? " With a connection I can also take questions outside that list."
        : "") +
      "\n\nSpeak or type — both work. There is also a short guided tour on the help panel.",
    followUps: ["How do I play?", "How do I switch to mixed reality?"],
  },
];

// ── Guided tour ─────────────────────────────────────────────────────────────

export const TOUR_STEPS: readonly { title: string; body: string; highlight?: string }[] = [
  {
    title: "Two cards a turn",
    body: "Turn over two cards. A match is yours and you go again. A miss passes play on. Most pairs wins.",
    highlight: "board",
  },
  {
    title: "Point and pinch",
    body: "Point at a card and pull the trigger, or pinch index finger to thumb if you are using your hands. Both work, and you can swap at any time.",
    highlight: "pointer",
  },
  {
    title: "Pick your room",
    body: "Environment changes where you are playing. Choose Your Room and the board lands on your real table in mixed reality.",
    highlight: "environment-picker",
  },
  {
    title: "Choose the board",
    body: "12 cards is a quick round, 20 is the everyday game, and the larger boards are a proper test. Change it in the lobby between rounds.",
    highlight: "lobby-size",
  },
  {
    title: "Someone to beat",
    body: "Add an AI opponent to an empty seat. Easy forgets almost everything, Medium plays like an attentive adult, Expert rarely misses twice.",
    highlight: "lobby-seats",
  },
  {
    title: "Play together",
    body: "Host a room and a six-character code appears above the board. Anyone with the code joins from their own headset.",
    highlight: "lobby-code",
  },
  {
    title: "Ask me anything",
    body: "The help button is always there. Ask by voice or by typing, with or without a connection.",
    highlight: "help-button",
  },
];

// ── Per-screen suggestions ──────────────────────────────────────────────────

const SCREEN_ALIASES: Record<string, string> = {
  menu: "home",
  main: "home",
  title: "home",
  start: "home",
  match: "game",
  playing: "game",
  board: "game",
  environment: "environments",
  world: "environments",
  end: "results",
  score: "results",
  scoreboard: "leaderboard",
  shop: "store",
  buy: "store",
};

const SCREEN_SUGGESTIONS: Record<string, readonly string[]> = {
  home: ["How do I play?", "How do I switch to mixed reality?", "How do I play with other people?"],
  lobby: ["How do I add an AI opponent?", "How many cards should I use?", "How do I share the room code?"],
  join: ["Where do I find the code?", "A code will not join", "Can I join a game in progress?"],
  host: ["How do I share the room code?", "How many people can join?", "What are the game modes?"],
  game: ["How does scoring work?", "How do I recentre the board?", "How do I switch to mixed reality?"],
  pause: ["How do I recentre the board?", "How do I switch to mixed reality?", "How do I leave the game?"],
  settings: ["How do I switch to mixed reality?", "Can I use my own 360 photos?", "What does the app store about me?"],
  environments: ["How do I switch to mixed reality?", "What environments are there?", "Can I use my own 360 photos?"],
  results: ["How is accuracy worked out?", "How does the leaderboard work?", "How do I play again?"],
  leaderboard: ["How does the leaderboard work?", "How does scoring work?", "Do scores sync between headsets?"],
  store: ["What is in each edition?", "How do I get a custom build?", "What hardware do I need?"],
  help: ["How do I play?", "What can you help with?", "Passthrough is black"],
};

const DEFAULT_SUGGESTIONS: readonly string[] = [
  "How do I play?",
  "How do I switch to mixed reality?",
  "How do I add an AI opponent?",
];

export function canonicalScreen(screen: string): string {
  const key = (screen || "").trim().toLowerCase();
  return SCREEN_ALIASES[key] ?? key;
}

export function suggestionsForScreen(screen: string): readonly string[] {
  return SCREEN_SUGGESTIONS[canonicalScreen(screen)] ?? DEFAULT_SUGGESTIONS;
}

// ── Normalisation ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "is", "are", "was", "were", "be", "been", "am",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "as", "it", "its", "this",
  "that", "these", "those", "there", "here", "then", "than", "so", "too", "very", "just",
  "i", "me", "my", "we", "our", "us", "you", "your", "they", "them", "their", "he", "she",
  "do", "does", "did", "have", "has", "had", "will", "would", "should", "could", "shall",
  "please", "tell", "give", "know", "about", "some", "any", "all", "when", "where", "who",
  "whom", "whose", "which", "why", "get", "got", "make", "made", "use", "using", "want",
  "need", "like", "again", "also", "one", "two", "up", "out", "over", "back", "now",
  "can", "how", "what",
]);

/**
 * Canonical forms, applied after stemming. Deliberately conservative: merging
 * two words that customers use differently ("score" the points and "score" the
 * leaderboard) does more harm than leaving them apart.
 */
const SYNONYMS: Record<string, string> = {
  mr: "passthrough",
  ar: "passthrough",
  seethrough: "passthrough",
  passthru: "passthrough",
  bot: "ai",
  cpu: "ai",
  robot: "ai",
  npc: "ai",
  price: "buy",
  pricing: "buy",
  cost: "buy",
  purchase: "buy",
  licence: "buy",
  license: "buy",
  quote: "buy",
  sell: "buy",
  budget: "buy",
  invoice: "buy",
  world: "environment",
  scene: "environment",
  backdrop: "environment",
  background: "environment",
  skybox: "environment",
  pano: "panorama",
  panoramic: "panorama",
  photosphere: "panorama",
  equirectangular: "panorama",
  "360": "panorama",
  recenter: "recentre",
  center: "recentre",
  centre: "recentre",
  reposition: "recentre",
  realign: "recentre",
  broken: "problem",
  issue: "problem",
  bug: "problem",
  glitch: "problem",
  fault: "problem",
  error: "problem",
  crash: "problem",
  fix: "problem",
  quest: "headset",
  hmd: "headset",
  goggle: "headset",
  version: "edition",
  tier: "edition",
  sku: "edition",
  internet: "wifi",
  network: "wifi",
  pin: "code",
  passcode: "code",
  gesture: "hand",
  finger: "hand",
  pinch: "hand",
  gamepad: "controller",
  colour: "color",
  customise: "custom",
  customize: "custom",
  cant: "cannot",
  wont: "cannot",
  doesnt: "cannot",
};

/** Light suffix stripping. Deliberately not a full stemmer — it only has to
 * make "cards" and "card" the same token without turning "device" into "devic". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) {
    w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith("e") && /(ch|sh|s|x|z)$/.test(w.slice(0, -1))) w = w.slice(0, -1);
    return w;
  }
  if (w.endsWith("ing") && w.length - 3 >= 3) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length - 2 >= 3) return w.slice(0, -2);
  return w;
}

export function tokenise(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/[\s'-]+/);
  const out: string[] = [];
  for (const word of words) {
    if (!word || STOP_WORDS.has(word)) continue;
    const stemmed = stem(word);
    if (stemmed.length < 2) continue;
    out.push(SYNONYMS[stemmed] ?? SYNONYMS[word] ?? stemmed);
  }
  return out;
}

// ── Index ───────────────────────────────────────────────────────────────────

interface IndexedEntry {
  entry: KnowledgeEntry;
  title: Set<string>;
  keys: Set<string>;
  body: Set<string>;
  phrase: string;
}

let index: IndexedEntry[] | null = null;

function getIndex(): IndexedEntry[] {
  if (index) return index;
  index = KNOWLEDGE.map((entry) => ({
    entry,
    title: new Set(tokenise(entry.title)),
    keys: new Set(entry.keywords.flatMap((k) => tokenise(k))),
    body: new Set(tokenise(`${typeof entry.body === "string" ? entry.body : ""} ${entry.search ?? ""}`)),
    phrase: entry.title.toLowerCase(),
  }));
  return index;
}

/** A question needs to clear this before it counts as answered. */
export const MATCH_THRESHOLD = 2.4;

function scoreEntry(idx: IndexedEntry, tokens: string[], phrase: string, screen: string): number {
  let score = 0;
  let hits = 0;
  let bodyScore = 0;
  const unique = new Set(tokens);

  for (const token of unique) {
    let best = 0;
    if (idx.title.has(token)) best = 3;
    if (idx.keys.has(token) && best < 2.5) best = 2.5;
    if (best === 0) {
      for (const key of idx.keys) {
        if (key.length >= 4 && token.length >= 4 && (key.startsWith(token) || token.startsWith(key))) {
          best = 1.2;
          break;
        }
      }
    }
    if (best > 0) {
      score += best;
      hits++;
    } else if (idx.body.has(token)) {
      bodyScore += 0.5;
    }
  }
  if (score === 0 && bodyScore === 0) return 0;

  score += Math.min(2, bodyScore);
  // Reward an entry that covers most of what was asked, not just one loud word.
  if (unique.size > 0) score += 1.2 * (hits / unique.size);
  if (phrase.includes(idx.phrase)) score += 3;
  if (screen && idx.entry.screens?.includes(screen)) score += 0.6;
  return score;
}

export function searchKnowledge(question: string, screen = "", limit = 4): ScoredEntry[] {
  const tokens = tokenise(question);
  if (tokens.length === 0) return [];
  const phrase = question.toLowerCase();
  const key = canonicalScreen(screen);

  return getIndex()
    .map((idx) => ({ entry: idx.entry, score: scoreEntry(idx, tokens, phrase, key) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Splits "how do I host and add a bot?" into its two separate questions. */
export function splitIntents(question: string): string[] {
  const parts = question
    .split(/[?;]|\band also\b|\band then\b|\balso\b|\bplus\b|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => tokenise(s).length > 0);
  return parts.length > 0 ? parts : [question.trim()];
}

export function renderBody(entry: KnowledgeEntry, ctx: AssistantContext): string {
  return typeof entry.body === "function" ? entry.body(ctx) : entry.body;
}

export function getEntry(id: string): KnowledgeEntry | undefined {
  return KNOWLEDGE.find((e) => e.id === id);
}

// ── The honest fallback ─────────────────────────────────────────────────────

const TOPIC_GROUPS: readonly string[] = [
  "playing a round, the modes and how scoring works",
  "mixed reality, the environments and your own 360 spaces",
  "room codes: hosting, joining and what goes wrong with them",
  "AI opponents and the leaderboard",
  "hand tracking, controllers, comfort and recentring the board",
  "the three editions, branding and custom builds",
];

export function coverageSummary(): string {
  return TOPIC_GROUPS.map((t) => `  ${t}`).join("\n");
}

function noMatch(screen: string): OfflineAnswer {
  return {
    text:
      "I do not have an answer for that one, and I would rather say so than guess.\n\n" +
      "What I can cover:\n" +
      coverageSummary() +
      `\n\nIf it is something else, ${brand.contactEmail} reaches a person.`,
    suggestions: [...suggestionsForScreen(screen)],
    matched: false,
  };
}

// ── The offline answer ──────────────────────────────────────────────────────

/**
 * Answers a question from the knowledge base alone. Handles multi-intent
 * questions by answering the two strongest intents, and returns an honest
 * "I do not have that" rather than the nearest weak match.
 */
export function answerOffline(question: string, ctx: AssistantContext): OfflineAnswer {
  const asked = (question ?? "").trim();
  if (asked.length === 0) return noMatch(ctx.screen);

  const candidates: ScoredEntry[] = [];
  const whole = searchKnowledge(asked, ctx.screen, 1)[0];
  if (whole) candidates.push(whole);

  // Multi-intent: score each half on its own, so "how do I host and add a bot"
  // is not scored as one muddled question.
  const clauses = splitIntents(asked);
  if (clauses.length > 1) {
    for (const clause of clauses) {
      const hit = searchKnowledge(clause, ctx.screen, 1)[0];
      if (hit) candidates.push(hit);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < MATCH_THRESHOLD) return noMatch(ctx.screen);

  // A second intent earns its place only if it is a separate topic and a strong
  // match in its own right. In a headset, two paragraphs is the limit.
  const picks: KnowledgeEntry[] = [best.entry];
  for (const candidate of candidates.slice(1)) {
    if (candidate.score < MATCH_THRESHOLD) break;
    if (candidate.score < best.score * 0.5) break;
    if (picks.some((p) => p.id === candidate.entry.id)) continue;
    picks.push(candidate.entry);
    break;
  }

  const text = picks.map((entry) => renderBody(entry, ctx)).join("\n\n");

  const suggestions: string[] = [];
  for (const entry of picks) {
    for (const s of entry.followUps ?? []) {
      if (suggestions.length < 3 && !suggestions.includes(s)) suggestions.push(s);
    }
  }
  if (suggestions.length === 0) suggestions.push(...suggestionsForScreen(ctx.screen));

  const answer: OfflineAnswer = { text, suggestions, matched: true };
  const highlight = picks.find((p) => p.highlight)?.highlight;
  if (highlight) answer.highlight = highlight;
  return answer;
}
