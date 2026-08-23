# TODO — engineering backlog

Deferred work, most valuable first. Each item records *why* it matters, grounded
in a concrete incident rather than general principle, so the cost of skipping it
stays visible.

Status legend: `[ ]` open · `[x]` done · `[~]` partially done

---

## 1. [~] Merge the two parse flows — *decision layer done v1.1.2.392*

**Problem.** The NETARD flow and the plain-paste flow were near-duplicate
implementations of the same pipeline, and they kept silently drifting:

- the plain-paste flow never called the parse-spec engine **at all** — detection
  was spec-driven but parsing always fell through to the legacy DDL walk;
- it lacked the "bound spec → parse directly, never prompt" short-circuit that
  the NETARD flow had, so a bound spec could raise a DDL picker whose answer was
  then ignored, and a spec with a binding could report *"no matching DDL"*;
- it never reported what detection matched, while NETARD did.

**Why it matters.** This is the root cause of the PSTM "all 30 services" report —
not the OCCURS logic. `repeat count: NUM-SERVICES` was correct the whole time; it
simply never executed. Every fix had to be applied twice, at four call sites
(v1.1.2.361 / .366).

**Shape of the fix.** One pipeline — `extract bytes → detect → resolve spec →
parse → render` — where the input format decides **only how bytes are extracted**.
Manual DDL override stays the single deliberate exception.

### Done — the routing DECISION is shared (v1.1.2.392)

`_parseVerdict` is now the one place a recognized message is classified —
`unknown` / `no-spec` / `parsed` / `needs-ddl` — and the NETARD, FUP and
plain-paste flows all call it. `_ppDetectDetails` shares the detection summary,
so a message pasted as raw text reports the same "Matched as X" as the record it
came from. File specs were folded into the same rules as message specs: an
unbound file prompts for a DDL instead of being special-cased, which removed
three special cases rather than adding one.

Two bugs surfaced while merging: the record flow crashed (`null.split`) whenever
a bound-DDL warning fired for a spec with no DDL path, stalling the parse
silently after detection; and the engine score was not carried through, so the
below-95% warning could not report a real figure.

### Remaining — the ORCHESTRATION is still duplicated

`doParseNetardLog` and `doParseMessages` keep their own scoring loops, picker
queues, deferred handling and result assembly — roughly 1200 lines. Lower risk
now that the decision is centralised and the routing tests (item 2) are in
place, but a separate piece of work.

**Risk.** Large refactor of the main parse path. Migrate one flow at a time,
behind the routing tests.

**Measured and deferred 2026-08-13.** `doParseNetardLog` is 654 lines and
`doParseMessages` is 626. They share 75 of their 107 distinct calls, so about a
third of each is genuinely different — it is a real merge, not a copy-paste one.

**It fixes no known bug.** Everything the duplication actually broke was the
DECISION layer, and that is done: the plain-paste flow not calling the engine at
all, the missing bound-spec short-circuit, the silent detection, and the PSTM
"all 30 services" report were all fixed when `_parseVerdict` centralised routing
in v1.1.2.392. What is left is drift risk — the next fix landing in one flow and
not the other, which is how those bugs happened in the first place.

So this is tidying with a real but future payoff, not a repair. Deferred on that
basis rather than started at the tail of a session with other work waiting to
ship. When it is picked up it wants a clean tree and one flow at a time.

---

## 2. [x] Integration tests asserting which parser ran — *done v1.1.2.372*

Five tests in `test.js` under **parse-flow routing (which parser ran)**. They
intercept `_meParseFileWithSpec` (engine) and `bestDDLMatch` (legacy) inside the
VM sandbox and count which actually executed, using the **real shipped specs**.

Validated by reintroducing the original defect (engine never runs) and confirming
2 tests fail, then restoring.

---

## 3. [ ] Remove the decimal/hex guess in `_meFieldAsInt`

**Problem.** It tries `/^\d+$/` decimal first, then falls back to hex. So the same
bytes decode differently depending on what they happen to look like.

**Why it matters.** This is what made `max: "NUM-SERVICES"` dangerous on the ASCII
PSTM spec: a `TYPE BINARY 16` counter is absent from an ASCII capture, and when
the occupying bytes happened to render as digits it parsed to a plausible but
unrelated decimal and silently truncated the services loop (removed in
v1.1.2.371).

**Shape of the fix.** Let a reference declare its encoding, e.g.
`{"field": "NUM-SERVICES", "as": "uint16-be"}`, and make an unreadable field an
error instead of a guess. Applies to `repeat.count`, `read-while.max`,
`read-fixed.length`, `read-length-prefix`.

**Narrowed 2026-08-05.** A type override now decides the decode for a VLG LEN —
`hex-char` reads the hex characters, `uint*` reads a number (v1.2.3.2 /
v1.2.4.1).

**Narrowed again 2026-08-08 (item 9).** The no-override case is closed *for a
LEN*: it now follows override → parse-spec block encoding → recognizer → ASCII,
and says so when it assumed. `_meFieldAsInt` itself is UNCHANGED — the
decimal-then-hex guess is still exactly as written above, and still runs at
`repeat.count`, `read-while.max` and `read-fixed.length`. That is what is
left of this item, and it is the dangerous half: those references decide how
many times a block repeats.

