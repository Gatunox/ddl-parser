# Message Format Detector & Message Entity — Specification

How the app detects, parses and displays messages and files **as it stands
today**. It describes current behaviour only; how each part came to be, and why
it changed, is in [SPEC-CHANGELOG.md](SPEC-CHANGELOG.md). Section numbers are
kept stable across revisions, so the numbers 10 and 12 are unused — both
described things that no longer exist.

---

## 1. Goals

- Detection is a declarative, byte-level recognizer pipeline, aiming at 100%
  accuracy across every known message format and leaving room for new ones.
- A **Message Entity** — a class — holds a message's detection, parsing rules,
  DDL bindings and field overrides in one place.
- Detection stays fast at **200,000 messages**: recognizers are pre-compiled,
  pure functions.

---

## 2. Parsing Modes

Detection is **automatic** — nothing has to be configured per parse.

| Mode | Trigger | Behaviour |
|------|---------|-----------|
| **Message mode** | Input is NETARD format (log, audit) → always a message. Raw blob where auto-detect returns a known Message type. | Use Message Entity pipeline: recognizers → DDL binding → parse_spec |
| **Chunk mode** | Auto-detect returns UNKNOWN on a raw blob, OR user explicitly selects a DDL (manual override). | Use selected DDL directly. No auto-detection. Scoring against all DDLs if no DDL selected. |

Auto-detect is always attempted first on raw blobs. If it resolves to a known Message → Message mode. If not → require manual override (Chunk mode).

---

## 3. Message Entity Structure

```
Message
  ├── type              short string ≤ 5 chars  (ISO, STM, PSTM, HPDH, NDC…)
  ├── label             display name            (ISO 8583, Base24 STM ATM…)
  ├── color             badge hex color         (#f5c542)
  ├── vol               ATM | POS | SWITCH | BASE
  ├── recognizers       detection pipeline      (see §4)
  ├── parse_spec        declarative parse rules (see §5)
  ├── ddl_bindings      list of DDL paths       (see §6)
  └── overrides         per-field config, keyed by field id (see §7–§9)
```

### 3.1 Identity fields

The `type` short code is the **universal identifier** used everywhere:
- Badge display on parsed messages
- Scoring / DDL resolution chain

---

### 3.2 Message specs vs file specs (`kind`)

`kind` sorts an entity into one of the three sidebar lists: `'file'` is a **file
spec**, `'other'` is a **structure** (Data), and anything else is a message spec.
Only `'file'` changes how detection treats it.

File detection is **filename-keyed**: a file spec matches on the wrapper filename
(`$VOL.SUBVOL.FILE`) via a `filename` recognizer (§4.4) and nothing else. A record
carrying no filename can therefore never be a file, so file specs never sit in
front of — or slow down — message lookup.

It is **not** order-free. Detection walks the Files list
in array order and stops at the first match, so a catch-all pattern ahead of a
specific one decides everything after it. List order is therefore authoritative
and the Files list renders in it — see the changelog for what went wrong while
the display was sorted alphabetically and the walk was not.

Two rules follow:

- a file spec **must** carry a filename recognizer;
- a file spec with neither a DDL binding nor a parse_spec is **inert** — it can
  never claim a record. Both conditions are surfaced as live warnings in the
  editor.

A file spec that matches but carries **no parse_spec** fails as `no-spec`, the
same verdict a message spec gets, and says so in the Parse Results diagnostic —
it does not fall through to the DDL picker.

A manually selected DDL still wins over any file spec (manual override, §2).

---

## 4. Recognizer System (Detection Pipeline)

### 4.1 Engine behaviour

- Specs are compiled once at load, in **sidebar order** — that order is authoritative (`priority` was removed 2026-05-31).
- Per message: iterate specs → run recognizers in order → **first failing recognizer short-circuits that spec**.
- First spec where **all** recognizers pass → detected Message type.
- No match → `UNKNOWN`.
- All recognizer functions are pure: `(bytes: Uint8Array, attrs) → bool`.

### 4.2 Spec-level attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `name` | string | Unique identifier (matches Message `type` short code) |
| `kind` | string | `'file'` marks a file spec (§3.2); absent/anything else = message spec |
| `vol` | string | Default volume for DDL resolution |
| `ddl_bindings` | list | DDL paths (§6) |
| `parse_spec_binary` / `parse_spec_ascii` | block list | Parse spec per input class (§5) |
| `parse_spec_binary_source` / `parse_spec_ascii_source` | string | The JSONC the user typed, kept verbatim so comments and formatting survive a round trip (§13.1) |
| `overrides` | map | Per-field config, keyed by canonical field id: `de` (§7), `vlg` (§8), `type` / `bytes` / `display` (§9) |
| `label` | string | Display name |
| `color` | string | Badge hex color |
| `vol` | string | `ATM` \| `POS` \| `SWITCH` \| `BASE` |
| `recognizers` | array | Ordered list — ALL must pass |

### 4.3 Common recognizer attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `type` | string | Required. Recognizer type (see table below) |
| `offset` | int | Required. **Absolute** byte offset from message start |
| `id` | string | Optional. Name for error reporting |

### 4.4 Recognizer types

#### Structural / byte-level

| Type | What it checks | Key attributes |
|------|---------------|----------------|
| `literal` | Exact byte sequence at offset | `offset`, `value`, `encoding` (`ascii`\|`hex`\|`ebcdic`) |
| `non-printable` | At least one byte in range is not printable in the named charset — ASCII (< 0x20 or ≥ 0x7F) or EBCDIC (the set `isEbcdic` accepts, negated) | `offset`, `length`, `encoding` (`ascii` \| `ebcdic`, default `ascii`) |
| `ascii` | All bytes in range are printable ASCII (0x20–0x7E) | `offset`, `length` |
| `ebcdic` | All bytes in range are valid EBCDIC characters | `offset`, `length` |
| `numeric` | All bytes in range are ASCII/EBCDIC digits | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `alphabetic` | All bytes in range are ASCII/EBCDIC letters (A–Z, a–z) | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `alphanumeric` | All bytes in range are ASCII/EBCDIC letters or digits | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `uint8` | Single byte value or range | `offset`, `eq` \| `min`/`max`, `mask` |
| `uint16` | 2-byte integer | `offset`, `endian` (`big`\|`little`), `eq` \| `min`/`max` |
| `uint32` | 4-byte integer | `offset`, `endian` (`big`\|`little`), `eq` \| `min`/`max` |
| `greater-than` | Decoded byte count **strictly** > N. `> 22` passes 23 bytes, rejects 22 | `value` (`length` also accepted) |
| `less-than` | Decoded byte count **strictly** < N. `< 470` rejects 470 bytes, passes 469 | `value` (`length` also accepted) |
| `min-length` | **Legacy, inclusive (≥ N).** Superseded by `greater-than`; kept so a spec written before the rename still behaves identically. Stored specs migrate as `min-length N` → `greater-than N−1` | `length` |
| `max-length` | **Legacy, inclusive (≤ N).** Superseded by `less-than`. Migrates as `max-length N` → `less-than N+1` | `length` |

**What counts as a byte.** Both length rules compare the **decoded** byte count, never the number of
characters pasted. The input format decides the conversion:

| Input format | Conversion | Example paste | Bytes |
|---|---|---|---|
| ASCII | 1 character = 1 byte | `0200` | 4 |
| HEX | 2 hex characters = 1 byte; whitespace and newlines ignored | `02 00` or `0200` | 2 |
| HEXASCII (tandem dump) | hex pairs only — the address prefix and the `[…]`/`|…|` text column are stripped first | `000000  02 00  \|..\|` | 2 |
| EBCDIC | 2 hex characters = 1 byte, then translated to ASCII — count unchanged | `F0F2` | 2 |
| OCT | 1 whitespace-separated octal token = 1 byte | `060 062` | 2 |

So a 940-character HEX paste is **470 bytes**, and `< 900` passes it — the comparison never sees 940.

**Separating two forms that share a literal.** Give the short form `less-than S+1` and the long form
`greater-than S`, where S is the short form's byte size. The two are then mutually exclusive, so match
**order stops mattering** — relying on order means whichever entry comes first wins every input both
can claim.
| `length-payload` | Length field matches actual payload size | `offset`, `encoding` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `body_offset`, `includes_self` (bool) |
| `flag-payload` | Flag field indicates actual payload presence | `offset`, `encoding` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `body_offset`, `body_length` |

**Aliases (HPE naming):**

| Alias | Maps to |
|-------|---------|
| `byte` | `uint8` |
| `word` | `uint16` |
| `dword` | `uint32` |
| `length-prefix` | `length-payload` |
| `flag-prefix` | `flag-payload` |

The last two are **back-compat**, not HPE naming: those recognizers were renamed
and the old names still evaluate, so existing specs keep working.

#### ISO 8583 semantic

| Type | What it checks | Key attributes |
|------|---------------|----------------|
| `mti` | 4-byte MTI is structurally valid per ISO 8583 (version / class / function / origin digit sets) | `offset`, `encoding` (`ascii`\|`ebcdic`), `value` — 4-char pattern, `#` = any digit (default `####`) |
| `bitmap` | 8 or 16 bytes form a plausible bitmap | `offset`, `encoding` (`binary`\|`ascii-hex`\|`ebcdic`), `length` (`8`\|`16`) |

#### Text / pattern

| Type | What it checks | Key attributes |
|------|---------------|----------------|
| `regex` | Regex against decoded bytes at offset | `offset`, `length` (bytes to read), `pattern`, `encoding` (`ascii`\|`ebcdic`\|`auto`) |
| `hex-density` | Fraction of bytes that are hex chars (`0-9A-Fa-f`) ≥ threshold | `offset`, `length`, `min` (0.0–1.0), `encoding` (`ascii`\|`ebcdic`) |
| `source` | Originating process name (from the NETARD wrapper) matches a wildcard pattern — `$` one alphanumeric, `#` one digit, `*` any sequence; anchored both ends | `pattern`, `id` |
| `destination` | Destination process name, same matching as `source` | `pattern`, `id` |
| `filename` | Guardian-style `$VOLUME.SUBVOL.FILENAME` matches a wildcard pattern (`*` any sequence, `?` any char, `#` any digit). A specific pattern **fails** when the record carries no filename; `*` always matches. This is what makes a record a candidate for a **file spec** (§3.2) | `pattern`, `id` |
| `oct-density` | Fraction of bytes that are octal chars (`0-7`) ≥ threshold | `offset`, `length`, `min` (0.0–1.0), `encoding` (`ascii`\|`ebcdic`) |

### 4.5 `literal` value forms

`value` on `literal` supports four forms. **Wildcards and OR/range do not mix** — if more complexity is needed, use `regex`.

| Form | Example | Meaning |
|------|---------|---------|
| Exact string | `"ISO"` | Single exact match |
| Wildcard string | `"0#0#"` | `?` = any single byte, `#` = any ASCII digit (`0–9`) |
| OR list | `["01", "02"]` | Any of these exact values |
| Range | `["01" to "09"]` | Expands to all values between, inclusive |

Range rules:
- All values in a range must be the **same length** (e.g. `"01" to "09"`, `"A" to "F"`).
- Comparison is lexicographic (correct for zero-padded numerics).
- Mixed-length ranges are **rejected at load time**.
- Ranges and exact strings may coexist in the same array: `["00", "01" to "09", "FF"]`.

---

## 5. Parse Spec (parse_spec)

The parse_spec is a **declarative traversal algorithm**. The DDL is primary — field offset, length, and type (PIC X, PIC 9, BINARY) come from the DDL unless overridden in `overrides` (§9). The parse_spec adds what DDL cannot express: conditionals, loops, sentinel reads, variable sections.

### 5.1 Block types

| Block | Purpose | Key attributes |
|-------|---------|----------------|
| `read-ddl` | Read **all fields from the DDL Bindings** in DDL declaration order — no individual field listing needed | `binding` (int index into `ddl_bindings`, or `"ANY"`), `fields`, `from`, `until` — §5.2; `vlg_identifier` — §8; `overrides` — §8.1 |
| `read` | Read a single DDL-defined field, **or a window of them from the cursor** | `field` (DDL field ID), `from`/`until` (walk a range at the cursor — `from` required, `until` inclusive), `length_prefix` (bytes of length on the wire, absent from the DDL — §5.13), `map` (read this field through another DEF, this read only — §5.22) |
| `read-fixed` | Read N bytes inline — no DDL ref needed | `length` (int literal OR field ID ref), `type`, `encoding`, `as` (DDL field ID) |
| `read-until` | Read bytes until sentinel(s) or EOM | `sentinels` (list of hex bytes), `eom` (bool), `as` (DDL field ID) |
| `read-length-value` | Read length N then N bytes | `length_encoding` (any length encoding — §5.17), `length_size` (1–4, when the name implies no width), `count` (`bytes`\|`digits`), `as` (DDL field ID), `sentinels` (optional stop list), `eom` (bool) |
| `read-bitmap` | Read 8 or 16 bytes as bitmap, store result | `field` (DDL field ID), `encoding` (`binary`\|`ascii-hex`), `length` (explicit width in bytes when the DDL does not declare the map — §5.12) |
| `read-bitmap-fields` | Read all DE fields indicated by a bitmap, resolved via `overrides[…].de` (§7), honouring `overrides[…].vlg` (§8) | `bitmap` (ref to prior `read-bitmap` field ID), `de` (per-bit parsing — §5.14), `vlg_identifier` (§8), `length_mode` (`strict`\|`smart` — §8.2), `overrides` (§8.1) |
| `read-segment-fields` | Read only the segments a prior `read-bitmap` marks present (§5.16) | *(bare string)* or `bitmap` — field id of the declared/file-read map, `binding` |
| `skip` | Advance N bytes | `length` (int, field ID, or `{sizeof}` — §5.19) |
| `stop` | End the run — always, or on a named `condition` | `condition` (`"EOD"` — §5.21) |
| `read-to-end` | Consume remaining bytes | `as` (DDL field ID) |
| `when` | Branch on a prior field value | `field` (field ID), one of `equal` / `not_equal` / `greater_than` / `greater_or_equal` / `less_than` / `less_or_equal` (literal, list, `{field}` or `{sizeof}` — §5.6), `bytes` / `not-bytes` (a guard at the cursor), `then` (block list), `else` (block list — the other branch) |
| `repeat` | Loop N times — N from a prior field | `count` (field ID), `body` (block list) |
| `read-while` | Loop body blocks while a guard predicate matches at the cursor; use when iteration count is unknown or unreliable | `while` (guard), `body` (block list), `max` (int \| field id) |
| `map` | Declare that a field is really shaped like another DDL definition, and read it that way (§5.22) | `field` (the id being replaced), `def` (DEF name, or `VOL/SV/FILE/DEF`) |
| `read-tlv` | Parse a DDL buffer field as repeating TLV triples until buffer exhausted | `field` (buffer; optional inside a `de` entry), `ber` (BER-TLV framing), `tag_length`/`length_length` (fixed-width form), `encoding` (`binary` \| `ascii` \| `ascii-hex`), `tags` (tag → DDL element), `tag_field`/`length_field`/`value_field`, `unknown` — §5.15 |
| `token-area` | Read tokens from the message (see §5.3) | `tokens` (`"ANY"` \| list), `from`, `until` |

