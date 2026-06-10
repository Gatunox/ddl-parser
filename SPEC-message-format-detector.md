# Message Format Detector & Message Entity — Design Specification

Branch: `feat/format-detector`  
Status: **Partially implemented** (`feat/format-detector`)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-31 | **Unified DE walker.** The Field Map UI and `bitmap-fields` now share one DE-numbering walker (`_meWalkDEFields`): numbering starts on the field after the parse spec's bitmap field, REDEFINES rows never receive/advance a DE, synthesized groups (terminal and intermediate) own one DE each with their leaves unnumbered, and `de_map` anchors (including group-id anchors) re-align the counter. What the Overrides table shows is exactly what the engine executes. |
| 2026-05-31 | **bitmap-fields group reads + VLG.** A set bit landing on a group reads all its non-REDEFINES leaves sequentially; a VLG-flagged group reads the first sub-field as LEN and distributes that many bytes across the rest (children keep their real qualified ids). Present DEs are read sequentially at the cursor — DDL offsets are ignored inside bitmap-fields since they assume every DE present. |
| 2026-05-31 | **read-ddl advances the cursor.** Fields with explicit DDL offsets now move the byte cursor past their end (Math.max, so REDEFINES never rewind), making `read-ddl … → read-bitmap/read-fixed` sequences work without manual `skip`. Previously the cursor stayed at 0 after walking HPE defs. |
| 2026-05-31 | **Field-override engine wiring.** `field_overrides[].type` (Data Type dropdown) is applied at parse time by every read path with the same length validation as the inline `read.type` attr (inline wins). New length-flexible types: `hex-ascii` / `hex-ebcdic` (decode bytes as text, parse base-16: "FF" → 255), `ascii`, `ebcdic` (charset render), `binary` (hex dump). `field_overrides[].display` (datetime / amount / hex / text) formats the parsed value into `displayValue`; `amount` honours leading `-` and trailing `D`/`C` sign conventions. |
| 2026-05-31 | `priority` removed from specs (manual sidebar order is authoritative); `_migrateSpec` strips stale keys. Dead DDLMM-era code removed: detect-rules editor, DDL/type picker modals, legacy de_map/vlg/field_overrides index-based handlers, unused splitters. |
| 2026-05-23 | `read-while` block added — guard-bounded loop for variable-count loops where the count field is unreliable (ASCII PSTM services). See §5.8. |
| 2026-05-23 | `repeat.count`, `read-fixed.length` (field-id ref), and `read-while.max` now auto-decode **binary** numeric fields by reading `rawHex` as big-endian unsigned int when the rendered value isn't pure ASCII digits. See §5.9. |
| 2026-05-23 | `read-until` / `read-length-prefix` sentinels accept decimal ints, `"26"`, and `"0x26"` interchangeably. |
| 2026-05-23 | Parse Spec editor accepts **JSONC** — `//` line comments, `/* */` block comments, trailing commas. Storage stays canonical JSON; the raw annotated source is preserved on `parse_spec_source` for round-trip. See §13. |
| 2026-05-23 | `read-ddl` gains `binding: "ANY"`, `fields`, `from`, `until` attributes. `null` accepted for back-compat; `"ANY"` is canonical. See §5.2. |
| 2026-05-23 | `token-area` gains `tokens`, `from`, `until` attributes with the same cherry-pick / window semantics as `read-ddl`. See §5.3. |
| 2026-05-23 | **Unified Import / Export bundle.** One file format (`ddl-bundle-export v2.0`) holds any combination of Message specs, DDLs, and DE-overrides. Right-click drives both — DDL tree → as before; Messages list → new context menu. Auto-include of referenced DDLs when exporting Messages; missing-DDL warnings on import preview. Legacy `ddl-export v1.0` and `msg-specs-export v1.0` files still import. See §13.2. |

---

## 1. Goals

- Replace the current regex-only detection system with a declarative, byte-level recognizer pipeline capable of 100% accuracy across all known and future message formats.
- Introduce a **Message Entity** concept that encapsulates detection, parsing rules, DDL bindings, and field overrides in one place.
- Support **200,000 messages** detection performance — recognizers must be fast, pre-compiled, pure functions.
- Keep full backwards compatibility with existing parsers until auto-migration is verified and complete.

---

## 2. Parsing Modes

Detection is **automatic** — user does nothing extra beyond what they do today.

