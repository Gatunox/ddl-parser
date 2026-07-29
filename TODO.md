# TODO — engineering backlog

Deferred work, most valuable first. Each item records *why* it matters, grounded
in a concrete incident rather than general principle, so the cost of skipping it
stays visible.

Status legend: `[ ]` open · `[x]` done · `[~]` partially done

---

## 1. [~] Merge the two parse flows — *decision layer done v1.1.2.392*

**Done so far.** The routing DECISION is now shared: `_parseVerdict` is the one
place a recognized message is classified (`unknown` / `no-spec` / `parsed` /
`needs-ddl`), called by the NETARD, FUP and plain-paste flows alike. The
detection summary is shared too (`_ppDetectDetails`), so a message pasted as raw
text reports the same "Matched as X" as the record it came from. File specs were
folded into the same rules as message specs — an unbound file now prompts for a
DDL instead of being special-cased.

Two bugs surfaced while merging: the record flow crashed (`null.split`) whenever
a bound-DDL warning fired for a spec with no DDL path, stalling the parse
silently after detection; and the plain flow never showed its detection result.

**Still to do.** The two functions keep separate ORCHESTRATION — scoring loops,
picker queues, deferred handling and result assembly, roughly 1200 lines across
`doParseNetardLog` and `doParseMessages`. Lower risk now that the decision is
centralised and the routing tests are in place, but a separate piece of work.

---

## 1b. [ ] (original problem statement, kept for context)

**Problem.** The NETARD flow and the plain-paste flow are near-duplicate
implementations of the same pipeline, and they had silently drifted:

- the plain-paste flow never called the parse-spec engine **at all** — detection
  was spec-driven but parsing always fell through to the legacy DDL walk;
- it also lacked the "bound spec → parse directly, never prompt" short-circuit
  that the NETARD flow had, so a bound spec could raise a DDL picker whose answer
  was then ignored, and a spec with a binding could report *"no matching DDL"*.

**Why it matters.** This is the root cause of the PSTM "all 30 services" report —
not the OCCURS logic. `repeat count: NUM-SERVICES` was correct the whole time; it
simply never executed. Fixing it required applying the same conceptual change at
four separate call sites (v1.1.2.361 / .366).

**Shape of the fix.** One pipeline — `extract bytes → detect → resolve spec →
parse → render` — where the input format decides **only how bytes are extracted**.
Manual DDL override stays the single deliberate exception.

**Risk.** Large refactor of the main parse path. Do it behind the routing tests
(item 2, now in place) and migrate one flow at a time.

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

---

## 6. [ ] Bump `APP_VERSION` from the build script

It is edited by hand in `source.html` on every commit and is the only thing
distinguishing one deploy from another — easy to forget, and nothing catches it.

---

## 7. [x] Show parse provenance in the UI — *done v1.1.2.375*

The Parse Results metadata bar (`#recMetaRow`) now states which parser produced
the fields and how much of the record they account for:

    PSTM | PSTM/PSTM | parse-spec (binary) | 214 bytes        clean
    PSTM | PSTM/PSTM | parse-spec (binary) | 180/214 bytes    amber — 34 unparsed
    PSTM | PSTM/PSTM | parse-spec (ascii)  | 214 bytes ⚠      amber — fields run past the end
    PSTM | PSTM/PSTM | DDL walk            | 214 bytes        legacy fallback
    PSTM | PSTM/PSTM | manual override     | 214 bytes        scope-selected

`parsedBy` is set on every parse path; coverage is computed from the fields, so
it needs no plumbing. No new UI — the existing bar, and it persists (unlike the
progress overlay).

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