**Every** block additionally accepts `at` and `peek` — see §5.11.

### 5.2 `read-ddl` — full DDL binding read

`read-ddl` walks the DDL specified in `ddl_bindings[binding]` and reads every field in declaration order, exactly as the DDL defines them (length, type, encoding). No individual `read` blocks are needed — **`read-ddl` is that list of reads, written once.**

**Where the walk lands.** The DDL is a *layout*, and the layout is anchored where
the spec has reached: `read-ddl` starts at the cursor and every declared offset is
**added** to that anchor. Whatever ran before it counts, exactly as it would
between hand-written reads.

```jsonc
// DDL: A(2) B(2) C(2) — declared offsets 0, 2, 4
[{"read-ddl": {"binding": 0}}]                    // A@0  B@2  C@4
[{"skip": 4}, {"read-ddl": {"binding": 0}}]       // A@4  B@6  C@8
[{"read-ddl": {"binding": 0, "at": 10}}]          // A@10 B@12 C@14
```

`from` is not special: it names a field *inside* the layout, so its declared
offset is added like any other. `{"skip": 4}` then `{"read-ddl": {"from": "B"}}`
reads B at 4 + 2 = **6**. At the top of a message the anchor is 0 and every
declared offset stands exactly as written.

Contrast `read {from, until}` (§5.7), which walks from the cursor rather than
anchoring a layout — that is what the two blocks are for, and why both exist.

Use this for messages where:
- All fixed fields are fully described in the DDL
- There are no conditionals, loops, or sentinel-delimited sections in the fixed area
- Only the post-fixed section (token area, variable buffers) requires explicit parse_spec blocks

**Attributes:**

| Attribute | Type | Default | Meaning |
|-----------|------|---------|---------|
| `binding` | int \| `"ANY"` | `"ANY"` | Index into `ddl_bindings`. `"ANY"` walks every binding in order. |
| `fields`  | `"ANY"` \| array of field ids | `"ANY"` | Cherry-pick: list of DDL field ids to emit. `"ANY"` emits all. |
| `from`    | field id | — | Inclusive lower bound: emission starts at this field. |
| `until`   | field id | — | Inclusive upper bound: emission stops after this field. |
| `vlg_identifier` | string | *(built-in names)* | Which leaf name means "this holds the group's length". `""` switches the guess off entirely — see §8. |

The byte cursor always advances through every field in declaration order so that later parse_spec blocks (`when`, `repeat`, `read-tlv`) can reference any field id — `fields` / `from` / `until` only filter what is emitted to the output.

**Cherry-pick takes precedence over `from`/`until`.** If `fields` is an array, `from` and `until` are ignored.

**Use `"ANY"`** (not `null`) when you want defaults — `null` is accepted for backwards compatibility but `"ANY"` is the canonical form.

```json
[
  { "read-ddl": "ANY" },
  { "token-area": "ANY" }
]
```

Two bindings (header + body), then tokens:

```json
[
  { "read-ddl": { "binding": 0 } },
  { "read-ddl": { "binding": 1 } },
  { "token-area": "ANY" }
]
```

Cherry-pick three fields:

```json
[
  { "read-ddl": { "fields": ["MTI", "PAN", "AMOUNT"] } }
]
```

Emit a contiguous window between two fields:

```json
[
  { "read-ddl": { "from": "TYP", "until": "TIM-OFST" } }
]
```

### 5.3 `token-area` — token read with filters

Reads the message's token area (tokens are the named 2-byte-prefixed records produced after fixed-section parsing).

**Where the area is depends on the TYPE CODE**, so the block needs it: `STM` /
`PSTM` put the tokens after the last field, `ISO` / `B24` inside DE-63 or DE-126,
and anything else has no token area at all. A saved spec stores that code as
`name`; `type` is what *detection* builds from it. The block reads `type` first,
then `name`.

**Attributes:**

| Attribute | Type | Default | Meaning |
|-----------|------|---------|---------|
| `tokens` | `"ANY"` \| array of token ids | `"ANY"` | Cherry-pick: list of token ids to emit. `"ANY"` emits all. |
| `from`   | token id | — | Inclusive lower bound. |
| `until`  | token id | — | Inclusive upper bound. |

**Use `"ANY"`** (not `null`) for defaults — `null` is accepted for backwards compatibility but `"ANY"` is the canonical form.

```json
{ "token-area": "ANY" }
{ "token-area": { "tokens": ["B4", "C0", "F1"] } }
{ "token-area": { "from": "B4", "until": "ZZ" } }
```

Cherry-pick takes precedence over `from`/`until`.

### 5.4 `read-fixed` — length, type, encoding

`length` accepts:
- **Integer literal**: `length: 4`
- **Field ID reference**: `length: LEN-FIELD` — uses the parsed value of that field as the byte count. The referenced field must have been read earlier in the same parse_spec.

`type` and `encoding` say how the consumed bytes are interpreted. Both are routed through the
same converter a per-field type override uses, so `read-fixed` and the Overrides panel can never
render the same bytes differently.

| Attribute | Value | Meaning |
|-----------|-------|---------|
| `type`     | `X` \| `9`  | Text or digits, rendered as characters. The default. |
| `type`     | `BINARY`    | Raw bytes, rendered as a hex dump. Wins over any `encoding`. |
| `encoding` | `ascii`     | Printable ASCII, `.` for anything else. The default. |
| `encoding` | `ebcdic`    | Translated EBCDIC → ASCII. |
| `encoding` | `bcd`       | **Not implemented** — reported as an error row rather than silently ignored. |

### 5.5 `read-until` — multiple stop conditions

Any stop condition ends the read. All are optional but at least one must be specified.

```yaml
- read-until:
    sentinels: [0x1C, 0x1D]   # stop on any of these bytes
    eom: true                  # also stop at end of message
    as: BUFFER-A               # DDL field ID for metadata
```

`sentinels` entries accept decimal integers (`38`), bare hex strings (`"26"`) and
`0x`-prefixed hex strings (`"0x26"`) interchangeably. The same rule applies to
`read-length-prefix.sentinels`.

### 5.6 `when` — condition forms

```yaml
when: FIELD-ID
  equal: "1"                     # exact match
  equal: ["1", "2", "3"]         # set match (any of)
  not_equal: "B"                 # negation
  not_equal: ["1", "2", "3"]     # negation set
  starts_with: "02"              # text prefix (list / {field} allowed)
  ends_with: ["01", "02"]        # text suffix (list / {field} allowed)
  greater_than: 22               # numeric, strict
  greater_or_equal: {field: MAX} # numeric, against another field
  less_than: {sizeof: EMV.DATA}  # numeric, against what the DDL declares
  less_or_equal: 22
  then: [...]                    # block list to execute if condition matches
  else: [...]                    # block list to execute if it does not
```

Multiple `when` blocks on the same field act as if/else-if. Nested `when` blocks are supported.

**The byte guard — `bytes` / `not-bytes`.** The other kind of condition: it looks
at what is sitting **at the cursor** and consumes nothing, so it needs nothing to
have been read and works as the first block of a spec. It is how a spec looks
before it leaps — deciding whether an optional element is present before a block
consumes those bytes as though it were.

```json
{"when": {"not-bytes": {"type": "literal", "value": "& "}, "then": [ … ]}}
```

The same object is `read-while`'s `while` — one predicate, one matcher, one lint.

| Key | Applies to | Meaning |
|-----|------------|---------|
| `length` | all | The window: how many bytes from the cursor. Omitted, **1** — except `literal`, which uses its own `value`'s length. Fewer bytes left than the window is **no match**, never an error. |
| `type` | — | `literal`, `regex`, `numeric`, `alphabetic`, `alphanumeric`, `ascii`. Anything else never matches. |
| `value` | `literal` | The window must equal it exactly. |
| `pattern` | `regex` | Tested against the window, **unanchored** — it matches anywhere inside, so write `^` yourself for "starts with". A pattern that will not compile never matches; the lint reports it. |
| `encoding` | all but `ascii` | `ascii` (default) or `ebcdic` — how the bytes become characters before matching. |

`numeric` / `alphabetic` / `alphanumeric` test the **whole window**, so with the
default one-byte window they ask about a single character. `ascii` asks whether
every **byte** is printable (`0x20`–`0x7E`) and therefore ignores `encoding`.

The literal default is load-bearing: `{"type":"literal","value":"& "}` compares
**two** bytes — the length of its value — so it needs no `length: 2`.

**One operand grammar, eight operators.** Every operator takes
the same operand shapes:

| Operand | Means |
|---------|-------|
| `"1200"` / `22` | a literal |
| `["A", "B"]` | a list — any one of them. **Text comparisons only**; a range is two operators or two nested blocks |
| `{"field": "OTHER"}` | another field already read |
| `{"sizeof": "EMV.DATA"}` | what the **DDL declares** for an element, in bytes (§5.19) |

`equal` / `not_equal` / `starts_with` / `ends_with` compare as **text**, both sides
trimmed, so a padded `PIC X` still matches; matching is case-sensitive. The other
four compare as **numbers**, and both sides are
read through the same chain as every other numeric reference in a spec: an
explicit `as`, else the field's own Type override, else a guess that reports
itself on the row (§5.17). A side that yields no number is an **error row naming
which side** — a broken condition and a false condition must not look the same
from the outside, since both show up only as a branch that did not run.

**One comparison per block.** Two on the same `when` is an error, not an implicit
`and`; nest a second `when` inside `then`.

`else` runs the other branch. Both branches read from the **same cursor**, and
exactly one of them runs; omitted, a false condition reads nothing and the bytes
go to the block after this one. A condition that cannot be **answered** — an
operand field never read, an element no DDL declares — runs **neither** branch
and reports why: not knowing is not the same as false.

With **no** comparison the block is a **presence test**: the field was read, so
`then` runs.

`is` and `not` are not accepted: the lint and the engine both report them and name
`equal` / `not_equal` instead. They are reported rather than ignored because `is`
left in place leaves the block with no operator — the presence test — so `then`
would run unconditionally.

### 5.7 `read` — the DDL gives structure, the cursor gives position

**The DDL supplies structure — length, type, sub-fields. The cursor supplies
position. `at` (§5.11) overrides position explicitly.** A field's declared offset
is never used to place a read.

This is what makes `skip` mean anything. A spec stepping over a header the DDL
does not describe:

```jsonc
[{"skip": {"length": 9}}, {"read": "SDLC-DEST"}, {"read": "SDLC-ORIGIN"}]
```

reads `SDLC-DEST` at byte 9. Reading a field in the middle without listing what
precedes it is what `at` is for.

`read-ddl` (§5.2) obeys the cursor too, by anchoring the whole
DDL layout at it. The two are not the same operation: `read` places one field at
the cursor, `read-ddl` places a *layout* there and adds each declared offset to
it. `read {from, until}` is the cursor-relative window; `read-ddl {from, until}`
is a window inside an anchored layout.

`read` on a **group** resolves its structure from the DDL and reads it at the
cursor, the same as a single field:

| DDL structure of FIELD-ID | Behaviour |
|--------------------------|-----------|
| Simple group (sub-fields, no REDEFINES/OCCURS) | Reads all sub-fields sequentially from the cursor |
| Group with OCCURS | Each `read` consumes the next occurrence, sequentially |
| REDEFINES another field | Seeks to the redefined field's offset, reads sub-fields from there |
| REDEFINES + OCCURS | Seeks to the redefined offset, reads the OCCURS block N times |

REDEFINES keeps its seek: an overlay is *defined* as a second view of bytes
another field already covers, so its position is the point of it.

Reading the same non-repeated group twice therefore advances — the second read
takes the next bytes — rather than repeating or reporting "all occurrences read".

### 5.8 `read-while` — guard-bounded loop

For variable-count loops where a count field is **unavailable or unreliable** (canonical case: ASCII PSTM where `NUM-SERVICES` is binary and the only way to know if another service follows is to peek at the next 2 bytes for the service-tag convention).

The guard is evaluated **before** each iteration. The body must advance the byte cursor or the loop aborts (prevents infinite loops on misconfigured specs). Stops at first guard miss, `max` iterations, EOM, or a hard cap of 10000.

**Attributes:**

| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| `while` | object | yes | Guard predicate at cursor (see below) |
| `body`  | array of blocks | yes | Executed each iteration |
| `max`   | int \| field id | no | Iteration cap. If a field id and that field is missing or non-numeric (e.g. binary read in ASCII mode), no cap is applied — guard + hard cap still bound the loop. |

**Guard predicate types** (all check N bytes starting at the cursor):

| `while.type` | Matches when… | Extra attrs |
|--------------|---------------|-------------|
| `alphabetic` | All N bytes are A-Z or a-z | `length` |
| `numeric` | All N bytes are 0-9 | `length` |
| `alphanumeric` | All N bytes are A-Z, a-z, or 0-9 | `length` |
| `ascii` | All N bytes are printable ASCII (0x20–0x7E) | `length` |
| `regex` | Decoded text matches the JS regex | `length`, `pattern` |
| `literal` | Decoded text equals the value exactly | `length`, `value` |