---

## 4. [x] Give `when` a byte-peek guard — *done v1.21.13.0*

**Problem.** The legacy PSTM parser protects the user-data read with
`bytes[cursor] !== 0x26` — an eye-catcher check the spec language cannot express.

**Done.** `when` takes `bytes` / `not-bytes`, matched against the cursor without
reading — the eye-catcher case the legacy parser hardcoded is now expressible.
Confirmed still working 2026-08-22 while re-probing session 1dec59.

**Why it mattered.** Without it a `when` branch can consume the token eye-catcher
`"& "` as a 2-byte length (0x2620 = 9760) and run the cursor thousands of bytes
past the end. v1.1.2.368 made that fail loudly instead of silently, but the spec
still cannot express the guard that would prevent it.

**Shape of the fix.** Expose `read-while`'s guard predicate shape to `when`
(`type` / `length` / `pattern` / `value` / `encoding`) so specs can encode what
legacy hardcodes.

---

## 5. [ ] Version the test fixtures

`test/` is gitignored, so the segmented-file DDLs, generated samples and
`gen-seg-samples.js` — the reproduction for all three Base24 seg-map variants —
exist only on one machine. Track them (they can still be excluded from the
release bundle).

**Untracked 2026-08-07, put back 2026-08-08.** `test.js`, `baseline.js` and
`baseline.golden.json` were removed from the repo by request and spent a day
existing only on this machine — 528 tests and 1472 baseline cases with no copy
anywhere. They are tracked again, so `npm test` works on a fresh clone and the
harness survives this laptop.

What is still open is the original item: `test/` remains gitignored, so the
segmented-file DDLs and generated samples — the reproduction for all three
Base24 seg-map variants — are still single-copy.

---

## 6. [x] Never ship an unbumped version — *done 2026-08-08*

`APP_VERSION` is hand-edited in `source.html` and is the only thing
distinguishing one deploy from another.

**It happened, 2026-08-07.** Three commits shipped as v1.11.0.0, v1.11.0.1 and
v1.12.0.0 with the constant still reading `1.10.1.0`; the user found it by
looking at their own preview.

### Why "derive it from the build script" was the wrong ask

The original title was *Bump `APP_VERSION` from the build script*. It cannot be
done, for two reasons:

1. **The level is a judgement.** Whether a change is a fix or a feature is about
   what it *means*, and no script reads that off a diff.
2. **The build runs before the commit**, so it cannot even consult the commit
   message to infer one.

An `npm run bump` command was considered and rejected for a better reason, which
the user pointed out: the person who forgets to edit the constant is the same
person who would forget to run the command. It relocates the problem.

### What shipped instead — a gate in a step nothing can skip

`build.js` refuses to build when `source.html` has changed since the last commit
and `APP_VERSION` has not. Every change goes through the build, so it fires
without anyone having to remember it. It does **not** pick the level; it only
refuses to let the question go unasked.

Verified on three cases: a plain rebuild passes, a forgotten bump blocks, a
proper bump passes. The **first version of it failed open** — `git show` on a
1.3 MB file exceeded Node's 1 MB default buffer, and the resulting ENOBUFS
landed in the `catch`, so the check could never fire under any circumstances. A
check that silently cannot fail is worse than none, because it is believed.
`maxBuffer` is now set explicitly.

The pre-existing test comparing `APP_VERSION` against the version in HEAD's
commit subject stays as a second net, one commit later.

### The convention — agreed with the user 2026-08-08

| segment | in `1 . 13 . 3 . 1` | moves when |
|---|---|---|
| 1 major | `1` | a full app overhaul — once, and the user decides |
| 2 minor | `13` | a new body of work / release theme |
| 3 patch | `3` | a distinct change within that theme |
| 4 build | `1` | a follow-up fix to the change immediately before it |

Commits touching only tooling, tests or docs need no bump — the gate keys on
`source.html`, so it stays quiet for them.

**The level is proposed and agreed before committing, not chosen afterwards.**

---

## 7. [x] Show parse provenance in the UI — *done v1.1.2.375*

The Parse Results metadata bar (`#recMetaRow`) now states which parser produced
the fields and how much of the record they account for:

    PSTM | PSTM/PSTM | parse-spec (binary) | 214 bytes        clean
    PSTM | PSTM/PSTM | parse-spec (binary) | 180/214 bytes    amber — 34 unparsed
    PSTM | PSTM/PSTM | parse-spec (ascii)  | 214 bytes ⚠      amber — fields run past the end
    PSTM | PSTM/PSTM | DDL walk            | 214 bytes        legacy fallback
    PSTM | PSTM/PSTM | manual override     | 214 bytes        scope-selected

Coverage is computed from the fields, so it needs no plumbing. No new UI — the
existing bar, and it persists (unlike the progress overlay).