| Mode | Trigger | Behaviour |
|------|---------|-----------|
| **Message mode** | Input is NETARD format (log, audit) → always a message. Raw blob where auto-detect returns a known Message type. | Use Message Entity pipeline: recognizers → DDLMM rules → DDL binding → parse_spec |
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
  ├── de_map            DE number assignments   (see §7)
  ├── var_length_groups variable-length LEN+DATA groups (see §8)
  └── field_overrides   per-field type + display overrides (see §9)
```

### 3.1 Identity fields

The `type` short code is the **universal identifier** used everywhere:
- Badge display on parsed messages
- DDLMM `TYPE` column references this string directly
- Scoring / DDL resolution chain

---

## 4. Recognizer System (Detection Pipeline)

### 4.1 Engine behaviour

- All specs sorted by `priority` descending at load time, compiled once.
- Per message: iterate specs → run recognizers in order → **first failing recognizer short-circuits that spec**.
- First spec where **all** recognizers pass → detected Message type.
- No match → `UNKNOWN`.
- All recognizer functions are pure: `(bytes: Uint8Array, attrs) → bool`.

### 4.2 Spec-level attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `name` | string | Unique identifier (matches Message `type` short code) |
| `priority` | int 0–100 | Higher = tested first. Clamped to 0–100. Ties broken by declaration order. Sidebar displays sorted descending |
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
| `binary` | At least one byte in range is non-printable (< 0x20 or ≥ 0x7F) | `offset`, `length` |
| `ascii` | All bytes in range are printable ASCII (0x20–0x7E) | `offset`, `length` |
| `numeric` | All bytes in range are ASCII/EBCDIC digits | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `alphabetic` | All bytes in range are ASCII/EBCDIC letters (A–Z, a–z) | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `alphanumeric` | All bytes in range are ASCII/EBCDIC letters or digits | `offset`, `length`, `encoding` (`ascii`\|`ebcdic`) |
| `uint8` | Single byte value or range | `offset`, `eq` \| `min`/`max`, `mask` |
| `uint16` | 2-byte integer | `offset`, `endian` (`big`\|`little`), `eq` \| `min`/`max` |
| `uint32` | 4-byte integer | `offset`, `endian` (`big`\|`little`), `eq` \| `min`/`max` |
| `min-length` | Message total length ≥ N | `length` |
| `max-length` | Message total length ≤ N — fails if message exceeds N bytes | `length` |
| `length-prefix` | Length field matches actual payload size | `offset`, `encoding` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `body_offset`, `includes_self` (bool) |
| `flag-prefix` | Flag field indicates actual payload presence | `offset`, `encoding` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `body_offset`, `body_length` |

**Aliases (HPE naming):**

| Alias | Maps to |
|-------|---------|
| `byte` | `uint8` |
| `word` | `uint16` |
| `dword` | `uint32` |

#### ISO 8583 semantic

| Type | What it checks | Key attributes |
|------|---------------|----------------|
| `mti` | 4-byte MTI is structurally valid | `offset`, `encoding` (`ascii`\|`ebcdic`) |
| `bitmap` | 8 or 16 bytes form a plausible bitmap | `offset`, `encoding` (`binary`\|`ascii-hex`\|`ebcdic`), `length` (`8`\|`16`) |

#### Text / pattern

| Type | What it checks | Key attributes |
|------|---------------|----------------|
| `regex` | Regex against decoded bytes at offset | `offset`, `length` (bytes to read), `pattern`, `encoding` (`ascii`\|`ebcdic`\|`auto`) |
| `ebcdic-density` | Fraction of bytes in F0–F9 ≥ threshold | `offset`, `length`, `min_density` (0.0–1.0) |
| `hex-density` | Fraction of bytes that are ASCII hex chars (`0-9A-Fa-f`) ≥ threshold | `offset`, `length`, `min_density` |
| `oct-density` | Fraction of bytes that are ASCII octal chars (`0-7`) ≥ threshold | `offset`, `length`, `min_density` |

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

The parse_spec is a **declarative traversal algorithm**. The DDL is primary — field offset, length, and type (PIC X, PIC 9, BINARY) come from the DDL unless overridden in `field_overrides`. The parse_spec adds what DDL cannot express: conditionals, loops, sentinel reads, variable sections.

### 5.1 Block types

| Block | Purpose | Key attributes |
|-------|---------|----------------|
| `read-ddl` | Read **all fields from the DDL Bindings** in DDL declaration order — no individual field listing needed | `binding` (int index into `ddl_bindings`, default 0) |
| `read` | Read a single DDL-defined field (offset, length, type from DDL) | `field` (DDL field ID) |
| `read-fixed` | Read N bytes inline — no DDL ref needed | `length` (int literal OR field ID ref), `type`, `encoding`, `as` (DDL field ID) |
| `read-until` | Read bytes until sentinel(s) or EOM | `sentinels` (list of hex bytes), `eom` (bool), `as` (DDL field ID) |
| `read-length-prefix` | Read length N then N bytes | `prefix` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `as` (DDL field ID), `sentinels` (optional stop list), `eom` (bool) |
| `read-bitmap` | Read 8 or 16 bytes as bitmap, store result | `field` (DDL field ID), `encoding` (`binary`\|`ascii-hex`) |
| `bitmap-fields` | Read all DE fields indicated by a bitmap, resolved via `de_map`, honouring `var_length_groups` | `bitmap` (ref to prior `read-bitmap` field ID) |
| `skip` | Advance N bytes | `length` (int) |
| `read-to-end` | Consume remaining bytes | `as` (DDL field ID) |
| `when` | Branch on a prior field value | `field` (field ID), `is` / `not` (value, list, or range), `then` (block list) |
| `repeat` | Loop N times — N from a prior field | `count` (field ID), `body` (block list) |
| `read-while` | Loop body blocks while a guard predicate matches at the cursor; use when iteration count is unknown or unreliable | `while` (guard), `body` (block list), `max` (int \| field id) |
| `read-tlv` | Parse a DDL buffer field as repeating TLV triples until buffer exhausted | `field` (DDL field ID of the buffer), `tag_length` (bytes per tag), `length_length` (bytes per length), `encoding` (`binary`\|`ascii-hex`) |
| `token-area` | Read tokens from the message (see §5.3) | `tokens` (`"ANY"` \| list), `from`, `until` |

### 5.2 `read-ddl` — full DDL binding read

> *Updated 2026-05-23 — added `binding: "ANY"`, `fields`, `from`, `until` attributes.*

`read-ddl` walks the DDL specified in `ddl_bindings[binding]` and reads every field in declaration order, exactly as the DDL defines them (offset, length, type, encoding). No individual `read` blocks are needed.

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

> *Added 2026-05-23 — `tokens`, `from`, `until` attributes; `"ANY"` is the canonical no-filter value.*

Reads the message's token area (tokens are the named 2-byte-prefixed records produced after fixed-section parsing).

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

### 5.4 `read-fixed` — length attribute

`length` accepts:
- **Integer literal**: `length: 4`
- **Field ID reference**: `length: LEN-FIELD` — uses the parsed value of that field as the byte count. The referenced field must have been read earlier in the same parse_spec.

### 5.5 `read-until` — multiple stop conditions

Any stop condition ends the read. All are optional but at least one must be specified.

```yaml
- read-until:
    sentinels: [0x1C, 0x1D]   # stop on any of these bytes
    eom: true                  # also stop at end of message
    as: BUFFER-A               # DDL field ID for metadata
