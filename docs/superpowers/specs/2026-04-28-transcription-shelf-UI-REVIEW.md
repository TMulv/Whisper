# UI Review — TranscriptionShelf + BookSession Surfaces

**Date:** 2026-04-28
**Scope:** Recently shipped UI work — `TranscriptionShelf`, `BookSession`, `ModeToggle`, MiniPlayer × button, slim `ReaderDrawer`. Code-only audit; not yet tested on device.
**Auditor:** Claude (inline; formal `/ui-review` pipeline unavailable on this project).
**Source artifacts:**
- [shelf-v3.html](.superpowers/brainstorm/transcription-progress/shelf-v3.html) — visual baseline (HTML mockup the RN code targets)
- [src/components/book/TranscriptionShelf.tsx](../../../src/components/book/TranscriptionShelf.tsx)
- [src/screens/library/BookDetailScreen.tsx](../../../src/screens/library/BookDetailScreen.tsx)
- [src/screens/book/BookSessionScreen.tsx](../../../src/screens/book/BookSessionScreen.tsx)
- [src/components/book/ModeToggle.tsx](../../../src/components/book/ModeToggle.tsx)
- [src/components/player/MiniPlayer.tsx](../../../src/components/player/MiniPlayer.tsx)
- [2026-04-27-seamless-read-listen-ui-spec.md](./2026-04-27-seamless-read-listen-ui-spec.md)

## Scores

| Pillar | Score | One-line |
|---|---|---|
| Copywriting | 3 / 4 | Strong voice, slightly verbose meta line |
| Visuals | 2 / 4 | Code works; meaningful gap from the HTML mockup (no gradients) |
| Color | 4 / 4 | Cohesive jewel-toned palette, anti-AI-slop, distinctive |
| Typography | 1 / 4 | Custom fonts (Cormorant, Cinzel) not loaded — defaults to system |
| Spacing | 3 / 4 | Consistent rhythm; one milestone-alignment wrinkle |
| Experience Design | 3 / 4 | Ambient + non-blocking; missing a completion moment |
| **Overall** | **16 / 24** | |

---

## 1. Copywriting — 3 / 4

**What's working**
- Eyebrow `BUILDING WORD-ACCURATE SYNC` — technical, ownable phrase, ALL-CAPS-LETTERSPACED reads as label-not-headline.
- `Your library, arriving` — evocative metaphor, italic gilt accent on the verb. Carries the whole concept.
- Footer microcopy: `You can read or listen now — the shelf fills in the background.` — anchors the non-blocking contract directly. Earns its space.
- Phase labels (`Uploading audio` / `Submitting` / `Transcribing` / `Word-accurate ready`) are honest and progressive.
- `about 9 minutes` / `almost done` / `a moment` — appropriate hedging.