**Correction (v1.1.2.404).** This item originally claimed "`parsedBy` is set on
every parse path". It was not. Every automatic path had it, but two of the three
**manual override** paths did not — the single-record NETARD override
(`opts.showOverride`) and the non-NETARD override (`_runP1Parse`). Only the FUP
COPY path (`opts.forceScopeAll`) set it. So the provenance field rendered **empty**
in exactly the mode where it matters most, since manual override has no spec name
to fall back on. Both were fixed in v1.1.2.404 along with the `manualOverride`
flag, and a test now asserts every "Manual override mode" site sets both, naming
the offending `source.html:LINE` when one does not.

---

## 8. [ ] `read-tlv`: fall back to an element whose name matches the tag

**Problem.** Without `tags`, `read-tlv` consults the DDL not at all. It invents a
row `<buffer>.<tag>` holding the raw value — no data type, no description, nothing
from the DDL. Every tag→element relation has to be written out by hand, even when
the DDL already declares an element by that name.

**Shape of the fix.** When `tags` does not mention a tag, try resolving the tag
itself as an element id (the same scoped lookup `tags` uses). Fall back to the
synthetic row only when no such element exists, so nothing that works today
changes. `unknown: "skip"`/`"error"` keep their current meanings.

**Why it is parked, honestly.** It would rarely fire on the DDLs we actually have.
Tags in production are hex values — binary or ASCII — while element names are
descriptive (`CARD-TYPE`, not `0002`), so most specs need the explicit map
regardless. Worth doing when a DDL that *does* name elements after its tags shows
up; costs nothing when it doesn't, since the fallback simply never matches.

Raised 2026-08-02 while adding `encoding: "ascii"` (§5.15) — the expectation that
a bare `read-tlv` already did this is a reasonable one to have, which is its own
argument for either implementing it or saying so in the help.

---

## 9. [x] Make an `ascii` LEN strict — *done v1.13.1.0 → v1.13.3.1*

**Problem.** `_meDecodeLength` (`source.html:22891`) only treats a type as binding
for `hex-char` and the integer widths. Declaring a LEN as `ascii` still runs the
old byte-value guess: every byte a digit reads as digits, anything else falls
through to a big-endian integer. An `ascii` LEN holding `0x01` returns 1 instead
of reporting that those bytes are not ASCII digits.

**Why it matters.** It is the last surviving branch of the guess that produced
the `0x37 → 7` bug (v1.2.3.2 / v1.2.4.1). The user now reaches for `ascii`
deliberately — it is the override that yields the character reading — so it is
the one most likely to be handed bytes that disprove it.

**Shape of the fix.** `ascii` forces the digit branch; non-digit bytes become an
`issue` on the field, worded like the hex-char one ("…is not a decimal number").
Roughly twenty minutes with a regression test. Raised 2026-08-05.

### Done (v1.13.1.0 → v1.13.3.1) — and it was four bugs, not one

The estimate was wrong because the premise was. The Data Editor offers NINE
types and the length decoder honoured TWO. `ascii`, `ebcdic`,
`hex-ascii-decimal` and `hex-ebcdic-decimal` were byte-for-byte identical to
declaring nothing at all. The one that mattered was EBCDIC: F1 F9 is "19" on
the box and decoded as **61945** whichever of the four you picked — a length
that sends every later field to the wrong offset.

Writing the "is every offered type handled" test found two more, neither looked
for: `uint-be` / `uint-le` carry no width and were absent from the integer
pattern, so they fell through to the guess; and the decode was unconditionally
big-endian, so **little-endian was offered everywhere and honoured nowhere** — a
little-endian 19 read as 4864.

The full precedence now runs override → parse-spec block `"encoding"` →
recognizer → ASCII-and-say-so. The block level already existed and read-fixed
had honoured it since 2026-08-02; the LEN paths never looked at it.

One design correction came out of it. "No override → read it as the spec's
encoding" was two questions, and the spec can only answer one: *text or binary?*
it cannot (PIC X(2) does not say, and a binary length in a character field is
ordinary on Base24 — eight tests failed on exactly that shape), but *if text,
ASCII or EBCDIC?* it can. So the spec's encoding is tried as text first and the
integer reading stays as the fallback. The guess that is gone is the one that
let byte VALUES pick the encoding.

---

## 10. [x] Write up the session rules in SPEC — *done 2026-08-08*

Three behaviour changes shipped that day with nothing in the spec:

- a `hex-char` length counts CHARACTERS; wire bytes = `ceil(chars / 2)`, and an
  odd count spends a whole byte and shows half of it (v1.2.5.0)
- an engine complaint about a field that parsed rides on the field as `issue`
  instead of becoming its own row, and Parse Results prints it (v1.2.3.0)
- a leaf length source and the field it sizes are ONE data element, like a VLG
  group (v1.2.7.0)

Parked only because a dated changelog entry needs the user's go-ahead first.

---

### Done 2026-08-08