```

> *Updated 2026-05-23 — `sentinels` entries accept decimal integers (`38`), bare hex strings (`"26"`), and `0x`-prefixed hex strings (`"0x26"`) interchangeably. The `0x` prefix used to silently parse as `0`; that is fixed. The same rule applies to `read-length-prefix.sentinels`.*

### 5.6 `when` — condition forms

```yaml
when: FIELD-ID
  is: "1"                    # exact match
  is: ["1", "2", "3"]        # set match (any of)
  not: "B"                   # negation
  not: ["1", "2", "3"]       # negation set
  then: [...]                # block list to execute if condition matches
```

Multiple `when` blocks on the same field act as if/else-if. Nested `when` blocks are supported.

### 5.7 `read` on group fields — DDL structure resolution

`read: FIELD-ID` where FIELD-ID is a group resolves automatically from DDL structure:

| DDL structure of FIELD-ID | Behaviour |
|--------------------------|-----------|
| Simple group (sub-fields, no REDEFINES/OCCURS) | Reads all sub-fields sequentially |
| Group with OCCURS | Reads the OCCURS fields N times (`_occursMax` from DDL) |
| REDEFINES another field | Seeks to redefined field's offset, reads sub-fields from there |
| REDEFINES + OCCURS | Seeks to redefined offset, reads OCCURS block N times |

No extra parse_spec attributes needed — all behaviour is derived from DDL structure.

### 5.8 `read-while` — guard-bounded loop

> *Added 2026-05-23.*

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
| `read-length-prefix` with binary prefix (`uint16-be` etc.) in ASCII input format | All fields in that block → `unreliable: true` |
| `field_override` with binary type (`uint32-be`, `uint16-be`, etc.) in ASCII input | That field → `unreliable: true` |
| DDL field declared as `BINARY` in ASCII input | That field → `unreliable: true` (existing behaviour, unchanged) |
| `token-area` — individual tokens with binary content | Marked unreliable at token definition level (existing behaviour, unchanged) |

ASCII-class formats: `ascii`, `netard-ascii`, `netard`.  
Binary-class formats: `hex`, `hexascii`, `netard-hex`, `netard-hexascii`, `ebcdic`, `tandem-dump`, audit.

#### 5.9.1 Decoding binary numeric fields as counts / lengths

> *Added 2026-05-23.*

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
      - read-length-prefix:
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

## 6. DDL Bindings (ddl_bindings)

A Message can reference 1 to N DDL paths. These are the DDLs used for field metadata (names, descriptions, base types, lengths, offsets).

```yaml
ddl_bindings:
  - SWITCH/ISO/ISO-FINANCIAL
  - SWITCH/ISO/ISO-AUTH