**Fixes**
- The meta line `"Twenty volumes — one for each five percent. The book in progress glows warm as it fills."` over-explains the mechanic. Two sentences are doing one sentence's job. Trim to: `"Each volume is five percent. The book in progress glows warm as it fills."` — same idea, half the words. Or drop the second clause entirely and let the visual carry it.
- `BUILDING WORD-ACCURATE SYNC` is jargon-leaning. Audience is a reader who hit "import." Consider `LISTENING TO YOUR AUDIOBOOK ONCE` or `LEARNING THE AUDIO` for a softer hook. (Marginal — current copy isn't bad, just engineery.)

---

## 2. Visuals — 2 / 4

**What's working**
- 20 chunky books with deterministic per-`bookId` widths/heights — solves the "barcode" problem from v1/v2.
- Per-book gilt cartouche with Roman numeral renders at every `BookDetail` open consistently.
- Four raised-band ribs across each spine give immediate "book" reading.
- Active spine has an animated bottom-up fill that ticks with sub-percent — the most successful single detail.
- Wood-tone shelf board with a thin gilt accent at the top — adds the antiquarian register the spec promised.

**Gaps from the mockup baseline**
The HTML mockup leans hard on stacked `linear-gradient` layers — RN doesn't ship with `expo-linear-gradient`, so the implementation substitutes:
- Spine highlight/shadow: solid 8%-wide white View on the left, 12%-wide black View on the right. Falloff is a hard step where the mockup has a smooth gradient. Reads more "blocky" than "leather."
- Cartouche: flat `#C9A96E` block. Mockup had a top-highlight → deep-gold ramp that made it feel like foil; now it reads as a painted rectangle.
- Top/bottom edge gilding: thin solid-color rectangles instead of fading bands. OK but loses the "glint" effect.
- Active-spine fill: solid translucent gold with a top hairline. Mockup's gradient (transparent → warm at 60% → bright cream at 100%) made it feel like light rising. Current version reads more like a filled bar.
- No leather grain — the mockup's `repeating-linear-gradient` of horizontal hairlines was dropped.

**Fixes (priority order)**
1. **Add `expo-linear-gradient`** and restore four gradients: spine highlight↔shadow, cartouche foil, active fill rising, top edge glint. Single dep, ~30 lines refactor inside `TranscriptionShelf.tsx`. Highest-leverage visual fix.
2. **Empty (ghost) spines** at `rgba(201,169,110,0.025)` on `#0E0E1A` may render as nearly invisible on real screens — verify on device. If lost, bump to `0.06–0.08` opacity or use a faint dashed border with a touch more saturation.
3. **Settle animation only animates when `filledCount` increases** (lines 116–127). After the increment, the just-arrived spine returns to its base color but the animation's `filter: brightness(1.6 → 1)` is replaced by RN `opacity` only because `filter` isn't an RN property. Consider an `Animated.View` that overlays a brief brightness flash, or a quick scale dip+rebound.
4. **Pulsing dot** uses native `shadowColor` glow — works on iOS, has no effect on Android. Add `elevation` or a faint colored ring (Animated.View) for parity.

---

## 3. Color — 4 / 4

- Dark navy `#0E0E1A` ground, gilt `#C9A96E` accent, cream `#F0E6D4` text — already-established BookDetail palette, used coherently here.
- 12-color spine palette (burgundy / chocolate / forest / navy / oxblood / olive / tan / slate / honey / aubergine / mahogany / moss) is varied without becoming a rainbow. Reads as a real shelf, not a chart.
- Phase label `cream` (`#F0E6D4`); ETA muted brown (`#6E6452`) — strong hierarchy through saturation alone.
- Counter `#E8CE92` glows warm; `/ 100` dims to `#8C7340` — the suffix doesn't compete with the live number.
- Milestones `#8C7340` italic — quietly present, not a decorative tax.

No issues. Strongest pillar of the pass.

---

## 4. Typography — 1 / 4

**Critical: the fonts in the mockup are not loaded in the app.** `TranscriptionShelf.tsx` uses no `fontFamily` declarations, so:
- "Your library, *arriving*" renders in iOS system serif / Android default — none of Cormorant Garamond's italic warmth.
- "BUILDING WORD-ACCURATE SYNC" renders in system sans — adequate but not the Inter the mockup used.
- "42 / 100" renders in system display — loses the old-style figures and tabular feel from `font-feature-settings: "lnum" 0, "onum" 1, "tnum" 1` that gave the mockup its "library catalogue card" register.
- Roman numerals on the cartouche render in system sans-serif — no Cinzel chiseled-letter character.

The mockup's distinctiveness is half typography. Without it, the visualization works mechanically but feels generic.

**Fix**
- Install `expo-font` and load three families: Cormorant Garamond (regular + italic + 500/600), Inter (500/600), Cinzel (600 for the cartouche). All three are open-licensed (OFL) and small (<200KB total).
- Add `fontFamily` to the heading, italic emphasis, counter, eyebrow, phase label, plate numerals, and milestones.
- Apply `fontVariant: ['tabular-nums']` is already on the counter — that survives without custom fonts but is best paired with old-style figures from Cormorant.

This single change moves Typography 1 → 4 and bumps Visuals as a side-effect (because most "visual" character actually came from the typography choices).

---

## 5. Spacing — 3 / 4

- Card padding 16pt; section internal margins 10–18pt — consistent.
- Counter row uses `alignItems: 'flex-end'` so the 52pt numeral and 11pt phase label baseline-align cleanly.
- Spine gap of 2pt — tight enough to read as "shelf," loose enough to discriminate individual books.
- 6pt top padding above the shelf row, 8pt for the milestone row, 14pt before the footnote — reads as a rhythm.
- Footnote separated by a hairline border — appropriate de-emphasis.

**Wrinkle**
- Milestones `I / V / X / XV / XX` are rendered with `justifyContent: 'space-between'` across the shelf width, but the spine grid uses **variable widths** (`flex` values 0.85–1.55). So the milestone for "V" (book #5) won't sit directly under book #5; it sits at 25% of the shelf width. With the deterministic seed, that's typically off by 1–2 spine widths. The visual lie is small but present.
- Fix: compute milestone left-positions from the cumulative `flex` sum at indices `0, 4, 9, 14, 19` and absolutely-position each tick. ~10 lines.

---

## 6. Experience Design — 3 / 4

**Working**
- BookDetail mount: detect cached audio → check AAI cache → if not cached, kick off transcription with the dedup'd background job. Adapter handles persistence + resume across cold starts. Calling kickoff every mount is safe.
- Shelf hides itself when `fraction === 1` — no stale UI.
- Reading and listening still work — the user's explicit non-blocking constraint is met.
- Pulsing dot in the eyebrow signals "live" without being noisy.
- Active spine's bottom-up fill provides visible motion at sub-spine resolution — the user sees progress between the every-5%-locks-in events.

**Missing**
1. **No completion moment.** When transcription finishes, the shelf simply unmounts. The user spent 8–14 minutes watching their library "arrive" and then it just… vanishes. Should hold for ~2–3s on `fraction === 1` with: every spine briefly glows gilt, phase label `Word-accurate ready ✓`, then fade out. One small payoff for the wait.
2. **No way to dismiss/collapse.** If the user doesn't care about progress and just wants to scroll past the shelf, there's no affordance. Low priority — the shelf is short — but a small `▾` collapse caret in the top-right of the card would be a polite escape valve.
3. **No error state.** `TranscriptionStatus` doesn't currently expose an error phase, but if the AAI job fails (network drop, invalid key, rate limit), the shelf will sit at whatever fraction it last reached forever. Confirm the adapter surfaces an error path; if not, add one and render a subdued retry chip ("Couldn't reach the transcription service · Retry").
4. **First-render flicker.** `txStatus` starts as `null`; the first effect fires after `book` is loaded, then awaits `getCachedPath` + `loadCachedAssemblyAiWords` before setting status. On a cached book that's done, the shelf never appears — good. On an in-progress book, there's a perceptible delay before the shelf renders, even though the data is already there. Pre-render a skeleton (static empty shelf + indeterminate counter) on mount; replace with live data when `txStatus` arrives.

---

## Top 3 fixes (priority order)

1. **Load custom fonts** (Cormorant Garamond, Inter, Cinzel) via `expo-font`. Single biggest aesthetic win. Typography 1 → 4.
2. **Add `expo-linear-gradient`** and restore four gradients (spine highlight↔shadow, cartouche foil, active fill, top edge glint). Visuals 2 → 4.
3. **Completion moment** — hold the shelf for ~2.5s on `fraction === 1` with a brief all-spines-glow + `Word-accurate ready ✓` label, then fade. Experience 3 → 4.

After all three: projected 22/24.

---

## Notes on what wasn't audited

- **On-device verification.** This is a code-only audit. iOS-vs-Android shadow/elevation differences, dashed-border rendering, and gradient performance with 20 spines × 4 layers are unconfirmed. Recommend a 5-minute pass on both platforms after the gradient migration.
- **`BookSession` cross-fade timing.** The 180ms duration in the spec was approved but never timed against real content — feels-too-fast / feels-too-slow is judgment-on-device.
- **Accessibility.** Pulsing dot + animated counter likely violates `prefers-reduced-motion`. RN equivalent is `AccessibilityInfo.isReduceMotionEnabled` — gate the loop animations behind it.