§8 *Length decoding* rewritten — it was actively wrong, not merely incomplete.
It documented the byte-sniff as the rule and asserted `EBCDIC needs no case of
its own because the message is translated to ASCII before parsing`, which holds
only for input format `ebcdic`. That sentence is why the EBCDIC bug went
unnoticed. Now: the four-level precedence table, every type with a worked
example, the text-vs-binary distinction, the assumed-encoding report, the
hex-char character unit, and the superseded text quoted so the old claim is
findable rather than erased.

Also added: how a complaint is reported (`issue` rides on the field,
`error` means the row is not a field) — the rule behind the duplicate
`TRACK2.LEN` — and the OCCURS ceiling on a length-driven `repeat`.

Already present, checked rather than assumed: `greater-than` / `less-than`
with the legacy migration (§4.4), and `vlg: true` on any field (§8.0).

Changelog entry dated 2026-08-08. The eight spec-vs-code enforcement tests pass.

---

## 11. [x] GitHub Pages wedge — *not a defect: it was a GitHub outage*

**Closed 2026-08-08.** Nothing to do here. This was written as a rule about push
cadence — "one deployment at a time, do not push in bursts" — and that diagnosis
was wrong.

**What actually happened 2026-08-06.** Three pushes in seven minutes each started
a Pages deployment; the first wedged in `deployment_queued` and never finished,
every later one was rejected, and the site sat on an old version while Vercel was
current:

    Deployment request failed for <sha> due to in progress deployment.
    Please cancel <earlier sha> first or wait for it to complete.

Cadence fit that occurrence, so it became the explanation. Then the same wedge
reproduced **on a brand-new repo with a single push**, during a GitHub-wide
incident affecting Actions and Pages. One push cannot collide with itself. The
outage explains both, and pushing in bursts has been fine every time since.

**Worth keeping, as operations rather than backlog:**

- If Pages wedges, the reset is Settings → Pages → Branch → `None` → Save, then
  set it back. That tears down the pipeline and releases the queue; a wedged run
  cannot be cancelled or re-run from the Actions UI.
- Check githubstatus.com **before** theorising about the repo. Three wrong
  diagnoses were made here — push cadence, `{{` Liquid syntax, and edge caching
  — while the real cause was on the status page the whole time.
- The `build` job's warnings (`punycode` deprecation, Node 20 on
  `actions/checkout@v4`) come from GitHub's own generated workflow. There is no
  `.github/workflows` file in this repo to pin. Noise, not a cause.