`while.encoding` (default `ascii`) — `ascii` or `ebcdic`; converts bytes before the check.

**PSTM ASCII services loop:**

```json
{
  "read-while": {
    "while": { "type": "regex", "length": 2, "pattern": "^[A-Za-z*]{2}$" },
    "max":   "NUM-SERVICES",
    "body":  [ { "read": "SRVCS" } ]
  }
}
```

In ASCII mode `NUM-SERVICES` is binary and unreliable so `max` evaluates to no cap — the loop continues as long as the next 2 bytes look like a service tag. In hex/binary mode the field is reliable and `max` actually caps the loop. The guard stops the loop when the token area `& ` eye-catcher (or anything non-service-like) appears.

### 5.9 Reliability model

Reliability is **derived from the operation type and field type** — no explicit flag needed.

| Condition | Result |
|-----------|--------|
| `read-length-value` with binary prefix (`uint16-be` etc.) in ASCII input format | All fields in that block → `unreliable: true` |
| `field_override` with binary type (`uint32-be`, `uint16-be`, etc.) in ASCII input | That field → `unreliable: true` |
| DDL field declared as `BINARY` in ASCII input | That field → `unreliable: true` (existing behaviour, unchanged) |
| `token-area` — individual tokens with binary content | Marked unreliable at token definition level (existing behaviour, unchanged) |

ASCII-class formats: `ascii`, `netard-ascii`, `netard`.  
Binary-class formats: `hex`, `hexascii`, `netard-hex`, `netard-hexascii`, `ebcdic`, `tandem-dump`, audit.

#### 5.9.1 Decoding binary numeric fields as counts / lengths

`repeat.count`, `read-fixed.length` (when given a field-id reference), and `read-while.max` resolve a field id to an integer using this rule:

1. If the field's rendered value is pure ASCII digits (e.g. `"042"`) → `parseInt(value, 10)`.
2. Otherwise, decode `rawHex` as a **big-endian unsigned integer** (up to 6 bytes). A 2-byte field whose raw bytes are `0x00 0x42` (rawHex `"0042"`) resolves to `66` — its uint16-be value.
3. Otherwise (missing field, non-numeric content) → `null`. Callers treat this as either zero or an error depending on the block (`repeat` errors out, `read-while.max` falls back to "no cap").

This means the **same parse_spec works** for ASCII and binary inputs of the same logical message, as long as the spec author respects the reliability table above:

- In a **binary/hex** input, a 1-byte `NUM-SERVICES` containing `0x03` decodes to `3`, so `repeat: { count: "NUM-SERVICES" }` runs 3 iterations.
- In an **ASCII** input, that field's bytes are noise from the reliability standpoint; spec authors should use `read-while` with a guard predicate instead of referencing the unreliable count.

### 5.10 Example parse_specs

**ISO 8583 standard ASCII:**
```yaml
parse_spec:
  - read-bitmap:
      field: BITMAP
      encoding: ascii-hex
  - read: MTI
  - bitmap-fields: BITMAP
```

**PSTM (Base24 POS):**
```yaml
parse_spec:
  - read: MTI
  - read: PRODUCT-CODE
  - read: <all fixed-section DDL fields by ID>
  - when: USER-FLG
    is: "1"
    then:
      - repeat: NUM-SERVICES
        body:
          - read: <services OCCURS group field ID>
      - read-length-value:
          prefix: uint16-be
          as: USER-DATA.BUFFER
          sentinels: [0x26, 0x20]
          eom: true
  - token-area: ANY
```

**TLV buffer (e.g. DE-55 EMV data):**
```yaml
parse_spec:
  - read: MTI
  - read-bitmap:
      field: BITMAP
      encoding: ascii-hex
  - bitmap-fields: BITMAP
  - read-tlv:
      field: DE-55           # DDL buffer field containing TLV data
      tag_length: 4          # 4 bytes per tag
      length_length: 2       # 2 bytes per length
      encoding: binary       # binary | ascii-hex
      # repeats TAG(4) + LENGTH(2) + VALUE(LENGTH) until buffer exhausted
      # or fewer bytes remain than tag_length
```

**NDC (conditional buffers):**
```yaml
parse_spec:
  - read: MESSAGE-CLASS
  - read-until:
      sentinels: [0x1C]
      eom: true
      as: BUFFER-A
  - when: MESSAGE-CLASS
    is: "1"
    then:
      - read-until:
          sentinels: [0x1C]
          eom: true
          as: BUFFER-B
    is: "2"
    then:
      - read-until:
          sentinels: [0x1D]
          eom: true
          as: BUFFER-1
      - read-until:
          sentinels: [0x1D]
          eom: true
          as: BUFFER-2
      - read-until:
          sentinels: [0x1C]
          eom: true
          as: BUFFER-3
```

---

### 5.11 Explicit positioning — `at` / `peek` (every block)

Every block reads where the previous one stopped. That stays the default and is
what every existing spec relies on. `at` overrides it:

| Form | Meaning |
|------|---------|
| `"at": 23` | Absolute byte position, **0-based** — matches DDL Doc offsets and the raw dump, so what you read off the screen is what you type |
| `"at": {"field": "HDR"}` | Immediately after `HDR` ends |
| `"at": {"field": "HDR", "offset": 10}` | 10 bytes past the end of `HDR` (negative allowed) |
| `"at": {"field": "HDR", "from": "start", "offset": 4}` | 4 bytes into `HDR`, measured from its first byte |

The anchor must be a field an **earlier** block produced. Resolution is done once
in the block dispatcher, so it applies to every block type — including `skip`,
which then needs its object form: `{"skip": {"length": 2, "at": 10}}`.

`read-ddl` included: it anchors its layout at the position `at` resolves to — see
§5.2.

The cursor **stays** where the positioned read ends, so following blocks continue
from there. `"peek": true` restores it afterwards, for an overlay read that must
not disturb the sequence.

A position that cannot be resolved — past the end, negative, an anchor not yet
read, a bad `from` — reports why and **skips the block**, rather than reading from
a wrong offset.

### 5.12 `read-bitmap` — explicit width

`"length": N` states the map's width in bytes for a bitmap the **message carries
but the DDL never declares**. The field need not exist in the bound DDL (the
strict existence check is waived) and the row is synthetic.

Because such a map is by definition not ISO 8583, two ISO-only rules are turned
off: bit 0 is **not** read as "a secondary bitmap follows" (so the read is never
silently doubled) and bit 1 is kept as ordinary data instead of being dropped as
the secondary-present indicator.

`at` and `length` are independent — `at` says *where*, `length` says *how wide*.

### 5.13 `length_prefix` — a length on the wire, absent from the DDL

Accepted by `read` and by a `de` entry (§5.14). Once a group's tags are mapped to
elements its LEN leaf holds nothing worth keeping, so the DDL may legitimately
omit it — but the bytes are still on the wire, and nothing else could say so.

`"length_prefix": 4` means *four bytes of length sit here*; the payload is then
framed by what they say instead of by the declared sizes. The prefix is emitted as
its own row (`<field>.LEN-PREFIX`) — consuming bytes without a row is how four
bytes of every STM record went missing under `RTE-GRP` (see changelog 2026-08-01).

Sub-fields share the framed window in declaration order, each taking what it
declares or what remains, whichever is smaller. A length past the end of the
message is reported and clamped; bytes inside the window that no sub-field claims
are reported rather than silently skipped.

**Decoding** is the single rule shared with variable-length groups (§8): ASCII digits
parse as digits — which also covers EBCDIC, translated to ASCII upstream — and
anything else is a big-endian integer.

> *Extended 2026-08-17 — the encoding can be stated.* A bare number is the width
> alone and leaves the rule above to guess, which cannot tell `00 74` meaning 74
> from the same bytes meaning 116. The object form states all three questions in
> the same words `read-length-value` uses (§5.17):
>
> ```jsonc
> "55": {"length_prefix": {"bytes": 2, "type": "hex-char", "count": "bytes"},
>        "blocks": [ … ]}
> ```
>
> `"length_prefix": 2` remains valid and still auto-detects.

### 5.14 `read-bitmap-fields` — per-bit parsing (`de`)

```jsonc
{"read-bitmap-fields": {"bitmap": "BITMAP", "de": {
  "55": {"field": "EMV-ELEMENT", "length_prefix": 2, "blocks": [
    {"read-tlv": {"ber": true,
      "tags": {"9F26": {"field": "ARQC"}, "9F36": {"field": "ATC"}}}}]}}}}
```

Keys are **bit numbers**. A listed bit is read by its own blocks; every other set
bit is read exactly as before. The bare array form (`"55": [ … ]`) is shorthand
for `{"blocks": [ … ]}`.

The DE-to-element relation still comes from the Overrides panel (`overrides[…].de`, §7) —
this only says how that element's bytes are read. An optional `field` overrides
which element the bit maps to.

**`token-area` inside an entry reads the DE's own bytes** *(2026-08-17)*. At the top
level the block derives the area's position from the message type — ISO/B24 inside
DE-63/126, STM/PSTM after the last field — and from the rows already emitted. Inside
a `de` entry none of that applies: the cursor is on the element's first byte and the
window is its last, which is the whole point of an entry, so the area is simply what
this DE holds. It consumes what it reads, so a DE framed only by a declared size
still ends in the right place. See §5.18 for the header shape.

**A DDL element is not required.** Whether one is needed is the *block's* business,
and the blocks already say so themselves: `read-length-value`, `read-fixed`,
`read-until` and `read-to-end` name their own output through `as` and need nothing
declared — exactly how they behave at the top level of a spec, and a bit must mean
the same thing in both places. Blocks that map bytes *onto* declared fields —
`read`, `read-ddl`, `read-tlv` with `tags` — still need one and report it in their
own words, naming the element they could not find. This is the case a `de` entry is
most needed for: a proprietary DE that is on the wire and nowhere in the DDL. With
no element, rows the engine emits itself are named after the bit (`DE-58.LEN-PREFIX`),
and short names inside the blocks resolve against the DDL as a whole.

**Names inside the entry resolve within that element**, so `ARQC` means
`EMV-ELEMENT.ARQC`. Only leaves are compiled, so a group is recognised by the
prefix on its children's ids.

**The engine frames the element, the entry only interprets it.** Where a DE starts
and ends is the same question for every DE and the engine already knows it — from
the bitmap walk plus the group's LEN, honouring the same `vlg`
configuration the default walk uses. The entry's blocks then run inside that
window, and a block that reads **too far** is reported and stopped at the boundary
instead of consuming the DEs that follow — whatever the window was.
Window precedence: `length_prefix` → the group's VLG LEN → an explicit `length` →
the element's declared size.

A length the **message** states cannot exceed the message: that is malformed and
reported. A size the **DDL** declares is only capacity — a message carrying fewer
tags than the DDL has room for is normal — so it is clamped silently.

**Where the next DE starts depends on which of those the window came from**, and
the distinction is the whole point of the previous paragraph:

| Window | States | Next DE starts |
|--------|--------|----------------|
| `length_prefix`, or the group's VLG LEN | what the DE **is** — the message said so | at the end of the window, whatever the blocks read |
| an explicit `length` on the entry | what the DE **is** — you said so | at the end of the window, whatever the blocks read |
| the element's **declared size** | what the element **can hold** | where the blocks actually stopped |

### 5.15 `read-tlv` — BER framing and tag → element mapping

> *Extended 2026-08-01.*

`"ber": true` parses EMV BER-TLV: a tag is one byte unless its low five bits are
all set (`0x1F`), in which case continuation bytes follow while the top bit stays
set; a length below `0x80` is that byte, `0x8N` means the next N bytes hold the
length. A fixed `tag_length` mis-frames the first 1-byte tag (e.g. `82`) and every
triple after it silently becomes garbage — so `ber` is required unless both
`tag_length` and `length_length` are given.

`tags` files each triple into a DDL element instead of emitting anonymous
`<buffer>.<tag>` rows:

| Attribute | Meaning |
|-----------|---------|
| `tags` | `{"9F26": {"field": "ARQC"}}` — tag → element receiving it |
| `tag_field` / `length_field` / `value_field` | Leaf names when they are not `TAG`/`TAG-ID`, `LEN`/`LGTH`/`LENGTH`, `DATA`/`VAL`/`VALUE`. Settable per read-tlv or per tag |
| `unknown` | `emit` (default), `skip`, or `error` for a tag `tags` does not mention |

**Whether the tag itself is stored is read from the DDL**, not stated in the spec:
a subgroup that declares a TAG leaf receives it; one that does not is already
identified by its element. There is deliberately no `store_tag` attribute — it
could only ever disagree with the DDL.

**The value leaf is found by elimination when its name is not in the list**
. A TLV subgroup holds the three parts of one triple, so once
the tag and the length are accounted for, whatever single leaf is **left** is the
value — whatever the DDL calls it. Reported against a subgroup of
`TAG` / `LEN` / `TAG-DATA`: the first two matched by name, the third matched
nothing, and the value was emitted under the **group** id — so an override set on
the leaf matched nothing and silently did nothing while the Overrides table said
it was applied.

Only when exactly one leaf remains; zero or several is not a triple this can
read, and guessing which one holds the value would be worse than saying so. Depth
is not filtered: the binding defs are leaves, so a value declared as a group
appears only as `PAYLOAD.INNER`, never `PAYLOAD`. When nothing resolves, the row
still lands on the group and its description says so.

**Every row honours its overrides**. `read-tlv` was the only
read path that never ran the type and display override pass, so nothing it
emitted was reinterpreted — not the mapped values, not the tags, not the lengths,
nor the buffer length in front of them. Synthetic rows have no DDL def and are
keyed by the id they are given, so an override on that id works like any other.

**An unmapped tag is one row spanning its whole triple** — tag, length and value —
so every byte belongs to a row and the input highlight never jumps over one.
`valueLength` deliberately stays the **value's** length: it means that
everywhere else in the engine — a decimal TLV length is checked against it — so
only the byte range widened.