```

When no DDLMM rule matches, scoring is performed **only within the Message's DDL bindings** — not globally across all DDLs.

---

## 7. DE Map (de_map)

Declares DE number assignments for DDL fields when the DDL declaration order does not follow DE numeric order. Uses a **delta/anchor model**: only list fields where the DE number jumps or resets. All subsequent DDL fields increment sequentially from the last anchor.

```yaml
de_map:
  - field: REVERVED_DATA_FLD
    de: 124        # DE-124, next DDL field → DE-125, DE-126…
  - field: POS_DATA_FLD
    de: 60         # DE-60, next DDL field → DE-61, DE-62…
```

- Fields before the first anchor start from DE-1 in DDL declaration order.
- `bitmap-fields` uses `de_map` to resolve which DDL field to read for each set bitmap bit.

---

## 8. Variable Length Groups (var_length_groups)

HPE DDL has no LLVAR/LLLVAR type. Variable-length fields are expressed as a group with two sub-fields: `LEN` (PIC 9(2) or PIC 9(3)) and `DATA` (PIC X or PIC 9). Declaring a group in `var_length_groups` tells `bitmap-fields` to:
1. Read `LEN` sub-field.
2. Convert `LEN` value to integer N.
3. Read exactly N bytes into `DATA` (not the full declared `DATA` length).

```yaml
var_length_groups:
  - DE-2      # PAN:  LEN PIC 9(2) + DATA PIC 9(19) → read LEN, consume LEN bytes
  - DE-35     # Track 2
  - DE-45     # Track 1
```

---

## 9. Field Overrides (field_overrides)

Per-field overrides live on the **Message** definition (not per DDL binding). They apply to all instances of that Message type. If different overrides are needed for a different context, a new Message definition with different DDL bindings should be created.

Each override can set:
- `type`: how to **consume** the bytes (overrides DDL PIC type). Determines byte count AND interpretation.
- `display`: how to **format** the value for display (independent of consumption type).

```yaml
field_overrides:
  - field: DE-7
    type: uint32-be       # consume 4 bytes as big-endian unsigned int
    display: datetime     # display as formatted date/time
  - field: DE-55
    type: binary          # override PIC X → raw binary
```

Reliability: a field overridden to a binary type (`uint32-be`, `uint16-be`, `binary`, etc.) is automatically marked `unreliable` when the input format is ASCII-class.

---

## 10. DDLMM Integration

DDLMM rules remain **fully independent** from Message definitions. No structural change to DDLMM.

- The `TYPE` column in DDLMM rules references the Message `type` short code directly (e.g. `ISO`, `STM`, `HPDH`).
- Once a Message is defined with `type: HPDH`, that string becomes available in DDLMM rules automatically.
- The `##` sentinel: remains valid for content/source/dest routing cases. Redundant **only** for the "type-only, no content/source/dest" case — that scenario is now covered by Message DDL bindings natively.