**And then it happened for real, 2026-08-08.** Six consecutive Pages
deployments failed at the *Build with Jekyll* step. Cause: this very entry. The
sentence listing \`{{\` Liquid syntax as one of the *wrong* diagnoses put a
literal \`{{\` into TODO.md, and Jekyll runs Liquid **before** markdown, so the
backticks around it protect nothing. An unclosed \`{{\` is a Liquid syntax
error, the build dies, and the deploy never runs.

Fixed by adding **\`.nojekyll\`** at the repo root. The repo serves a static
\`index.html\` and has no Jekyll content, so the whole Liquid pass was pure
risk. This removes the class of failure, not just this instance — any future
\`{{\` or \`{%\` in any markdown file is now inert.

Diagnosis note, since this entry is partly about bad diagnoses: the boundary was
found from the run list rather than guessed. \`fa6e70e\` succeeded at 22:36,
\`b942810\` failed at 22:38, and that commit touched TODO.md and nothing else.

---

## 12. [x] The scoring body cannot be reached by any test — *done v1.12.2.0*

**Problem.** Everything inside `_startP23Scoring` runs in a `setTimeout`
callback, and `test.js` stubs `setTimeout` to a no-op. So the entire pre-scoring
pass, the per-chunk assembly, the deferred-DDL picker queue and `_finalizeParse`
are unexecutable from the suite. The tests that cover them read the *source
text* instead — which catches shapes, not behaviour.

**Why it matters.** v1.12.0.2 was a plain `TypeError` on the most ordinary path
in the app — parse a message that matches a spec — and 498 tests passed over it.
A source-text tripwire now pins that one line, but the next mistake in that
function will be invisible in exactly the same way.

**Shape of the fix.** Give the sandbox a real `setTimeout` (or a manual pump the
tests drain) for a small number of end-to-end parse tests, and assert on the
`parsed[]` array the function builds. The DOM stubs already tolerate being
called; the timer stub is the only thing standing in the way.

### Done (v1.12.2.0)

`setTimeout` queues instead of dropping, and `pumpTimers()` drains the queue in
scheduled-delay order — including callbacks scheduled by callbacks, which the
per-DDL compile loop needs. Nothing runs until a test asks, so the 510 tests
that predate this behave exactly as before.

Two end-to-end tests drive `doParseMessages` the way a click does and assert on
`S.messages`. Both were verified by reintroducing the defect they exist for:

- a spec that binds its own DDL → v1.12.0.2's dereference of the compile map
  that was never built; **0 messages instead of 1**
- an unrecognised message → v1.11.0.0's out-of-scope `detectStr` / `detTrace`;
  **0 messages instead of 1**

One sandbox gap surfaced doing it: in a browser `window.X = fn` also creates the
global `X`, and top-level code depends on that (`detectMsgTypeTrace` calls the
bare `_fmtDetectTrace`, which only escapes its block via `window`). The stub
window never did, so the first honest run threw `ReferenceError`. Eleven such
exports are bridged in the harness.

**Still not covered.** The deferred-DDL picker queue needs a user choice, so the
`needs-ddl` path stops at the prompt rather than running to completion.

---

## 13. [x] The audit panel's cog does not dim its host — *done v1.13.4.0*

The last of the four column choosers. The other three — export modal, Parse
Results, Data Editor — all light the cog, dim the host and lift the cog above
the scrim; `auditCfgDialog`'s toggle still only flips `.open`. Now that the
scrim rules are written against `.cfg-dim` alone and the three toggles are a
table in test.js ("its cog lights, and what is behind the chooser dims"), this
is one line plus a row in that table. Check first, as the other two did, that
no absolutely-positioned descendant of the host resolves above it.

---

## 14. [x] Unreproduced: the export chooser closed once on its own — *closed 2026-08-08*

While verifying v1.12.1.0 the export column chooser was observed closed after
two programmatic toggle clicks, with nothing in the code path that closes it.
Nine further clicks — including a real mouse click through the browser — did
not reproduce it, and no outside-click or document-level handler touches that
dialog. Recorded rather than dismissed: if it shuts unprompted during normal
use, that is a real signal and this note is the second data point. Suspect the
probe rather than the app until a user sees it.

**Closed 2026-08-08.** The user has never hit it: *"14 can be closed i never
faced that issue myselft"*. It was observed once, from a programmatic probe,
and never reproduced across nine further clicks including a real mouse click.
Recorded and closed rather than left open as a permanent maybe — if it happens
to a person, this entry is the second data point.

---

## 15. [x] Theme system — *done v1.16.0.1, branch `feat/theme-system`*

**Problem.** A theme was a *patch set*, not a data set: dark lived in `:root`
and light re-patched it in **90 `body.light` rules**, so a third or user-defined
theme needed its own 90. Alongside that, 106 hardcoded hex and 144 rgba literals
bypassed the token layer entirely.

**Done.** Three layers — primitives → semantics → themes — where a theme is one
flat block of assignments under `[data-theme]` on `<html>`. Light and dark share
100% of the component CSS.

  body.light rules      90 → **0** (the `light` class went with the last one)
  badge definitions     written twice → **11 shared hue slots**
  borders               `--bw` 1px containers · `--bw-ctl` 2px controls
  density               a user setting: Comfort / Compact, `[data-density]`
  accent                free colour picker + luminance-based contrast
  tests                 545 → **556**

**The bugs this surfaced, none of them cosmetic:**

- `_eggSetAccent` wrote every variable to *both* `<html>` and `<body>` because
  `body.light` redefined `--accent` on a descendant of the element being
  overridden. Moving `data-theme` to `<html>` fixed it; one write now.
- Panel title bars stayed dark in light theme — a literal `#1c2128` with no
  light counterpart, invisible until someone looked at the running app.
- In light theme the `teal` and `green` hue slots were byte-identical, so every
  FUP badge rendered the same chip as its non-FUP counterpart. Information loss,
  not decoration.
- Help section toggles were `<div onclick>` — unreachable by keyboard entirely.

**The one thing that did NOT work — do not retry it.** Snapping panel splits to
whole pixels in JS, to stop 1px borders straddling a device pixel. It fixes
containers, leaves every button fractional anyway because the fraction
originates *inside* a text-sized box, and corrupts saved split ratios on resize
(a 50/50 split became 69/31 with no way back). Built, tested, reverted. The
working answer is `--bw-ctl: 2px` on controls, which is what the project's
original "always 2px" rule had been protecting all along — see
`feedback_borders` in memory.

**Reference implementation.** `_theme-proto.html` at the repo root.

---

## 16. [x] Loose ends from the theme work — *done v1.21.4.1*

- [x] **`#expFilterInput` hardcoded `font-size:12px`** — now `var(--sz-mono)`.
      Measured across Small/Medium/Large: 10 / 12 / 14px.
- [x] **The toast hardcoded 12px too** — same fix, same measurements.
- [x] **The Message Entity ruler** — *no bug existed.* The premise was wrong: the
      ME panel draws no ruler at all. `#lwColMarker` is injected into the main
      message-input editor only; the ME side calls `_detectNetardRuler` purely to
      pick a clip width for parsing, with no pixel positioning, so the stale
      `defaultCharacterWidth` bug fixed in v1.20.2.1 cannot occur there.
      It did surface a real one, now fixed: that path SET `S.netardRulerCol`,
      which is the main panel's ruler column, and left it set — so running a Test
      in the Data Editor silently moved the Message Input panel's ruler to
      whatever width the test snippet had. Snapshotted and restored in a
      `finally`. Verified: main column 75, Test run, still 75.