`field` names the buffer and is **optional inside a `de` entry**, where the element
being read is itself the buffer.

**`encoding` — how the tag and length are written**

| Value | Tag | Length | Value | `tag_length` / `length_length` count |
|-------|-----|--------|-------|--------------------------------------|
| `binary` (default) | raw bytes (`9F 26`) | big-endian integer | raw bytes | bytes |
| `ascii` | characters (`"0002"`) | **decimal digits** (`"0005"` is five) | characters, read as text | **characters** |
| `ascii-hex` | hex characters (`"9F26"`) | big-endian over the decoded bytes | decoded bytes | **decoded** bytes (4 hex chars = 2) |

`ascii` is the shape production ISO 8583 carries for text sub-elements —
`0002 0005 HELLO 0003 0004 VISA`. Neither other mode can read it: `binary` reads
`"0005"` as the big-endian integer `0x30303035`, and `ascii-hex` hex-decodes the
whole buffer, which turns `HELLO` into garbage.

In `ascii` mode the tag is keyed by **its characters**, so `tags` is written
`{"0002": {"field": "CARD-TYPE"}}`. Keying it by a hex rendering of those bytes
(`"30303032"`) would be unwritable in practice, and a mismatched key fails silently
— the triples simply come out as unmapped rows.

A length whose characters are not digits is **reported**, not read as zero: a
silent zero would collapse the value and shift every triple after it, which is how
the variable-length-group length bug behaved before it was found (§8).

**Byte positions.** Result rows carry `startByte`/`endByte` in `binary` and `ascii`
mode, where offsets map 1:1 onto the message. `ascii-hex` decodes the buffer first,
so no decoded byte corresponds to a single message byte and the positions are
omitted rather than guessed.

### 5.16 Segmented files — `read-bitmap` declared/file-read modes + `read-segment-fields`

A Base24 segmented file stores a record as a set of **segments**, only some of
which are present. A 32-bit map says which. The DDL declares every segment as a
top-level field named `SEG0`, `SEG1`, `SEG5`, … — declared segments need not be
consecutive, and the trailing number is the bit index.

`read-segment-fields` walks those top-level fields and reads only the segments
whose bit is set, each as its full TYPE-expanded structure **at the cursor** (DDL
offsets are ignored — they assume every segment is present). A clear bit consumes
nothing. Top-level fields with no trailing number are always read. Leftover bytes
after the last mapped segment are flagged, since that usually means the map is
missing a segment.

**Where the map comes from — `read-bitmap` has three modes:**

| Mode | Triggered by | Behaviour |
|------|--------------|-----------|
| **Wire** | neither `bits`/`value` nor a segmented binding | Read from the record at the cursor (§5.1) |
| **File-read** | a segmented binding, no declared `value` | Read the named field **from the record at its DDL position** — the map is part of the data |
| **Declared** | `bits` + `value` present, or a parse-time SEG-MAP input | The value comes from the spec or the SEG-MAP bar and **zero record bytes are consumed** |

This covers the three Base24 cases:

| Case | Where the map lives | Spec |
|------|--------------------|------|
| Non-IDF, pre-6.0 | `SEG-MAP` **in the record** | file-read mode on `SEG-MAP` |
| IDF, 6.0 | `FIID-SEG-MAP` **in the record** | file-read mode on `FIID-SEG-MAP` |
| Non-IDF, 6.0 | not in the record — `SEG-MAP` is zeroed | declared mode: `bits` + `value`, or typed into the SEG-MAP bar |

File-read uses the field's **declared TYPE** (e.g. `BINARY 32`), big-endian, bit 0
= the leftmost bit of the first byte. `encoding` is not consulted. The field name
is trusted — there is no auto-detection — and an all-zeros map is an **error**,
never a silent fallback to "all segments present", because that is exactly the
6.0 signal that the map lives elsewhere.

A REDEFINES field carrying the map is emitted as an overlay row at its true
position, so the map is visible where the DDL puts it.

**Naming the map**.
`{"read-segment-fields": "SEG-MAP"}` is the shorthand: a bare string holds one
value and the block already knows what that value is, so it needs no key. The
object form takes the same value as **`bitmap`** — the word `read-bitmap-fields`
already uses for the same thing — and exists for one reason: the moment you need
to say a *second* thing, one string has nowhere to put it and no way to label
which is which.

```jsonc
{"read-segment-fields": "SEG-MAP"}                          // the map, and nothing else
{"read-segment-fields": {"bitmap": "SEG-MAP", "binding": 0}} // a second thing to say
```

With neither, the block falls back to the most recent map any `read-bitmap`
produced — which is what you want whenever the spec has only one.

**`binding` — only with more than one bound DDL.** Segments are matched by
**name**: the trailing number on a top-level field. Two bound DDLs that both
declare `SEG0` both answer to bit 0, so both are read, one after the other, over
different bytes. `binding` says which one describes this file. With a single
binding — the ordinary case — it changes nothing.

`read-bitmap-fields` needs no such attribute because DEs are matched by
**number**, and the DE map holds one field per number (`if (map[row.de] !==
undefined) continue`) — a second binding cannot claim a number the first already
took. That is also why ISO binds two DDLs happily: `ISOPSEM` is DE 1–64,
`ISOSSEM` is DE 65–128, so they continue each other. Names collide; numbers do
not. `map` is not an
attribute of this block — it is a block of its own (§5.22) — so a stray `map` key
is ignored and the fallback above applies.

**SEG-MAP bar.** Parse Results shows an inline SEG-MAP input whenever the parse
used a segmented map — spec-driven or a manually selected segmented DDL. A value
typed there overrides the map for that parse; blank falls back to the spec's value
(declared mode) or to the file's own map (file-read).

**Manual override** on a segmented DDL walks the full DDL once, all segments
assumed present, since no spec is consulted. Typing a map in the SEG-MAP bar is
what narrows it to the present segments.

---

### 5.17 Reading a length off the wire — one vocabulary

Every length the engine reads off the wire answers the same three questions, and
they are now asked in the same words wherever they are asked: **how many bytes** to
take, **how to decode** them, and **what the number counts**.

| Question | `read-length-value` | `length_prefix` (§5.13) | `read-tlv` `len` (§5.15) | A VLG LEN leaf (§8, §9) |
|----------|----------------------|-------------------------|--------------------------|---------------------|
| How many bytes | `prefix_len` | `bytes` | `bytes` | the DDL's declared size |
| How to decode | `prefix` | `type` | `type` | `type` |
| What it counts | `count` | `count` | `count` | `count` |

**The encodings are the app's, not any one block's** — every name the Overrides
**Type** column offers reads a length: `uint8` · `uint16-be` · `uint16-le` ·
`uint-be` · `uint-le` · `binary` · `ascii` · `ebcdic` · `hex-char` ·
`hex-ascii-decimal` · `hex-ebcdic-decimal`. `read-length-value` adds `bcd2`
(2 bytes of packed BCD), which is the one shape the shared decoder does not know.

**Width.** `uint8` implies 1, `uint16-*` and `bcd2` imply 2, `uint32-*` imply 4.
Every other name says how the bytes *read*, not how many there are, so it needs an
explicit width — the lint reports a missing one rather than letting the parse guess.

**`count`.** `bytes` (the default) means 74 is 74 bytes of payload; `digits` means
74 hex digits, so 37 on the wire. Converted once, at the point of decoding, so every
bound downstream stays byte-based. The row still reports the number the message
spells (`74 digits = 37 bytes`) — that is the number the user can see in the bytes.

> *Why this exists.* `read-length-value` decoded with a private four-case switch —
> `uint8`, `uint16-be`, `uint16-le`, `bcd2` — while VLG lengths, `length_prefix` and
> the Type column all went through the shared decoder, which had read `hex-char`
> since it was written. Two implementations of one fact, and the narrower one was
> the only way to read a length in front of a payload: a 2-byte `00 74` meaning 74
> could only be read as 116, which swallowed the rest of the message, and no
> attribute existed to say otherwise. Reported against a customized HPDH DE-58.

---

### 5.18 The token-area header — `binary` vs `text`

After the `&·` eyecatcher come a **token count** and a **total size**, and they are
written two different ways with nothing on the wire announcing which:

| | count + size | bytes |
|---|---|---|
| STM / PSTM | two 2-byte integers | 4 |
| ISO / B24 | two 5-character numbers | 10 |

**This is not the input format.** `extractBytes` has already turned hex, EBCDIC, a
tandem dump or plain ASCII into the same byte array before any block runs, which is
why one spec reads a message pasted in any of them.

The shape is chosen in this order:

1. **`header`** on the block — `"binary"` or `"text"`. Forces it.
2. **The class's type code** — STM/PSTM binary, ISO/B24 text. Unchanged from how it
   has always been decided, so no existing spec can shift meaning.
3. **Both, in turn** — for a type code in neither family, keeping whichever actually
   yields tokens. A customized HPDH is the case this was reported from.

The type code **decides**; detection is not allowed to overrule it. An STM class
pointed at a text-header area therefore mis-reads it, and `header` is how you say so
— the alternative would be a spec whose meaning changes with its payload.

---

### 5.19 `sizeof` — the DDL's declared size, anywhere a size is taken

```json
{"when": {"field": "LEN", "greater_than": {"sizeof": "EMV.DATA"}, "then": [ … ]}}
```

`{"sizeof": "ID"}` is the **declared** size of a DDL element in bytes: the
element's own length when it is a leaf, and the sum of its non-REDEFINES leaves
when it is a group. It reads no bytes, moves no cursor and emits no row — it is
the DDL's own number, made available to a condition.

A group that carries **its own length** reports what it declares for its
**payload**. The length leaf is a statement *about* those bytes, not one of them,
so `LEN(4) A(12) B(10)` is **22** — the number a wire length of 23 is disagreeing
with, and the same 22 the engine prints when it reports the overrun. Counting the
LEN's own four bytes made the only comparison anyone wants to write compare two
different things. Which leaf is the length is decided by the rule that frames the
group (§8, §8.0) — an explicit `vlg` marker, else auto-detect under this block's
`vlg_identifier` — so the size and the framing can never disagree.

It exists so a spec can ask the question `length_mode` answers structurally
(§8.2): *is this message carrying more in the element than the DDL has room
for?* — and act on it in the spec rather than only being told about it. It is
also the honest way to write a fixed size that is really the DDL's: a literal
`4` in a spec goes stale the day the DDL changes and says nothing about why it
was 4.

An id that names no element in the bound DDLs is an **error row**, not a zero.
Silently reading 0 would make `greater_than {sizeof: TYPO}` fire on every
message, which is worse than not running at all.

Accepted **wherever a spec takes a number**, resolved in the one helper they all
call (`_meNumRef`), so the size a condition compares against is the size a
`read-fixed` would read:

| Where | Example |
|-------|---------|
| `read-fixed` `length` | `{"read-fixed": {"length": {"sizeof": "EMV.DATA"}, "as": "D"}}` |
| `skip` `length` | `{"skip": {"length": {"sizeof": "HDR"}}}` |
| `repeat` `count` | `{"repeat": {"count": {"sizeof": "PAD"}, "body": [ … ]}}` |
| `read-while` `max` | `{"read-while": {"max": {"sizeof": "TABLE"}, … }}` |
| a `de` entry's `length` | `{"de": {"55": {"length": {"sizeof": "EMV"}, "blocks": [ … ]}}}` |
| any `when` comparison (§5.6) | `{"when": {"field": "LEN", "greater_than": {"sizeof": "EMV.DATA"}, … }}` |

Documented once and referenced from each of them, the way `at` and `peek` are
(§5.11) — the same sentence repeated per block is the way two of them end up
describing different behaviour.

---

### 5.19a A numeric reference is DECIMAL, unless it states a base

Everywhere a spec takes a number — `read-fixed`'s `length`, `skip`'s `length`,
`repeat`'s `count`, `read-while`'s `max`, a `de` entry's `length`, every `when`
comparison — the reference may name a field, and the field's value has to be
turned into a number. **That is base 10 unless the reference says otherwise.**

```jsonc
{"read-fixed": {"length": 16,       "as": "BUF"}}   // a literal, decimal
{"read-fixed": {"length": "LEN",    "as": "BUF"}}   // the field, base 10
{"read-fixed": {"length": "LEN:h",  "as": "BUF"}}   // the field, base 16
{"read-fixed": {"length": "LEN:o",  "as": "BUF"}}   // the field, base 8
{"read-fixed": {"length": "10:h",   "as": "BUF"}}   // a literal in hex   → 16
{"read-fixed": {"length": "10:o",   "as": "BUF"}}   // a literal in octal → 8
```

**Digits before the suffix are always a LITERAL**, never a field that happens to
be named in digits. Flat-format DDLs really do name ISO elements `63` and `126`,
so `"63:h"` would otherwise mean two things; deciding by whether such a field
happens to exist would be one more guess. A numeric field id takes the long form:

```jsonc
{"read-fixed": {"length": {"field": "63", "base": "h"}, "as": "BUF"}}
```

**`base` and `as` are not the same thing, and both are needed.** A base
reinterprets the field's **characters**; `as` reinterprets its **bytes**. A field
holding the text `"12"` — the bytes `31 32` — reads three different ways:

| reference | reads |
|-----------|-------|
| `"LEN"` | **12** — its characters, base 10 |
| `"LEN:h"` | **18** — its characters, base 16 |
| `{"field": "LEN", "as": "uint16-be"}` | **12594** — its bytes, as an integer |

An ASCII hex length wants `:h`; a binary counter wants `as`.

**Order.** A stated base wins, because it is the most specific statement; then
`as`; then a type override on the field (§9), which says it once for every spec
that references it; then base 10.

**A field that is not a number in the base asked for is an ERROR, not a guess.**

```
'CNT' holds "& ", which is not a decimal number — add ":h" (hex) or ":o"
(octal) to the reference, or {"as": "uint16-be"} to read its bytes
```

The digits a base permits are checked before the value is believed: `parseInt`
stops at the first character it dislikes and returns what it read, so `"1A"` in
base 10 would come back as **1** — a wrong length that looks like a right one.

### 5.20 `read-to-end` — the end of what (`end_at`)

