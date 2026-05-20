# Message Format Detector & Message Entity — Design Specification

Branch: `feat/format-detector`  
Status: **Partially implemented** (`feat/format-detector`)

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
| `read-tlv` | Parse a DDL buffer field as repeating TLV triples until buffer exhausted | `field` (DDL field ID of the buffer), `tag_length` (bytes per tag), `length_length` (bytes per length), `encoding` (`binary`\|`ascii-hex`) |
| `token-area` | Trigger existing token parsing logic | — |

### 5.2 `read-ddl` — full DDL binding read

`read-ddl` walks the DDL specified in `ddl_bindings[binding]` and reads every field in declaration order, exactly as the DDL defines them (offset, length, type, encoding). No individual `read` blocks are needed.

Use this for messages where:
- All fixed fields are fully described in the DDL
- There are no conditionals, loops, or sentinel-delimited sections in the fixed area
- Only the post-fixed section (token area, variable buffers) requires explicit parse_spec blocks

```json
[
  { "read-ddl": null },
  { "token-area": null }
]
```

The `binding` attribute selects which entry in `ddl_bindings` to walk (0-based index, default `0`). If the message has multiple DDL bindings (e.g. a header DEF and a body DEF), use two `read-ddl` blocks with `binding: 0` and `binding: 1`.

```json
[
  { "read-ddl": { "binding": 0 } },
  { "read-ddl": { "binding": 1 } },
  { "token-area": null }
]
```

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

### 5.6 Reliability model

Reliability is **derived from the operation type and field type** — no explicit flag needed.

| Condition | Result |
|-----------|--------|
| `read-length-prefix` with binary prefix (`uint16-be` etc.) in ASCII input format | All fields in that block → `unreliable: true` |
| `field_override` with binary type (`uint32-be`, `uint16-be`, etc.) in ASCII input | That field → `unreliable: true` |
| DDL field declared as `BINARY` in ASCII input | That field → `unreliable: true` (existing behaviour, unchanged) |
| `token-area` — individual tokens with binary content | Marked unreliable at token definition level (existing behaviour, unchanged) |

ASCII-class formats: `ascii`, `netard-ascii`, `netard`.  
Binary-class formats: `hex`, `hexascii`, `netard-hex`, `netard-hexascii`, `ebcdic`, `tandem-dump`, audit.

### 5.7 Example parse_specs

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
  - token-area
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

---

## 14. Open items (not yet decided)

- Full parse_spec for each existing message type (ISO ASCII, ISO EBCDIC, BIC ISO, STM, PSTM, NDC, B24).
- PSTM services loop: current implementation is heuristic (byte-detection based), not count-driven from `NUM-SERVICES`. Decision pending: fix to count-based, or preserve heuristic in parse_spec.
- Exact format of per-recognizer inline editor UI (attribute fields per type).
- Auto-migration implementation details (from old regex rules + DDLMM to new schema).