- [x] **`.btn-sm` was dead** — 44 usages, and `git log -S` over the last 40
      commits found no CSS rule for it at any point, so it never did anything.
      Stripped from the markup rather than given a rule: inventing one now would
      restyle 44 buttons that already look correct. Buttons verified unchanged
      after removal (1px border, 6px radius, same padding).

---

## 17. [ ] Chunk the large-record parse so the tab stays alive

**Reported 2026-08-10.** A 200,000-record audit file filtered to 14,171 parses
fine on an M4 Mac mini and is punishing on an ordinary notebook. The guardrail
shipped in v1.21.5.0 (ask above 2,000 records) buys the user a choice; it does
not make the work cheaper. This item is the work.

**Three separate costs, not one.**

1. **The per-record loops are synchronous.** `for (const rec of records)` at
   roughly `source.html:9122` and `:9269` runs to completion with no yield.
   `_parseAborted` is checked only between STAGES — the `setTimeout` boundaries
   in the progress overlay — so during the record loop the tab cannot paint and
   **Cancel cannot fire**. This is what the user experiences as a freeze, and it
   is why the new confirm has to say "the page will not respond".
2. **`auditParseAll` reads every selected record up front:**
   `await Promise.all(rows.map(r => file.slice(...).arrayBuffer()))`. All 14k
   slices are resident simultaneously before any parsing starts.
3. **Then it hex-encodes all of them** into strings, roughly doubling the bytes
   held, still before the parse begins. Memory peaks before the work starts.

**Shape of the fix.** Process in batches of ~200: slice, encode and parse a
batch, then yield to the event loop. That gives a live progress count, a Cancel
that actually works, and a flat memory profile instead of a spike — the progress
overlay already assumes this shape.

**Risk.** It is a change to `doParseMessages`, which item 1 above already flags
as ~1200 lines of orchestration duplicated between the NETARD and plain-paste
flows. Do it behind the parse-flow routing tests (item 2), one flow at a time.
Deliberately deferred rather than rushed.

---

## 18. [ ] Custom filters for the Audit — match on message CONTENT

**Asked for and designed 2026-08-10.** The Audit filter today is fixed-field and
header-only: Source and Dest (with an OR/AND toggle), Rec# range, Date range,
Time range — all ANDed. Enough to cut a 200,000-record file to 14,171 and no
further, because nothing in the header says *what the message was*.

### Declaring a filter — in the parse spec

A new block type names a DDL field as filterable:

```
[
  { "read-ddl": { "binding": 0 } },
  { "token-area": "ANY" }
],
[
  // Fixed-position field: the string form is enough.
  { "add-filter": "TYP" },

  // Bitmap-dependent field: pin the map, and the offset follows from it.
  { "add-filter": { "field": "TRAN-CDE",
                    "read-bitmap": { "field": "PRI-BIT-MAP", "bits": 32, "value": "C4180000" } } }
]
```

Read as: *extract TRAN-CDE only from records whose PRI-BIT-MAP is exactly
C4180000* — because that value pins the DE layout, which is what makes
TRAN-CDE's offset knowable without walking the record. A record with any other
bitmap does not match, and is not displayed.

The string / object duality is already how the language works elsewhere —
`{ "token-area": "ANY" }` beside `{ "read-bitmap": { ... } }` — so a bare
`"TYP"` for the simple case and an object when a map must be pinned needs no new
convention.

*Note on the shape:* the obvious way to write this,
`{ "add-filter": "TRAN-CDE", { "read-bitmap": ... } }`, is not valid JSON — an
object cannot carry a bare string and an unkeyed object. Hence `field` as a named
attribute.

*Consequence:* one `add-filter` block pins one bitmap. Filtering the same field
across several layouts means one block per bitmap value. Worth watching, since it
grows with the number of message variants; not a blocker.

Block dispatch is a `switch` (`source.html:26163`), so adding the type is
mechanical. The work is not in the block, it is in what happens at save.

### The design decision that makes it viable — resolve the OFFSET at save time

Reading `TYP` normally means running `read-ddl`, which walks the DDL from the
start. Filtering on it that way would mean **parsing all 200,000 records to
decide which ones to show** — slower than the parse that item 17 exists to make
survivable.

So on save, each declared field is resolved to a concrete **offset and length**
and stored with the filter. Filtering is then a byte compare at a known position
— no detection, no DDL walk, no parse — which the existing audit worker can do
inside the single pass it already makes over the file
(`_AUDIT_WORKER_SRC`, which already reads each record's header into the index and
posts progress every 2,000 records).

**What "resolvable" means — three tiers, not one.** The requirement is not that
the offset is CONSTANT, only that it is reachable without a full parse:

1. **Fixed-position fields** — offset known outright from the DDL declaration
   order and PIC sizes. One byte compare.