```json
{"read-to-end": {"as": "GRP.OVERFLOW", "end_at": "field"}}
```

| `end_at` | Reads to |
|----------|----------|
| `"message"` *(default)* | The last byte of the message. What every existing spec does. |
| `"field"` | The last byte of **the element this block sits inside** — its frame, not the message. |

Inside a framed element — a `de` entry — "the end" meant the end of the
**message**, so the block read straight through the element's boundary and the
only thing it could produce there was `its blocks read N byte(s) past the
element's length`. With nothing framing the block, `"field"` has no end to read
to and **says so**, rather than quietly falling back to the message.

Together with `{"sizeof"}` (§5.19) this is what makes the 23-over-22 case
expressible **in a spec**, rather than only handled structurally by `length_mode`
(§8.2):

```json
{"de": {"60": {"blocks": [
  {"read": "GRP60.A"},
  {"read": "GRP60.B"},
  {"when": {"field": "GRP60.LEN", "greater_than": {"sizeof": "GRP60"},
            "then": [{"read-to-end": {"as": "GRP60.OVERFLOW", "end_at": "field"}}]}}
]}}}
```

Both halves come from the DDL, so one spec covers a surplus of one byte, of
five, or of none — and the DE after it starts where the length said either way.

> **Note — the entry reads the LEN itself.** A `de` entry on a group frames it by
> reading its length leaf *before* the blocks run, so `GRP60.LEN` is already a row
> and already in the field table (which is what `when` compares against). The
> blocks read the **payload only**. Adding `{"read": "GRP60.LEN"}` reads it a
> second time, four bytes further on, producing a second row under the same id
> and overwriting the first in the field table — after which the condition
> compares the wrong value.

---

### 5.21 `stop` — where a run may end

```json
{"stop": true}                    // ends the run here, always
{"stop": {"condition": "EOD"}}    // ends it only if no bytes are left
```

| `condition` | Stops when |
|-------------|------------|
| *(absent)* | Always. The spec ends the moment the block is read; everything after it is unreachable. |
| `"EOD"` | **End of data** — no bytes left at the cursor. Bytes remaining → the block does nothing and the spec carries on. |

A condition that is not recognised is **reported and ignored**: one nobody
implemented must not silently end a parse, and must not be silently skipped
either. The list is meant to grow — this is where a new condition goes.

**The case `EOD` exists for.** One record with two shapes: a short one, and a
longer one carrying extra groups. Read with a single spec, the spec has to read a
field to decide which shape it has — and on the short shape that field is not
there. The read falls off the end, and the `when` naming the field it should have
produced then reports **“Field … not yet read”**. Two errors, both describing a
message that is perfectly correct. Reported from production 2026-08-22, where the
two shapes were hoppers and hoppers-with-recycle.

**Why a block and not a mode.** Running out of bytes is a real error nearly
everywhere — it is how a misread length announces itself (§8). Ending is legal
only at the points the spec says so, which is exactly what placing a block
expresses. A flag on the spec would forgive every overrun in it.

It ends the whole run at any depth: inside a `when` branch, a `repeat` body or a
`read-while` body it stops the loop too, not only that pass. Inside a `de` entry
(§5.14) the element's own end counts as the end of data, not the message's — the
same rule `read-fixed` follows there.

---

### 5.22 `map` — a field read through another DDL definition

A variable-length element often declares only its length and one opaque payload:

```
02 RESERVED-ELEMENT-48.
    04 LEN     PIC 9(3).
    04 DATA    PIC X(200).
```

What `DATA` holds depends on the **message**, not the layout: an online purchase
carries three sub-fields there, a recurring payment that is also a purchase
carries six. The DDL cannot say which. `map` names the definition that describes
*this* message, so the element is read as what it actually is.

```jsonc
// Declared before the walk — a whole-message decision
{ "when": { "field": "PROC-CODE.TRAN-CODE", "equal": "28",
            "then": [ { "map": { "field": "RESERVED-ELEMENT-48.DATA",
                                 "def":   "RECUR-PYMNT-DATA" } } ] } },
{ "read-ddl": { "binding": 0 } }

// Or on one read only
{ "read": { "field": "RESERVED-ELEMENT-48", "map": "BASE/DDL/RECUR/RECUR-PYMNT-DATA" } }
```

**The block is a declaration, not a read.** It emits nothing and consumes no
bytes — it settles what a field *means*, and whichever block reads that field
then produces the sub-rows. That is what lets it sit inside a `when` and decide
the shape before `read-ddl` walks the whole message.

| Attribute | Holds |
|-----------|-------|
| `field` | The id being replaced — usually the `DATA` leaf of a variable-length element. Naming the **element** works too when its payload is a single leaf; the length is never the payload. With several payload leaves the element identifies nothing and the leaf must be named. |
| `def` | The definition replacing it. A bare `DEF-NAME` is searched in the volumes and subvolumes the class already binds, the bound file first; `VOL/SV/FILE/DEF` reaches anywhere. |

Rules:

- **The field's own bytes are the window.** A length already on the wire still
  frames the payload — `map` says what the bytes *mean*, never how many there are.
- **Rows are named after the mapped definition** — `RECUR-PYMNT-DATA.AMT`, not
  `RESERVED-ELEMENT-48.DATA.AMT` — so the output says which layout was applied.
  The prefix is applied to the DEF *before* the read, so a field override written
  against what you see is the id the engine looks up. The corollary: an override
  written for one map does not apply when a different map wins.
- **A later `map` on the same field replaces an earlier one**, so a `when`
  cascade reads top to bottom like the rest of the spec.
- **A mismatch reads what fits and says so.** A definition longer than the
  element reports the shortfall; one that describes only part of it reports the
  bytes left over. Both are their own row.
- **An unresolvable name is reported where it was written** — on the `map` block —
  not as a silent no-op fields away.
- `read`'s `map` attribute applies to **that read only**, and only to the field it
  names.
- Mapped rows are drawn in their own colour (`--mapped`) in Parse Results, and say
  on hover which definition they came from: they are not native to the bound DDL.

> `read-segment-fields` also takes an attribute called `map`, which names a
> bitmap field. Unrelated to this block, and the two never appear together.

---

## 6. DDL Bindings (ddl_bindings)

A Message can reference 1 to N DDL paths. These are the DDLs used for field metadata (names, descriptions, base types, lengths, offsets).

```yaml
ddl_bindings:
  - SWITCH/ISO/ISO-FINANCIAL
  - SWITCH/ISO/ISO-AUTH
```

Scoring is performed **only within the Message's DDL bindings** — not globally across all DDLs.

---

## 7. DE anchors (`overrides[…].de`)

**Storage.** §7, §8 and §9 all live in one map on the spec, keyed by **canonical
field id** — the id with every OCCURS `[NN]` label stripped, so one entry covers
every occurrence of a repeated field:

```json
"overrides": {
  "REVERVED_DATA_FLD": { "de": 124 },
  "POS_DATA_FLD":      { "de": 60 },
  "TRACK2":            { "vlg": "TRACK2.LGTH" },
  "MSGTYPE":           { "type": "hex-char", "bytes": 2, "display": "hex" },
  "TRAN-CDE":          { "de": 64, "de_src": "auto" }
}
```

**`de_src`** records **who set the number**: `"auto"` when
Auto Order wrote it from the bound DDL's `Bit map position = NN` comment, absent
when a person typed it. It rides with `de` the way `count` rides with `vlg` —
cleared whenever the number is, so a marker can never outlive what it describes,
and typing a number by hand removes it because the number is yours from then on.

It is stored rather than inferred so it survives an **export and the import that
reads it back**, and so a duplicated entity carries it. The Overrides table
colours the two apart: an Auto Order anchor in amber, a hand-set one in the
accent. Asked for while chasing an anchor nobody remembered setting — the two
were indistinguishable, both drawn accent-blue. An anchor stored before this
existed has no marker; the table falls back to comparing the number against the
DDL's own comment and says in the tooltip that this is an inference.

This replaced three parallel arrays — `de_map`, `var_length_groups` and
`field_overrides`. A spec saved in the old shape is folded into this one when it
loads (`_migrateSpecOverrides`), including the legacy bare-string
`var_length_groups: ["GRP"]` form; only the new shape is ever written.

**DE anchors.** Declares DE number assignments when the DDL's declaration order
does not follow DE numeric order. It is a **delta/anchor model**: list only the
fields where the number jumps or resets, and every following field increments
from the last anchor.

- Fields before the first anchor start from DE-1 in declaration order.
- `read-bitmap-fields` uses these anchors to resolve which field a set bit means.
- One anchor renumbers the whole tail. A DDL declaring DE-64 then DE-66 (because
  DE-65 does not exist) needs **one** entry on the DE-66 field, not one per field
  after it.
- The Overrides panel marks an anchored row `DE 65 ↩ 66` — what it would have
  been, and what it is.

---

## 8. Variable Length (`overrides[…].vlg`)

HPE DDL has no LLVAR/LLLVAR type. Variable-length fields are expressed as a group with two sub-fields: `LEN` (PIC 9(2) or PIC 9(3)) and `DATA` (PIC X or PIC 9).

**Storage** (§7): `"TRACK2": { "vlg": true }` marks the group and lets the LEN
auto-detect; `"vlg": "TRACK2.LGTH"` names the LEN leaf explicitly. Marking a group tells `bitmap-fields` to:
1. Read `LEN` sub-field.
2. Convert `LEN` value to integer N — see *Length decoding* below.
3. Read exactly N bytes into `DATA` (not the full declared `DATA` length).

**Length decoding** — one rule, shared with
`length_prefix` (§5.13). Four sources are consulted **in order**, and the first
one that speaks decides:

| # | source | where it is written |
|---|--------|---------------------|
| 1 | the field's **type override** | `overrides[…].type` (§9) |
| 2 | the **block's** encoding | `"encoding": "ascii" \| "ebcdic"` on the parse-spec block |
| 3 | the **recognizer's** encoding | `recognizers[…].encoding` on the spec that matched (§4) |
| 4 | **ASCII**, and it says so | reported on the field — see *Assumed encoding* below |

A declared type is a **statement about the data**, so bytes that contradict it
are reported rather than quietly re-read some other way. Every type the Data
Editor offers decodes a length:

| type | bytes | reads as |
|------|-------|----------|
| `ascii` | `31 39` — the characters `"19"` | 19 |
| `ebcdic` | `F1 F9` — `"19"` in EBCDIC | 19 |
| `hex-char` | `00 13` | 13 — the hex **spelling** is the number |
| `hex-ascii-decimal` | `"00FF"` as ASCII text | 255 — text of a hex number, base-16 |
| `hex-ebcdic-decimal` | `C6 C6` — `"FF"` in EBCDIC | 255 |
| `uint-be` / `uint16-be` … | `00 13` | 19 — width from the field when unstated |
| `uint-le` / `uint16-le` … | `13 00` | 19 — **little-endian is honoured** |

**Nothing declared.** Two questions hide here and levels 2-3 answer only the
second:

- *Text or binary?* — `PIC X(2)` genuinely does not say, and a binary length
  inside a character field is ordinary on Base24. This stays a fallback.
- *If text, ASCII or EBCDIC?* — the block or the recognizer knows, and **byte
  values must never decide it.**

So the encoding from level 2 or 3 is tried **as text first**; only bytes that are
not digits in that encoding fall through to the big-endian integer reading.
Binary messages write lengths as integers, and reading those as characters
produced `NaN` — which a `|| 0` then turned into zero, collapsing the group and
shifting every field after it with nothing reported.

**Assumed encoding.** When nothing at levels 1-3 states one, ASCII is assumed.
That assumption is reported on the LEN field, but **only where it changed the
answer**: nothing declared an encoding, ASCII could not read the bytes as digits,
and the other encoding can. Then the number that came out is a binary integer
nobody chose, and the message names both the value the other encoding would have
given and the one field that settles it. An ordinary binary length stays silent,
because it is not a mistake.

**Lengths in characters.** A `hex-char` length counts **characters, not bytes** —
`37` means 37 characters of payload, which is 19 wire bytes (§9). The conversion
happens once, at the length, so every bound and every child after it stays
byte-based. The number reported back to the user is what the message says, since
that is the number visible in the LEN's own value.

Bounds: a length past the end of the message stops at the end and is reported,
naming how it was read; a length beyond the payload the DDL declares is still used
— the wire decides the framing — but is reported, because that usually means it
was misread. A `repeat` driven by a length is additionally bounded by the group's
`OCCURS`: the DDL's declared count is the ceiling, so a corrupt size cannot spin
the parse for millions of iterations.

**How a complaint is reported** — a problem with a field
rides **on that field** as `issue`; it is never pushed as a row of its own.
Pushing it separately produced two rows carrying the same id — the real field and
a second, blank one — which is exactly the duplicate `TRACK2.LEN` that was
reported. `error` is different and means *this row is not a field at all*: it
gates the byte map, the render-time override pass and the coverage count, so a
real field with a complaint must never carry it.

### 8.0 A length field sizes the field after it

`vlg: true` on **any field** means the next field's length comes from this
field's value:

```json
"overrides": { "PAN-LEN": { "vlg": true }, "AMT-LEN": { "vlg": true } }
```

That is the general rule. A **VLG group** is the same idea with the length and
its payload wrapped in a group — all the older code could express, so a flat
`PAN-LEN` then `PAN` could not be described at all, and a group could carry
exactly **one** length. Several markers at one level are fine; each binds only to
its own successor.

Implemented in `_meReadOneFieldFromDef`, the single reader every path goes
through, so `read-ddl`, the bitmap walk and `de` entries share one rule rather
than three copies. What the marker frees or claims shifts the rest of the record
through the same running `ovShift` a `bytes` override uses (§9.0), counted once
per field id so a REDEFINES re-read cannot double-shift.

The group forms are unchanged — not migrated, not reinterpreted.

**A DE number on a length belongs to its group**. A LEN
marked `vlg` is **part of** its group, and the group is the data element — the
same thing the parse does, where auto-detect finds the LEN inside a group and
frames the rest of that group with it. So a DE anchor written on the LEN numbers
the **group**, and everything inside — the LEN, sibling groups, nested groups,
their leaves — derives that one number. The next sibling takes the next.