---

## 11. UI — Message Editor

Entry point: **Settings panel → Message Detection section → \[Open Message Editor\] button**.

Flow:
1. User clicks **\[Open Message Editor\]** in Settings.
2. Settings panel **closes**.
3. Message Editor modal opens **full width**.
4. User edits messages / validators / applies.
5. Message Editor closes → back to normal app.

No nested overlays.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Messages                                     [Import] [Export]  [✕] │
├──────────────────┬───────────────────────────────────────────────────┤
│  MESSAGES        │  [ Identity ] [ Recognizers ] [ Parse Spec ]      │
│  ─────────────   │  [ DDL Bindings ] [ Overrides ]                   │
│  ▶ 100 iso-ascii │  ─────────────────────────────────────────────    │
│  ▶  90 bic-iso   │                                                    │
│  ▶  80 hpdh ←sel │  (active tab content — see tabs below)            │
│  ▶  50 ebcdic    │                                                    │
│  ▶   0 custom    │                                                    │
│                  │                                                    │
│  [+ New Message] │                                                    │
│                  │                           [Delete]  [Cancel] [Apply]│
│  RULES  (DDLMM)  │                                                    │
│  ─────────────   │                                                    │
│  01 ISO …        │                                                    │
│  02 STM …        │                                                    │
│  [+ New Rule]    │                                                    │
└──────────────────┴───────────────────────────────────────────────────┘
```

Sidebar messages are sorted by **priority descending**. A priority badge (e.g. `▶ 80 hpdh`) is shown when priority > 0.

### Tabs (right panel)

**Identity**
- Single row: Type code (≤5 chars) | Label (wider) | Vol dropdown | Priority (0–100) | Color picker

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
- Ordered — first binding is the default when no DDLMM rule matches

**Overrides**
- Three sub-sections, each collapsible:
  - **de_map** — field → DE number anchor table. \[+ Add row\]
  - **var_length_groups** — list of group field IDs. \[+ Add\]
  - **field_overrides** — field → type + display override table. \[+ Add row\]

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

## 12. Backwards Compatibility & Migration

### Detection cascade (runtime)

Both systems run in parallel. The new system is always tried first:

```
bytes
  │
  ▼
[NEW recognizer pipeline]   ← tried first on every message
  │ if UNKNOWN
  ▼
[OLD regex pipeline]        ← fallback for anything not yet migrated
  │ if UNKNOWN
  ▼
UNKNOWN
```

### Migration strategy — one message at a time

Migration is **manual and incremental**, driven by the user. No big-bang cutover.

For each message to migrate:
1. Define the full Message Entity in the new system (recognizers, parse_spec, DDL bindings, overrides).
2. Remove its corresponding entry from the old regex `_DEFAULT_DETECT_RULES`.
3. Test: if the new system fails to detect it → the migration is wrong. Fix it.
4. All other messages not yet migrated continue to work via the old fallback — zero disruption.

This means:
- A message present in the **new system only** → detected by new system, parsed by new parse_spec.
- A message present in **both** → new system wins (it runs first). Should not happen in normal flow — removing from old is part of the migration step.
- A message present in the **old system only** → detected by old regex fallback, parsed by existing parsers. This is the state of all unmigrated messages.
- A message present in **neither** → UNKNOWN.

### End state

Once all messages are migrated and verified:
- `_DEFAULT_DETECT_RULES` and old regex pipeline are deleted.
- Legacy parsers (`parseFlatMessage`, `parsePSTMMessageASCII`, `parsePSTMMessageBinary`, `parseHPEISOMessage`, inline ISO 8583 in `parseMessage`) are deleted.
- New system is the sole detection and parsing path.

---

## 13. Storage

- Message specs stored in `localStorage` as JSON.
- YAML is documentation format only — internal representation is always JSON.
- Key: `up_format_specs` (replaces `up_detect_rules`).

### 13.1 Editor input format — JSONC

> *Added 2026-05-23.*

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

> *Added 2026-05-23.*

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
- PSTM services loop: current implementation is heuristic (byte-detection based), not count-driven from `NUM-SERVICES`. Decision pending: fix to count-based, or preserve heuristic in parse_spec.
- Exact format of per-recognizer inline editor UI (attribute fields per type).
- Auto-migration implementation details (from old regex rules + DDLMM to new schema).