2. **Fields after a bitmap** — the offset depends on which DEs are present, so
   **the filter carries the bitmap value as part of its definition**. That pins
   the layout, and every DE's offset follows from it. A record whose bitmap
   differs simply does not match, which is the same rule as any other filter: no
   field, no cut.

   This needs no new syntax: it is `read-bitmap`'s existing DECLARED mode, the
   one segmented files already use for a 6.0 non-IDF file whose map lives on the
   IDF rather than in the record —

   ```
   { "read-bitmap": { "field": "FIID-SEG-MAP", "bits": 32, "value": "C4180000" } }
   ```

   `bits` + `value` present means declared: it consumes no payload and supplies
   the map instead of reading it. A filter that pins a bitmap is the same
   statement about a different map. (An earlier draft of this item wrongly
   proposed refusing bitmap-dependent fields outright — that was mine, and it
   would have excluded exactly the fields worth filtering on: response codes,
   amounts, PAN.)
3. **Fields after a variable-length element** (LLVAR / VLG) — the offset varies
   per record, but it is reached by reading each length prefix and hopping, which
   is a handful of reads rather than a DDL walk.

What must still be refused, or flagged as slow, is anything that cannot be
reached by one of those three — not "anything that is not at a constant offset".

### Identity and naming

A filter is identified by the entity's identity plus the field:
**REC-TYPE + NAME + FIELD** — type code and label being the entity identity
settled in v1.21.4.0, with the field appended so one entity can expose several
filters. Display as `ISO 8583 BIC · TYP` rather than a mashed
`ISO-ISO-8583-BIC-TYP`; it scans better in a list.

*Known consequence:* renaming an entity changes its identity and therefore
invalidates saved selections that reference it. Accepted — renames are rare and
the duplicate-identity warning already discourages churn — but it is the same
shape as the import bug fixed in v1.20.3.1, so if selections are ever persisted
across sessions this is where they will break.

### Semantics

- **ANDed** with the existing header filters; no OR/NOT grouping.
- **A record that does not carry the field fails the filter**, exactly like any
  other filter — it does not make the cut and is not displayed. That is what
  keeps a mixed-entity file predictable.
- Operators: **equals, contains, range** as the minimum. Equality alone is
  unusable for amounts and dates.

### UI

The Audit bar gains a custom-filter control. It opens a popup listing every
available filter; the user picks the ones they want and gives each a value. The
bar then shows a summary — "2 custom filters" — with the detail on hover, so the
bar stays compact.

### Relationship to item 17

Both are about not melting an ordinary notebook on a large file, and both land in
the same place. Item 17 chunks the PARSE; this chunks the SEARCH. Doing 17 first
likely makes this easier, since the batching and cancel machinery is shared.

---

## 19. [x] Blocks read past the DE window and are caught afterwards — *done v1.46.30.0*

**Problem.** Inside a `de` entry, `ctx._deLimit` holds the last byte the element
may reach. Exactly two blocks consult it while reading — `read-tlv` and
`token-area`. Every other block (`read-fixed`, `read-to-end`, `read-until`,
`read-ddl`) reads as if the rest of the message were available, and the overrun
is caught only after the entry's blocks have all run:

```
if (ctx.cursor > end) { push "read N byte(s) past the element's length"; ctx.cursor = end; }
```

**Why it matters.** The final cursor is right, so nothing downstream shifts —
this is a diagnosis problem, not a corruption one, which is why it has stayed
parked. But the error names the DE rather than the block, so a spec with four
blocks in one entry says "DE 55 read 30 bytes too far" and leaves the user to
work out which block did it. Worse for `read-to-end`, whose "end" is the end of
the MESSAGE: on a DE near the end of a record it can consume everything left,
succeed, and only then be clawed back — and if the message is short it can throw
before the clamp ever runs.

**Shape of the fix.** One helper for "how many bytes may I still read here",
reading `_deLimit` when set and `bytes.length` otherwise — `read-tlv` and
`token-area` already compute exactly this inline, so it is a third caller rather
than a new idea. Then each read clamps to it and reports itself by name. The
after-the-fact overrun check stays as the backstop.

**Partly answered, v1.39.0.0.** `read-to-end` gained `end_at: "message" | "field"`,
so the frame-bounded read is now *writable* — and that was the point, since the
spec needed a way to say "whatever this element still has". It is **opt-in**: the
default is still `"message"`, so `read-to-end` without the attribute, and every
other read path, still runs past the window and is caught afterwards. The helper
this item describes is still the right shape; `end_at` is a third inline caller,
not the collapse.

**Risk.** Low, but it touches every read path, so it wants the baseline run and
a fixture per block type rather than a single case.

**Done (v1.46.30.0).** `read-fixed` measures its room against the ELEMENT when
it is inside a `de` entry, not the message — so the row it emits can no longer
hold bytes belonging to the next element. `read-to-end` is deliberately NOT
bounded this way: its contract is the end of the MESSAGE, and `end_at: "field"`
is how a spec asks for the element. A test pins that line.

---

## 20. [x] `detectMsgType` still falls back to legacy regexes — *removed v1.46.31.0*

**Problem.** `_fmtDetect` (Class Editor specs) runs first and wins whenever a
spec matches. When none does, both `detectMsgType` and `detectMsgTypeTrace` fall
through to `MSG_TYPE_MAP`, a table built from `_DEFAULT_DETECT_RULES` at startup.