```jsonc
{ "GRP.SUBGROUP1.LEN1": { "de": 60, "vlg": true } }
// SUBGROUP1 = DE 60 end to end; SUBGROUP2 = 61; SUBGROUP3 = 62
```

Numbered on the leaf instead, the leaf became an element of its own: the group
broke apart around it and each payload group underneath drew a number too.

**The field a length sizes may be a group**. At the level
where DEs are assigned, a LEN pairs with the **next sibling** — and that sibling
counts whether it is a leaf or a group:

```jsonc
{ "LEN": { "de": 10, "vlg": true } }
// 02 LEN. / 02 PAYLOAD. { ITEM1 ITEM2 } / 02 TAIL.
//   LEN = 10, PAYLOAD and its leaves = 10, TAIL = 11
```

One sibling, no further:
`TAIL` is its own element either way.

Inside a group the marker changes no numbering at all — the group is already one
element by the sibling rule, so the LEN, the payload and anything after it in
that group all carry the group's number.

The pairing is **confined to the LEN's own scope**. A length sizes what follows
it there; once the walk leaves, the pairing is dead. A LEN that is the last field in its scope
pairs with nothing, rather than reaching into the next branch of the record.

**Auto-detect** applies to **direct children only**. Scanning every transitive leaf
would find a grandchild's `LEN` — the length of a nested TLV triple, not of the
group — and read the first tag as a length. A grandchild `LEN` still frames *its
own* group; it just never frames the group above it.

**Which leaf is the length — `vlg_identifier`**

The auto-detect looks for the names `LEN` / `LGTH` / `LENGTH` and a 2–4 byte width
by default. Both are assumptions about someone else's DDL, so both are settable per
spec, on the blocks that walk DDL groups — `read-ddl` and `read-bitmap-fields`:

| `vlg_identifier` | Meaning |
|------------------|---------|
| *omitted* | Fall back to the built-in names `LEN`, `LGTH`, `LENGTH`. |
| `"SIZE"` | Only a leaf named that is a length. Matched **wherever it sits** in the group, so a TAG may precede it. |
| `""` | **Off.** No group is ever guessed to be variable-length. |

The empty string is the point of the attribute: a group whose first field is
honestly called `AMT-LEN` but is **not** variable-length was being framed by it,
and everything after it slid.

The LEN's **width** is never assumed — it is whatever the DDL declares for the leaf
that matched, so a 1-byte binary length works exactly like an LLLVAR's 3.

Precedence is unchanged: an explicit `overrides[…].vlg` flag wins over all three.
`vlg_identifier` governs the *guess*, not the user's own choice.

**The payload does not have to be a sibling leaf**. The
guess needs the group to hold something besides the length, and that was counted
over its **direct children** — so `ADD-DATA { LGTH, INFO { … } }`, whose payload
is a nested group, had exactly one direct child and was rejected outright. The
name matched; the shape disqualified it, and a genuine variable-length group had
to be flagged by hand. The count is now the group's leaves at **any** depth.

What is still direct-children-only is which leaf may *be* the length: a
grandchild's `LEN` is the length of something inside the group, not of the group
— the rule set on 2026-08-02. *How many leaves does this group hold* and *which
leaf may be its length* are two different questions, and only one of them was
ever answered correctly.

**A variable group's unreached tail is not rendered**. When
the length is spent the walk stops. A **fixed** group's empty field is a field
the message contains and left blank, and keeps its row; a variable group's is a
field the wire never sent. Emitting them anyway put a row of "0 bytes, no value"
under every remaining leaf — two hundred of them beneath a one-byte payload,
burying the field that is real. A child the length reaches only **partly** is
still emitted with the bytes it got: that is the boundary the trim must not
cross.

**The LEN is not reprinted on its payload**. Every child
borrows the LEN's rendered value so an LLVAR-style prefix can sit beside the
data. A VLG group's length has its own **row**, so printing it again showed the
same bytes twice — and on children the length left empty it was the entire value
column. The length column had excluded it on this same flag since it was added;
the value column and both clipboard helpers had not. An LLVAR prefix still
prints and still counts: it has no row of its own.

**`read-ddl` honours variable-length groups** — an LLVAR group's `DATA` is read at
its wire length, not at the DDL's maximum. A group read this way rarely
consumes what the DDL declares, so the difference is added to the same running
`ovShift` correction a `bytes` override uses (§9.0) and every later declared offset
moves with it. OCCURS frames are left to the walk's own repetition handling.

```json
"overrides": {
  "DE-2":  { "vlg": true },              // PAN: LEN PIC 9(2) + DATA PIC 9(19)
  "DE-35": { "vlg": true },              // Track 2 — LEN auto-detected
  "DE-45": { "vlg": "DE-45.LGTH" }       // Track 1 — LEN named explicitly
}
```

---

### 8.1 Inline overrides on a block (`overrides`)

`read-ddl` and `read-bitmap-fields` accept an `overrides` attribute in the **same
shape** as the stored map (§7–§9), so a spec can carry its own:

```json
{"read-ddl": {"overrides": {"MSGTYPE": {"type": "hex-char", "bytes": 2}}}}
{"read-bitmap-fields": {"bitmap": "PRI-BIT-MAP",
                        "overrides": {"DE-64": {"de": 66}}}}
```

All five keys work — `type`, `bytes`, `display`, `de`, `vlg` — because the block's
map is merged into the item before the DE walker and the VLG lookup run, not just
at field-read time.

**Precedence: inline wins**, the same rule a `read` block's inline `type` already
followed. The merge is per **key**, not per field: an inline `{"bytes": 2}` does
not discard a `{"display": "hex"}` set in the panel.

**Scope** is the declaring block. The next block does not inherit it, and a nested
block restores the enclosing block's map on the way out rather than clearing it.

`item.overrides` cannot be replaced by this: overrides are also applied at render
time for manual-override and DDL-walk parses, which have no parse_spec at all. The
two are layered, not alternatives.

> **Not yet built:** nothing syncs the two. The panel neither displays nor edits a
> block's inline overrides, so a spec carrying them shows a panel that does not
> match what the parse uses. Projecting the stored map into the spec on save, and
> extracting it back, is the intended next step.

---

### 8.2 A wire length longer than the DDL — `length_mode`

A message may carry **more** in an element than the DDL declares room for: a LEN
reading 23 over a group whose fields add up to 22. Which of the two is right is
not the engine's to decide, so `read-bitmap-fields` takes the answer as an
attribute:

```json
{"read-bitmap-fields": {"bitmap": "BMP", "length_mode": "smart"}}
```

| `length_mode` | Meaning |
|---------------|---------|
| `strict` *(default)* | The payload takes `min(LEN, what the DDL declares)`. The surplus stays in the stream, where the next DE reads it. The LEN row says what the length claimed, what the DDL declares, and what was read instead. |
| `smart` | The wire's length **owns its bytes**. The declared fields read as always; the surplus becomes a row of its own, `<ELEMENT>.<unmapped>`; and the next DE starts where the length said it would. The LEN row notes `smart length mode in effect` and nothing more — in this mode nothing went wrong. |

`strict` is the default because it is what every spec written before this
attribute already means — the mode is opt-in, and no existing parse moves.

**Why `strict` is a trap worth naming.** It does not merely truncate. The DE ends
where its *fields* ran out, one byte short of what the wire said, so every DE
after it starts one byte early and reads plausible values that are wrong. The
warning on the LEN row is the only sign, and it names the element that is
**correct**, not the ones that are damaged. Reported from production against a
23-byte element declared 22.

The mode governs all three places a DE gets framed, so a bit means the same thing
whichever shape the DDL happens to have:

| Framing | The `<unmapped>` row is named after |
|---------|-------------------------------------|
| A VLG group holding its own LEN (§8) | the group |
| A LEN framing the element after it (§8.0) | that element — its own id for a single leaf, the shared parent for a payload of several |
| A `de` entry with a stated extent (§5.14) | the entry's element, or `DE-<n>` when it has none |

In the third case `smart` also shows what an entry's blocks **did not** read
inside their own frame; `strict` swallows it silently, as it always has.

A message carrying **less** than the DDL declares is untouched in both modes —
that is ordinary, and the payload simply ends early (§8).

The row is not a DDL field and never registers as one: `<unmapped>` is a name no
DDL can collide with, and it carries the DE number of the element it sits inside.
Its description is `not declared in the DDL`, and it carries no warning of its
own: the row exists only in `smart`, where those bytes are
accounted for, and an explanation on every such row — plus a full account on
every LEN above it — made a correct parse read as a wall of errors. `strict`
keeps the long explanation, because there the length really is being ignored.

---

### 7.1 Which fields are data elements

By default a data element is a **top-level** row whose name is not literally
`FILLER`. That was compiled in as policy, so a DDL could not exclude its own
padding under any other name, and a DE could never sit on a nested field. It is
now a default, overridable on the same `de` key:

| `de` | Meaning |
|------|---------|
| *(number)* | Anchor — renumber from here. Unchanged. |
| `false` | **Not** a data element, and the counter does **not** advance, so the fields after it keep their numbers instead of leaving a hole. |
| `true` | **Is** one, even where the default says no — a nested field, or one named like padding. Reaches inside a terminal group. |
| `"children"` | The group yields; its **immediate children** each take a DE. One entry instead of marking the parent and every child by hand. |

Only a **number** anchors. `+false` is 0, `+true` is 1 and `+"children"` is NaN,
so the previous `+v || 1` coercion would have read all three as "anchor at DE 1".

**Reading it as navigation** *(clarified 2026-08-18)*. The four values are one
small vocabulary for walking a record: **count the siblings**, `false` skips one,
`"children"` steps down a level. At whatever level you land on, the first element
takes the number; from there you either leave it, skip it with `false`, or step
down again. Chaining `"children"` is how you reach any depth.

```jsonc
// numbers land on TOP.L1A's children; the first of them is skipped
{ "TOP": {"de": "children"}, "TOP.L1A": {"de": "children"},
  "TOP.L1A.L2A": {"de": false} }
```

**Precedence**, in order:

1. `false` wins over everything. A group promoting its children cannot number a
   child that excluded itself.
2. `true` and a **number** reach inside a group the default rule would refuse.
3. Promotion by `"children"` reaches the group's immediate children.
4. Otherwise the default: a top-level row not named `FILLER`.

**Anything that numbers something inside a group makes that group yield** — a
number, `true`, or `"children"`. A group cannot be one element while a part of it
is numbered separately, so the groups above the numbered level give up their own
numbers and their children each take one. `"children"` was missing from this
rule, so marking a deep group while its ancestors went untouched numbered both
ends at once. Marking a deep group and stepping down through it now agree.

---

## 9. Field Overrides (`overrides[…].type` / `.bytes` / `.display`)

Per-field overrides live on the **Message** definition (not per DDL binding). They apply to all instances of that Message type. If different overrides are needed for a different context, a new Message definition with different DDL bindings should be created.

Each override can set:
- `type`: how to **consume** the bytes (overrides the DDL PIC type).
- `bytes`: how **many** bytes the field is.
- `display`: how to **format** the value for display (independent of the consumption type).

### 9.0 An override always wins, and re-sizes the field

An override is an edit to what the field **is** — it is never ignored for not
fitting. The DDL file itself is untouched; the override states what to take from
that field at parse time.

**Effective length**, in precedence order:

| | |
|---|---|
| 1. `bytes` | the size stated outright |
| 2. a fixed-width `type` | `uint16-be` *is* `TYPE BINARY 16`, so 2 bytes |
| 3. the DDL's declared length | nothing was overridden |

The field is read at that length, and **every field declared after it shifts by
the difference** — shrink a 4-byte `MSGTYPE` to 2 and the two bytes that frees
belong to the next field, rather than being skipped because the DDL says the next
field starts at offset 4:

```
MSGTYPE  PIC X(4)  holding 02 00 30 20      {"type": "hex-char", "bytes": 2}

MSGTYPE  reads 02 00 → "0200"
TAIL     starts at 2 (declared 4) and reads 30 20
```

Growing works the same way in reverse, and is a legitimate statement that the DDL
understates the field. A read is still bounded by the message — it never invents
bytes. The delta is counted once per field id, so a REDEFINES re-reading an
earlier offset cannot shift the record twice.

A `type` needing more bytes than the DDL declares re-sizes the field. The one
thing still length-checked is an **inline** `type` on a
`read` block (§5.2) — that is a statement about one traversal step, not about the
field, so it must fit.

The Overrides panel shows the result in the same `↩` form the parse results use:
the Len column reads `4 ↩ 2`, declared then in effect.

**`type` — how the bytes are read**

| Value | Reads the bytes as |
|-------|--------------------|
| `uint-be` / `uint-le` | Unsigned integer, big- or little-endian, width from the DDL field |
| `binary` | Raw bytes, rendered as `0x…` |
| `ascii` | ASCII characters |
| `ebcdic` | EBCDIC characters |
| `hex-char` | Raw bytes → their hex characters — TAL `binary^hexchar`, so `00 13` reads as `"0013"` |
| `hex-ascii-decimal` | Hex digits held as **ASCII text** → integer: `30 30 46 46` (`"00FF"`) → `255` |
| `hex-ebcdic-decimal` | Hex digits held as **EBCDIC text** → integer: `F0 F0 C6 C6` → `255` |

The names `hex-ascii` and `hex-ebcdic` are not accepted; write the `-decimal` forms.

**`hex-char` reads the wire, not the message encoding**. An
EBCDIC message is translated **at extraction** — every byte, before any field
exists — so a field read as `hex-char` was giving the hex of the *translated*
byte. A PIN block declared `PIC X(8)` and overridden to `hex-char` came back as
something else entirely. `hex-char` means "give me the bytes as they are on the
wire", in any encoding, so it reads the untranslated copy kept beside the
translated one. Both come from a single extraction per chunk.

A type override whose width does not match the DDL field is **rejected with a
warning** rather than applied, so it can never silently consume the wrong number
of bytes.

**`display` — how the value is shown**

