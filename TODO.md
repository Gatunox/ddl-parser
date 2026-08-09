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

## 4. [ ] Give `when` a byte-peek guard

**Problem.** The legacy PSTM parser protects the user-data read with
`bytes[cursor] !== 0x26` — an eye-catcher check the spec language cannot express.

**Why it matters.** Without it a `when` branch can consume the token eye-catcher
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