**Why it matters.** Reported 2026-08-18 against the audit browser: type codes
renamed from `ISO` to `ISO-PEPE` / `ISO-MDS` / `ISO-KAKE` were still badged
`ISO`, in the legacy colour, because the badge read that table. The **badge** was
moved to `_fmtDetect` in v1.33.0.0; the **parse path** was not, so the same
mislabelling is still reachable there — a message no spec claims gets a type and
a colour from a hardcoded pattern, and the user has no way to see or edit the
rule that produced it.

**Shape of the fix.** Decide what an unmatched message should be. Almost
certainly `UNKNOWN` — the Class Editor is the single place detection is
configured, and a fallback nobody can see or edit contradicts that. If some
default coverage is genuinely wanted, the honest form is a set of default
*specs*, visible and editable in the Class Editor, which is what
`_fmtDefaultSpecs` already is.

**Risk.** Behavioural: a message currently labelled by the legacy table would
become UNKNOWN. Needs a look at what `_DEFAULT_DETECT_RULES` still catches that
no shipped spec does — if the answer is "nothing", this is a deletion.

**Done (v1.46.31.0).** Removed outright: `_DEFAULT_DETECT_RULES`, `_detectRules`,
`MSG_TYPE_MAP`, `_rebuildMsgTypeMap`, `_loadDetectRules`, the `up_detect_rules`
key and the fallback in both `detectMsgType` and `detectMsgTypeTrace`. A message
no class claims is `UNKNOWN`, and the trace names every class that was tried. No
shipped class lost coverage — one TEST fixture had been riding on the table (70
bytes against the PSTM class's 872-byte floor) and now lifts that guard itself.

---

## 21. [ ] A numeric reference cannot be an expression

**Problem.** Everywhere a spec takes a number — `read-fixed`'s `length`, `skip`'s
`length`, `repeat`'s `count`, `read-while`'s `max`, a `de` entry's `length`, every
`when` comparison — the operand is a literal, one field, or one `{"sizeof"}`.
There is no way to write a number *derived* from those: no subtraction, no
addition, no `min`/`max`.

**Why it matters.** Raised 2026-08-22 while solving the 23-over-22 case in a
spec. The surplus a message carries is `LEN − what the payload declares`, and it
could not be written: the only way to read those bytes was to name a literal
count, which is wrong for every other message. The case was solved instead by
`read-to-end` with `end_at: "field"` — "whatever is left of this element" — which
sidesteps the arithmetic entirely and is the better answer *for that case*.

So this is not blocking anything today. It will block the first case that needs a
computed length rather than a remainder: "read `LEN − 4` bytes and leave the
trailer", "loop `sizeof(TABLE) / sizeof(ROW)` times", "cap at the smaller of the
two lengths".

**Shape of the fix.** Undecided, and worth resisting until a real case arrives —
a spec language that grows an expression grammar has stopped being a description
of a layout. Two shapes that stay small:

- A subtraction on the existing operand object, `{"sizeof": "GRP60", "minus": 4}`
  or `{"field": "LEN", "minus": {"sizeof": "GRP60"}}` — one operator, resolved in
  `_meNumRef` where `sizeof` already lives, and no precedence to define.
- Nothing at all, on the grounds that the remainder forms (`end_at: "field"`,
  `read-until`, `read-to-end`) cover what a layout actually needs, and a spec that
  wants arithmetic is usually describing something the DDL should say instead.

**Risk.** None to existing specs — it is additive. The risk is to the language:
whatever goes in has to be answerable in one place (`_meNumRef`), or every block
grows its own idea of what a number is, which is the fault this codebase keeps
paying for.

---

## Usability / UI backlog

- [x] **Flag specs with missing configuration** — *done v1.1.2.373 / .376 / .377*.
      A `⚠N` badge (same styling as the DDL tree's validation badge, verified
      identical computed styles) in both the Settings → Data Detection list and
      the Data Editor sidebar. Hovering shows one line per gap via the app's own
      tooltip: no recognizer / no parse spec / no DDL binding. Immediately
      surfaced that PSTM, ISO 8583 Switch, Base24 ×3 and NDC ship incomplete.
- [x] **Byte-coverage readout on every parse** — *done v1.1.2.375*, folded into
      item 7 above; generalises the leftover-bytes warning `read-segment-fields`
      already emitted, and also flags the opposite case (fields past the end).
- [ ] Error summary with jump-to at the top of Parse Results, instead of error
      rows interleaved with data rows. Reuse the DDL editor's validation-bar
      pattern (`◀ 1/N ▶` + message), which already exists and works well.
- [ ] Field preview in the DDL picker — currently you choose on score alone.
      Matters more now that a pick can *fill a spec's missing binding*.
- [ ] Make the Data Editor **Test** panel more prominent when authoring a spec —
      it is a collapsed bar at the very bottom, and immediate feedback is the
      whole point when writing a parse-spec.
- [ ] Revisit usability properly: walk a real task end-to-end in the browser
      (e.g. "trace field X across 500 records", "onboard a new message type")
      and report friction, rather than inferring from the DOM.

---