| Value | Renders as |
|-------|-----------|
| `datetime` | Formatted date/time |
| `amount` | Amount with decimal placement |
| `hex` | Hex string |
| `ascii` / `ebcdic` | Decoded text |
| `gmt-ts` | NonStop JULIANTIMESTAMP (64-bit big-endian µs) → `YYYY-MM-DD HH:MM:SS.ffffff GMT`; reads raw bytes, so no type override is needed on a `BINARY 64` field |
| `bitmap` | The map rendered as binary digits — `0010 0110 …` |
| `bitmap-list` | The same map read out as the bit NUMBERS that are set — `Bits — 2, 3, 5, 11, …` (no count: the row's description already states it). Nobody counts columns across 16 bytes to discover DE 11 is present. Prefers the engine's own bitset, which is exactly what `read-bitmap-fields` walks, so it reflects the ISO rule that bit 1 is the secondary-bitmap indicator on a wire map but real data on an explicitly sized one |

A `read-bitmap` row accepts both, and every other override — see §5.12.

The declared DDL type is **preserved**, never replaced: Parse Results shows
`declared ↩ override`, plus `as DISPLAY` when a display override is also set.

```json
"overrides": {
  "DE-7":  { "type": "uint32-be", "display": "datetime" },
  "DE-55": { "type": "binary" },
  "MSGTYPE": { "type": "hex-char", "bytes": 2 }
}
```

Reliability: a field overridden to a binary type (`uint32-be`, `uint16-be`, `binary`, etc.) is automatically marked `unreliable` when the input format is ASCII-class.

---

## 11. UI — Class Editor

Entry point: **⊞ Class Editor** in the app's top bar.

Flow:
1. User clicks **⊞ Class Editor**.
2. The page opens over the whole viewport — no scrim, no card, nothing behind
   it to return to except by closing.
3. User edits entities and tests against real bytes.
4. Cancel / ✓ Save / ✕ → back to the main app.

**Settings carries no copy of the entity list and no way in.** It did until
2026-08-13, which meant the same list existed in two places and the same
override had to be marked in both. One screen, one door.

No nested overlays.

### Layout

> *Rewritten 2026-08-01 — the diagram still showed priority badges (removed
> 2026-05-31), no Files list (shipped 2026-07-19) and no Test area.*

```
┌──────────────────────────────────────────────────────────────────────┐
│  Class Editor                        [Delete] [Cancel] [✓ Save]  [✕]  │
├──────────────────────┬───────────────────────────────────────────────┤
│  ENTITIES        [−] │  ▾ Identity                                   │
│  MESSAGES        [+] │  ▾ Recognizers                        ⚠2      │
│    iso-ascii    red  │  ▸ Parse Spec                                 │
│    bic-iso    GREEN  │  ▾ DDL Bindings                        ✓      │
│    hpdh   ←sel WINS  │  ▾ Overrides                                  │
│    ebcdic     dimmed │                                               │
│  OTHER           [+] │  (sections are collapsible and all on one     │
│  FILES           [+] │   page — not tabs; several open at once)      │
│    segmented  amber  │                                               │
│ ──── drag to size ── │                                               │
│  TEST   Wins · 12 f. │                                               │
│  [AUTO▾] ASCII 49 B  │                                               │
│           Line Width │                                               │
│  ┌─────────────────┐ │                                               │
│  │ paste a message │ │                                               │
│  └─────────────────┘ │                                               │
│ ──── drag to size ── │                                               │
│  Input · Detection · │                                               │
│  Recognition ·       │                                               │
│  Parse Spec · Tokens │                                               │
└──────────────────────┴───────────────────────────────────────────────┘
```

**Sidebar — Messages, Data and Files.** Three lists over one array (§3.2), split
by `kind`. Order is manual and authoritative in **all three**: there is no
priority field — it was removed 2026-05-31 because two orderings that could
disagree is one too many. That includes Files: detection walks it in array order
and stops at the first match, so the list renders in array order too. Entries drag to reorder within a list and to move between lists,
which rewrites `kind`. Each entry shows a `⚠N` gap badge when the spec is missing
a recognizer, a parse_spec or a DDL binding; hovering names which.

**Right panel — collapsible sections, not tabs.** Identity, Recognizers, Parse
Spec, DDL Bindings and Overrides all live on one scrolling page and each collapses
independently, so a spec can be read end to end without switching context — you
can see a recognizer and the parse_spec that depends on it at the same time.

Which sections open is decided in two layers. The **default**
is the class's own content: panels with something in them open, empty ones start
collapsed, so a class that has never been touched shows what it has. **What the
user collapses is then remembered per class**, in `up_me_sect` (§13), and survives
closing the editor. Only sections the user actually toggled are stored, so the
content default still governs everything else — a class that later gains its first
recognizer still opens that panel, which storing the whole map would have made
impossible. Keyed on `label || name`, the identity the editor already uses for
`up_me_last_sel`; renaming a class therefore returns it to the defaults. Reset
Layout clears it along with every other stored panel size.

**Panels are spaced on `--gap`** — the same variable the
main page uses for the space between panel cards, and the same width as a resizer.
The editor had been on `--sp-3`, so its gaps read 12px against the page's 10px and
scaled differently with density (12/6 against 10/2): the two surfaces disagreed at
every zoom level, not just one. A section card carries **only a bottom margin**,
the gap between cards. Its side edges already have theirs and a margin stacked on
top of them: `#me-splitter` is `--gap` wide and is what separates the sidebar from
this column (10 + 12 = the 22px that was measured), and `.me-tab-body` reserves a
`--gap`-wide scrollbar gutter on the right, kept stable so nothing shifts when the
scrollbar appears — it now holds the scrollbar rather than sitting beside a margin.

**The block reference sits beside the spec**, so the reference and the spec it
describes can be read together. It is the right-hand column of a fixed-height split, with a drag bar beneath
it; the reference scrolls inside that height, so opening it never makes the card
taller, and closing it returns the editor to full width. The height persists
(§13).

Two views:

- **Catalogue** — every block grouped by what you are trying to do (Walk the DDL
  / Read raw bytes / Maps & nested / Control / Tokens), one line each. An
  alphabetical list of fifteen names answers "what is this block called", which
  is not the question anyone opens the reference with.
- **Block** — a lead sentence, *use when*, **one** starter example, then the
  attributes as an accordion. Opening an attribute shows its description, its
  default, its accepted forms and **only the examples that use it**; the previous
  one closes. Before this the panel printed every attribute and every example at
  once — `read-fixed` alone ships ten — which is a great deal to scroll past to
  reach the one line you came for. Below that, an *On every block* row for the
  shared attributes (§5.11), shown against the block you are already reading.

**The reference follows the caret.** Moving into a block shows that block, with a
bar saying so. The innermost enclosing block wins, so a `read-fixed` inside a
`when`'s `then` reports `read-fixed` rather than the `when` around it. Resolution
reuses the editor's own tokenizer mask rather than `JSON.parse` — positions are
the whole point, and it means the reference still answers while the spec is
mid-edit and does not parse. It stands down while the catalogue is open, and
never re-renders for a caret move inside the block already shown.

**Test.** A subpanel of the Entities column, under the list — because a run
annotates that list, and across the page from it the two halves of one action
sat at opposite edges of the screen. Both the column and the subpanel resize and
collapse; so does the input inside it. It is a *workspace*, not a preview: it
carries the Message Input panel's config bar whole, so a parse can be solved
without walking back to the main panel.

- **Input** — the same CodeMirror editor the main panel uses. A formatted NETARD
  record works as-is (wrapper stripped and decoded by the same audit parser),
  and its byte↔character map comes from that parser rather than being rebuilt —
  `buildByteCharMap` is for non-NETARD input only.
- **Format bar** — the main panel's `#msgCfgBar`, same six values
  (AUTO / ASCII / HEXASCII / HEX / EBCDIC / OCT), the detected-format badge, a
  byte count, and the **Line Width** widget. Both widgets edit the one
  `P.lineWidth`. The select locks to AUTO and shows a **NETARD** badge when the
  input is a wrapped record, since the wrapper then determines the format.
  The Audit file browser is deliberately absent: Test takes messages.
- **▶ Run** — answers two questions in order. *Which entity is this?* — every
  entity is evaluated and the verdict is painted on its **row**: green on the
  winner (badged `WINS`), amber on one that would match but is shadowed by it,
  red on one the walk reached and rejected, and dimmed on one it never reached,
  because detection stops at the first match and red must not claim a rejection
  that never happened. Then *what does that entity make of the bytes?* — the
  winner **becomes the selection**, so the fields shown are the fields the app
  would really have produced. No match means nothing is selected. Clicking a row
  overrides the pick and the re-run leaves it alone.
- **Results** — Input, Detection, Recognition, Parse Spec and Tokens. The field
  table has named, resizable columns (FIELD · SIZE · OFFSET · VALUE · HEX);
  clicking a header lights the column, and hovering or clicking a row lights that
  field's bytes in the input above.

What makes it useful is that a recognizer which does not fire tells you *which*
condition failed and where it stopped (`failAt`), rather than only that detection
returned UNKNOWN.

### Sections (right panel)

**Identity**
- Type code (≤5 chars) | Label | Volume | Colour. `kind` marks a file spec (§3.2).
- No priority field — removed 2026-05-31; sidebar order is authoritative.

**Recognizers**
- Ordered, drag-reorderable list of recognizer rows
- Each row expands inline to edit its type-specific attributes
- \[+ Add Recognizer\] button

**Parse Spec**
- Structured block list editor
- Each block shows its type + key attributes inline; expands to edit
- Supports nested blocks for `when` / `repeat` (indented, collapsible)
- \[+ Add Block\] button

**DDL Bindings**
- List of DDL paths (Volume/Subvolume/DDLName)
- \[+ Add\] / \[Remove\] per entry
- Ordered — the first binding is the default

**Overrides**

An override says one of five things about a field, and those five **kinds** are
the structure of the whole section. `_ME_OV_KINDS` is the single list behind the
bar, the counts, the filters and the clear:

| Kind | Stored keys | Action | Says |
|---|---|---|---|
| TYPE | `type` | picker | how the bytes are read |
| SHOW | `display` | picker | display format only |
| SIZE | `bytes` | number | read this many bytes instead |
| DE | `de` | picker + number | data-element numbering |
| VLG | `vlg`, `count` | picker | length source |

Top to bottom the panel reads in the order it is used: what you can do to a
field, then how you find the field, then the fields.

**Action bar** — one control per kind, `[ total | LABEL ]`, plus the selection
badge at the left and one clear at the right.

- The **badge** states the selection and what it already carries:
  `3 selected` with `2 TYPE 1 SHOW 0 SIZE 0 DE 0 VLG` small beside it. All five
  answers in one place, which is why the controls need only their own total.
- The **total** is every field carrying that kind, narrowed by the text filter
  but never by the kind filter — the five are the switch, and a switch that
  zeroes the other four cannot be switched back. Clicking it filters the table
  to that kind; clicking again clears it. A kind no field uses is not pressable.
- The **action** ADDS. It sets the kind on the selected fields that do *not*
  already carry it, and leaves the ones that do exactly as they were — bulk
  setting a type must not quietly rewrite fields tuned one at a time. To change
  one, clear it first. The action is dead once every selected field has the kind.
- The **clear** takes its scope from the filter the table is already showing:
  with a kind filtering it removes that kind, with none it removes every kind on
  the selection. It counts fields, not field-kind pairs.
- **DE** is a picker — `include / exclude / children / number` — in the shape VLG
  already uses. `number` reveals a box beside the picker, seeded from the field's
  current DE; the number path is `de-anchor`, so 1..128 is clamped in one place.
  DE expands to the GROUP, never its leaves (`xact` in the kind list).

**Toolbar** — filter, Overridden toggle, Collapse All, Hide Redef, `?`, columns.

- The **filter** sits over the FIELD column it filters — same position, same
  width — and follows it through every relayout, because the hook hangs off the
  column fit that a first render, a drag, a hidden column and a panel resize all
  pass through.
- **Overridden (N) / All fields** is one button naming its next state, as
  Collapse All / Expand All does. Its title names both. Picking a kind stands it
  down: a kind filter already shows only overridden fields, of one kind.

**Table** — every field the DDL declares; the picker, read-only. Clicking a row
selects it; clicking it again clears the selection. An override shows in the
Type-Len / Size / DE / VLG columns in the `declared ↩ override` form; rows
carrying none recede, with hover, selection, a broken override and an
unreachable DE all restoring full contrast.

**Written / What the rules did** — the two panes below the table: what was
stored, and what the rules made of it in words.

**Undo** — every structural edit (override set or cleared, DDL binding added or
removed, recognizer added, changed, deleted or reordered) raises a toast
offering `↶ Undo`. One level, deliberately: what was missing is "I just did that
by accident", not a history. Amber for a removal, green for anything else. The
offer belongs to one editor session and is dropped when the editor opens or
closes. Text edits are not wrapped — the spec editor has CodeMirror's own undo
(`↶ / ↷` in its toolbar, ⌘Z / ⇧⌘Z) and inputs have the browser's.

Prior designs (superseded): first a list with one row per configured field, its
settings as chips — capped at 180px and sorted by id, so on a real spec the
entry you wanted was below the fold. Then an "In place" index of five kind rows
carrying the fields as pills, with the kinds also shown as badges on each field
row. Both were dropped for the same reason: the panel stated what was configured
in three places at once, and the pills could only ever show as many fields as
the row was wide — so a field whose pill did not fit had no way to be edited at
all. The bar counts it, the columns show it, and the clear reaches every field
the selection covers.

**Tags**

A class says what a message **is**. A tag says something **about** one —
recurring, reversal, high-risk — which is a property of the values in front of
you, not of the layout. So it lives in its own section rather than in the parse
spec: nothing about a tag changes how a byte is read.

A tag is a label, a colour, and one or more conditions on fields of the bound —
or mapped (§5.22) — DDL, or on a **token** (§5.3, §11.1 below). Stored on the
class object as `tags`:

```jsonc
"tags": [
  { "label": "RECURRING", "color": "#bc8cff",
    "conditions": [
      { "field": "PROC-CODE.TRAN-CODE", "op": "one-of", "value": "28, 29" },
      { "field": "RESERVED-ELEMENT-48.LEN", "op": "equals", "value": "006" }
    ] }
]
```

| `op` | Holds when |
|------|-----------|
| `equals` | the field's value is this one |
| `not` | it is none of the listed values |
| `one-of` | it is any of them — a comma-separated list, or an array |
| `present` | the parse produced this id at all. Takes no value |

Rules:

- **Every condition must hold.** A tag is one statement; "any of these" is two
  tags wearing one badge, which is why `one-of` exists for the common case.
- Comparison is trimmed and case-insensitive — a `PIC X` field is space-padded on
  the wire and nobody should have to count the padding — and it accepts **any
  reading the field carries**: what the bytes read as before any override, what a
  TYPE override made of them, and what a SHOW override draws. These are exactly
  the three the value tooltip lists (§11.2), so what you can read you can write.
  A GMT timestamp is far easier to type as the date the column shows than as the
  microsecond count behind it, and neither should be the only one accepted.
  `not` holds only when **none** of the readings is a listed value: the claim is
  about the field, and the field is all of its readings at once.
  *(Widened 2026-09-09; before that only the displayed value was compared.)*
- **A field the parse never produced supports no claim about itself**, `not`
  included — a tag that fired on every message *missing* a field would be worse
  than one that never fired.
- **A tag with no conditions never fires.** An empty tag is one being written,
  and badging every message while it is half-typed is noise.
- Several tags can be true at once. They render after the type code in the Parse
  Results bar, in each tag's own colour, and say on hover which conditions
  earned them.

### 11.1 Tokens in a tag

A token is not in the DDL the class binds. It arrives inside the message with a
2-character id, and what that id **means** is declared in a token map elsewhere
in the repository — so a great deal of what a message is doing is stated by a
token being there at all, or by a value inside one, and neither was nameable in a
tag.

The field box takes **either kind**, and its menu offers the tokens the
repository knows before the DDL's own leaves, each beside the definition it
resolves to (`B8 · TB8-TKN`) — nobody remembers that the routing data is under
`B8`, and everybody remembers `TB8-TKN`, so the note is searched too.

- **A token is addressed by its id**, and the only question you can ask about the
  id on its own is `present`.
- **Its fields are addressed by that id in front of the leaf.** The token's own
  DDL qualification is dropped in favour of the id, so `TOKB4X.CARD-NUM` is
  written `B4.CARD-NUM` and the name says which token the value came out of. Only
  the first segment goes, so a group inside the token keeps its path
  (`B4.GRP.SUB`). Token ids are two characters and DDL leaves never are, so the
  two namespaces cannot collide.
- **A token's fields are offered once the token is named** in one of that tag's
  own conditions. Resolving a token's definition parses every candidate file it
  passes, so doing it for every token in the map on the chance one gets used is a
  scan of the whole repository per keystroke; it is done one id at a time and
  cached on the DDL tree version.
- **`present` is satisfied by a token whose DDL is not loaded.** Every other op
  treats an entry that errored as no value at all, but a token with no definition
  is still ON THE WIRE, and its being there is exactly what was asked about.
- A tag on a token field fires only where tokens were actually read: a spec that
  never reads a token area (§5.3) produces none, and the condition simply does
  not hold.

**Test Bar** (below the tab content area)
- Collapsible panel. Format selector: Auto / Hex / ASCII.
- Textarea for pasting raw message bytes (hex string or ASCII text).
- **Auto** detection: if input matches hex character set (`0-9 a-f A-F : space`) and has even length → treated as hex; otherwise ASCII.
- **[Run]** button evaluates the current editor state (before Apply) against all specs and shows a per-spec pass/fail result with the index of the first failing recognizer.

### General behaviour
- Clicking a message in the left sidebar loads it into all tabs simultaneously.
- Import/Export as JSON covers the whole file: messages together.
- Apply saves to `localStorage` and recompiles the detection engine immediately.
- Each message can be duplicated in two clicks (Copy button in sidebar), enabling fast creation of variants.

---

### 11.2 The value tooltip — RAW, TYPE, SHOW

Hovering a value in Parse Results names every reading the field has. Once an
override is set the cell shows **one** of three readings; the tooltip shows them
all:

```
RAW  : 0000
TYPE : 00000001
SHOW : 0x00000001
```

`RAW` is the value as read before any override and is always present; `TYPE` and
`SHOW` appear only when that override is set and actually changed something. The
labels are the Overrides panel's own column names, so each line says which
override produced it. With nothing overridden there is one reading and the
tooltip is just the value, unlabelled — a label on the only thing there is would
be noise.

All three are matchable by a tag (§11), which is the point of showing them
together: the tooltip must never offer a reading the comparison would refuse.

**Where the overrides are applied.** They are applied to the field values once
per message, by `_msgApplyOverrides`, as the **first** statement of the render —
before the metadata bar, which draws the tag badges. So a tag is always tested against the reading the override produced.

## 13. Storage

- Message and file specs are stored in `localStorage` as JSON.
- YAML is a documentation format only — the internal representation is always JSON.

| Key | Holds |
|-----|-------|
| `up_format_specs` | The specs themselves (replaces `up_detect_rules`) — including each class's `tags` (§11) |
| `up_format_default_seen` | Every built-in default label ever offered, so a default the user **deleted** is not resurrected on the next run |
| `up_format_sync_ver` | Version marker for the one-time startup reconcile of saved specs against defaults; bumping it re-runs the merge |
| `up_me_last_sel` | Last-selected entity in the Class Editor |
| `up_me_sect` | Per-class section collapse in the Class Editor, keyed `label\|name` like `up_me_last_sel`. Stores **only the sections the user toggled**, so the content-derived defaults still open a panel a class has just gained (its first recognizer, its first binding); saving the whole map would freeze every section at whatever the class looked like when it was first opened |
| `up_me_fm_ui` | Per-spec Field Map view state — Collapse All, collapsed groups, Hide Redef, Auto Order + its revert snapshot. Deliberately a side-store keyed `name\|label`, never inside the spec JSON, so exports stay clean |
| `up_ddldoc_col_w` | DDL Doc column widths. Had no storage at all before — the table was `table-layout:auto`, so a dragged width was discarded on the next render and there was nothing worth saving |
| `up_res_col_w` | Parse Results column widths. Was carried inside `up_layout` as `colWidths`, which the auto-layout table then ignored on every render — the widths are owned by the shared column resizer now, under its own key like the other three tables' |
| `up_me_fm_col_w` | Field Map column widths |
| `up_layout` | The window's arrangement: `mode` (one of `quadr` / `quad` / `v2` / `h2` / `top2` / `bottom2` / `left1` / `right1` — the two quads are the same four boxes with the free axis swapped, `quadr` splitting each row and `quad` each column; `quadr` is the default), `slots` (which panel sits in each box, by id), and one `sizes_<mode>` map per arrangement — the split that suits four boxes is not the one that suits two, so saving one must not drop the others. Also carries the DDL tree pane's width and collapsed state, the audit detail pane's height, and the Parse Results hidden columns |
| `up_trk_col_w` | Field Tracking column widths. Keyed by column: `num` and `ts` by name, each value column by its **field id** (`f:<ID>`) — so a column that leaves the tracking and comes back returns the width it had |
| `up_me_fm_colvis` | Field Map column visibility — which columns the ⚙ chooser is showing |
| `up_msg_export_cols` | Export Messages column selection — which of Field / Description / Value / Raw Hex the text file carries |
| `up_me_ps_fmt` | Parse-spec **Format** shape — `compact` (one line per block) or `expanded` (one line per attribute). A reading preference, so it persists. |
| `up_me_sidebar_w` | Class Editor Entities column width |
| `up_bl_colvis` | Baselines table hidden columns. One entry per column PAIR — a column is the same column on both sides, so hiding it hides both halves and the mirrored layouts stay symmetric |
| `up_bl_sidebar_collapsed` | Whether the Baselines Saved list is collapsed to a rail |
| `up_bl_col_w` | Baselines table column widths. The view table and the compare table's left half share keys (`l-…`) — the compare table is the view table twice, mirrored — while the right half keeps its own (`r-…`), so dragging one side never moves the other |
| `up_bl_sidebar_w` | Baselines Saved-list column width. Shares the Class Editor's resizer table and drag handler — one gutter implementation, one saved-width restore |
| `up_baselines` | Saved baselines (§14) — a parsed message kept to compare later ones against. **Its own store, in the IndexedDB KV rather than beside the specs**: a baseline is a record of what a message looked like, not a definition of how to read one, and it must not travel in a class export or be touched by a class save |
| `up_me_sidebar_collapsed` | Class Editor Entities column collapsed to its rail |
| `up_me_test_h` | Class Editor Test subpanel height |
| `up_me_test_in_h` | Class Editor Test input height |
| `up_me_test_col_w` | Class Editor Test results column widths |
| `up_me_ps_split_h` | Parse Spec editor / block-reference split height |
| `up_me_ps_help_w` | Block-reference column width |
| `up_me_rec_split_h` | Recognizer list / reference split height |
| `up_me_rec_help_w` | Recognizer-reference column width |
| `up_me_fm_split_h` | Overrides table / reference split height |
| `up_me_fm_help_w` | Column-reference width |
| `up_me_test_collapsed` | Class Editor Test subpanel collapsed to its header |
| `up_cc_…` | Per-editor column-chooser state (prefix) |

Only `up_format_specs` is exported (§13.2); the rest is local view state.

### 13.1 Editor input format — JSONC

The Parse Spec textarea accepts **JSONC** — JSON with two relaxations:

- `//` line comments
- `/* … */` block comments
- Trailing commas before `]` or `}`

A string-aware preprocessor strips comments before `JSON.parse` so `//` or `/*` sequences inside JSON string values (regex patterns, URLs, etc.) are not treated as comments.

Round-trip:

- The parsed canonical array goes into `item.parse_spec` (what the interpreter reads).
- The raw annotated source text is preserved on `item.parse_spec_source`. Save/reload, localStorage, and import/export all carry this through.
- When the tab re-renders, the textarea is seeded from `parse_spec_source` if present, otherwise from `JSON.stringify(parse_spec, null, 2)`.
- The **Format** button strips comments and re-emits canonical JSON; it also updates `parse_spec_source` so the visible text and stored source stay in sync.

JSONC is editor-side only. The persisted `parse_spec` field is always canonical JSON, so any external consumer can read it without a JSONC parser.

### 13.2 Import / Export bundles

Both Message specs and DDLs share **one** Import / Export file format and **one** UI flow. The goal is to make "share my config" a single action without orphan references.

#### File shape

```jsonc
{
  "type":        "ddl-bundle-export",
  "version":     "2.0",
  "exported":    "2026-05-23T...",
  "specs":       [ /* optional — Message Entities, same shape as item.parse_spec storage */ ],
  "data":        { /* optional — DDL subtree { vol: { sv: { name: "<text>" } } } */ },
  "deOverrides": { /* optional — DE number overrides keyed by VOL/SV/FILE/DEF */ }
}
```

Any of the three content sections may be empty or absent. A pure-DDL export omits `specs`; a pure-spec export omits `data`. The importer reads what's present and shows preview sections only for what's there.

**Back-compat on import** — these legacy shapes are still accepted and normalised to v2.0 internally:

- `ddl-export v1.0` — old DDL-only export
- `msg-specs-export v1.0` — interim Messages-only export (short-lived precursor)

#### UI

Both entry points use **right-click context menus** for consistency with the existing DDL flow.

| Entry point | Pre-checks |
|-------------|-----------|
| Right-click on DDL tree → Export Volume / Subvolume / file… | The targeted DDLs; Messages section empty |
| Right-click empty DDL tree area → Export All… | All DDLs; Messages section empty |
| Right-click empty DDL tree area → Import… | (opens file picker) |
| Right-click on a Message in the editor sidebar → Export "X"… | That Message; auto-included DDLs |
| Right-click empty Messages area → Export All Messages… | All Messages; auto-included DDLs |
| Right-click empty Messages area → Import Bundle… | (opens file picker) |

#### Auto-include rules

| Toggle | Default | Behaviour |
|--------|---------|-----------|
| **Auto-include DDLs referenced by selected Messages** | ON | When a Message is ticked, every DDL listed in its `ddl_bindings` is auto-ticked in the DDL tree. A `ddl_bindings` value of `VOL/SV/FILE/DEF` is trimmed to `VOL/SV/FILE` for matching. |
| **Also include Messages that reference selected DDLs** | OFF | Opt-in reverse direction. When a DDL is ticked, any Message whose `ddl_bindings` resolves to that DDL is auto-ticked. Deliberately OFF by default because DDLs without Messages are still usable on their own. |

#### Import preview

For each Message in the file:
- **New** (green) — no matching `name` in the current state
- **Overwrite** (yellow) — a Message with the same `name` (case-insensitive) already exists; it will be replaced
- **⚠ N missing DDL refs** (red) — one or more `ddl_bindings` entries reference DDL paths that are neither in the file nor in the current `S.ddlTree`. The Message is still importable; the receiver will need to add the missing DDL(s) separately.

For each DDL in the file:
- **New** (green) — no DDL at `VOL/SV/FILE` in the current tree
- **Overwrite** (yellow) — DDL exists; content will be replaced
- DE overrides from the file are imported only for DDLs that are checked.

#### Merge semantics

- Messages match by `name` (case-insensitive). Same-name = overwrite; new name = append.
- DDLs match by `VOL/SV/FILE`. Same path = overwrite.
- Editing context matters:
  - **Editor open** during import → merge into `_meState.specs` and mark dirty (user must click Save to commit to localStorage). Lets the user undo by clicking Cancel.
  - **Editor closed** during import → write directly to `up_format_specs` via `_fmtSave`, and refresh the Settings → Message Detection list.

---

## 14. Open items (not yet decided)

- Full parse_spec for each existing message type (ISO ASCII, ISO EBCDIC, BIC ISO, STM, PSTM, NDC, B24).
- Exact format of per-recognizer inline editor UI (attribute fields per type).
