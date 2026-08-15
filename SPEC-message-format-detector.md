# Message Format Detector & Message Entity — Design Specification

Branch: `feat/format-detector` — **merged to `main`**  
Current work: `feat/parse-spec-positioning-tlv` — parse-spec positioning, per-bit entries, BER TLV (§5.11–5.15)  
Status: **Partially implemented** — see §14 for what remains

---

## Changelog

| Date | Change |
|------|--------|
| 2026-08-15 | **The block reference moved beside the spec, and stopped printing everything at once.** It opened between the toolbar and the editor, pushing the editor down the page, so reading the reference and reading the spec it describes were mutually exclusive; and it printed a fifteen-row index above a pane carrying every attribute and every example the block has — `read-fixed` ships ten — which is a lot to scroll past to reach one line. Now the right column of a fixed-height split with a drag bar beneath it: the reference scrolls inside that height so opening it never makes the card taller, and closing it returns the editor to full width. Two views: a **catalogue** grouped by what you are trying to do, and a **block** view — lead sentence, use-when, ONE starter example, then attributes as an accordion where opening one shows its default, its forms and **only the examples that use it**. Nothing in the block view is separately authored: the lead is the description's first line, the starter is the first example, and the per-attribute examples go through the same filter the old "show only the examples using X" used — a summary kept beside the text it summarises can disagree with it. **The reference follows the caret**, innermost block first, so a `read-fixed` inside a `when`'s `then` reports `read-fixed`. Resolution reuses the editor's tokenizer mask rather than `JSON.parse`: positions are the whole point, a second hand-written scanner is the trap that produced the byte-map bugs (2026-08-15, above), and the mask does not require the document to parse — so the reference still answers while a block is half-typed, which is when it is most wanted. See §11. |
| 2026-08-15 | **The conversion records where each byte came from, so there is one algorithm per format instead of two.** Asked, correctly: to draw the Raw panel the app must already turn the text into bytes, so it KNOWS which characters produced each byte — why work it out again? It did. `extractBytes` read the characters and threw the positions away on its first `.trim()`; `buildByteCharMap` then re-parsed the same text to recover them. Two implementations of one fact, per format, that had to agree forever — and they did not: for a dump line `extractBytes` took every hex pair in the region while `buildByteCharMap` matched four-character groups. Same answer on a well-formed line, different the moment one is not. That asymmetry is the whole story of the highlight faults: the **Raw** panel renders the bytes itself and labels each one `data-idx`, so highlighting byte N is a lookup and cannot be off; **Message Input** shows the user's own capture and had to reverse-engineer someone else's layout across NETARD standard, hexascii, hex, octal, EBCDIC, the combined interleaves and FUP — seven reconstructions, each its own chance to be off by one. `extractBytesMapped` now does both in one pass, recording `{s,e}` for each byte as it consumes the characters plus `.ascii` for the dump formats that echo bytes in a bracket column; `extractBytes` wraps it and `buildByteCharMap` returns its map, so neither can drift from the other again. **The bytes did not move — all 1472 baseline cases identical**, which is what that baseline is for. What the merge makes possible is a property the split design could not state: slice a byte's recorded span back out of the text and it must reproduce that byte. Eight cases assert it across the dump forms (hex and decimal offsets, differing label widths, pipe echo columns, an odd trailing byte), hex and octal, verified against eight injected faults including every off-by-one variant and `buildByteCharMap` growing its own parser again. |
| 2026-08-14 | **`read-tlv` honours its overrides and finds the value leaf by elimination; a variable group's length is auto-detected through a nested payload and stops rendering what the wire never sent.** Five faults from one production Mastercard message, all in the same area. (1) **`read-tlv` was the only read path that never ran the override pass** — nothing it emitted was reinterpreted, so `hex-char` set on every element showed in the Overrides table and changed nothing in the parse. (2) The **value leaf is matched by name** against `DATA`/`VAL`/`VALUE`, so a subgroup of `TAG`/`LEN`/`TAG-DATA` resolved its first two and not its third; the value went to the **group** id and an override on the leaf matched nothing. It is now whatever single leaf is left once tag and length are accounted for. (3) An **unmapped tag** covered only its value, orphaning its own tag and length bytes so the highlight jumped between rows; it spans the whole triple now, with `valueLength` still the value's own length because the engine checks a decimal TLV length against it. (4) **VLG auto-detect counted direct children**, so `ADD-DATA { LGTH, INFO { … } }` — payload in a nested group, hence one direct child — was rejected outright and had to be flagged by hand; the count is now leaves at any depth, while which leaf may *be* the length stays direct-children-only. Four call sites resolve this and all four had to change, or the Field Map column shows one answer while the parse does another. (5) The framed group then **rendered its unreached tail**: two hundred rows of "0 bytes, no value" under a one-byte payload, each printing the group's LEN as its entire value because every child borrows it as a display prefix. A fixed group's empty field is present-and-blank and keeps its row; a variable group's is a field the wire never sent. The LEN has its own row and is no longer reprinted beside the payload — the length column had excluded it on that flag since it was added, the value column and both clipboard helpers had not. See §5.15, §8. |
| 2026-08-13 | **The Data Editor is a page, its Test panel is a workspace, and a run answers "which entity" before "what fields".** Test existed to solve a parse without walking back to the Message Input panel, and then handed the user a three-button AUTO/HEX/ASCII toggle over a plain textarea — so the moment the bytes were EBCDIC, octal or a hexascii dump, back they went. It now carries that panel's config bar whole (the same six formats, the detected-format badge, a byte count, the Line Width widget editing the one `P.lineWidth`) and the same CodeMirror input, with per-field byte highlighting on hover and click. **A run now leads with detection over every entity and its winner becomes the selection**, so the fields shown are the fields the app would really have produced; nothing matching means nothing is selected, where before the panel showed the previously-selected entity's parse directly under "no match". The verdict is painted on the entity ROW, and it follows the waterfall: green on the winner, amber on one that would match but is shadowed by it, red only where the walk actually reached and rejected, dimmed past the winner — detection stops at the first match, and red must not claim a rejection that never happened. Two engine faults surfaced doing it. **`token-area` found no tokens in the editor at all**: the block read `ctx.item.type`, but a saved spec stores its type code as `name` and `type` is what detection builds from it, so every run asked with an empty type and `extractTokensFromMessage` — which branches STM/PSTM vs ISO/B24 on exactly that — returned null. Its own tests all passed because the harness hands the item a `type` the real object never has. And the Test input's byte↔character map was rebuilt with `buildByteCharMap`, which says in its own comment that it is for non-NETARD input; a wrapped record's map is built by `parseNetardLog` as it strips the wrapper, so hovering a field on a real capture lit nothing. Structurally: Test moved from a full-width bar carrying its own duplicate entity list, to a right-hand column, to a subpanel of the Entities column — a run annotates that list, and across the page from it the two halves of one action sat at opposite edges of the screen. The Data Editor itself is now a page reached from the top bar, and **Settings' Data Detection section is gone** — a read-only second copy of the same list, with the same armed-override marking to keep in step. Baseline unchanged throughout: 1472 cases identical. See §5.3, §11, §13. |
| 2026-08-08 | **Every type the Data Editor offers now decodes a length, and an undeclared length follows the spec rather than the byte values.** The dropdown offered nine types; the length decoder honoured two. `ascii`, `ebcdic`, `hex-ascii-decimal` and `hex-ebcdic-decimal` were byte-for-byte identical to declaring nothing — the decoder read byte VALUES and decided for itself. The consequence on a NonStop system: an EBCDIC length `F1 F9`, which is `"19"` typed on the box, decoded as **61945** whichever of the four was chosen, and a length that wrong sends every field after it to the wrong offset. Two more of the same kind surfaced while testing it: `uint-be` / `uint-le` carry no width and were missing from the integer pattern, so they fell through to the guess; and the decode was unconditionally big-endian, so **little-endian was offered everywhere and honoured nowhere** — a little-endian 19 read as 4864. Precedence is now override → block `"encoding"` → recognizer → ASCII-and-say-so; the block level already existed and `read-fixed` had honoured it since 2026-08-02, but the length paths never looked at it. One design point is worth recording: "no override → read it as the spec's encoding" is **two** questions, and the spec answers only the second. *Text or binary?* it cannot — `PIC X(2)` does not say and a binary length in a character field is ordinary on Base24 — so that stays a fallback; *if text, ASCII or EBCDIC?* it can, and byte values no longer get a vote. The §8 claim that EBCDIC needs no special case because the message is translated first was true only for input format `ebcdic`; a hex or NETARD capture arrives untranslated, which is why this was never noticed. All 1472 baseline cases unchanged — nothing that worked has moved. See §8. |
| 2026-08-04 | **Which fields are data elements, and what counts as a length, are now choices rather than compiled-in rules.** Two restrictions were limiting real DDLs. (1) A DE was a **top-level** row whose name was not literally `FILLER`, so a DDL could not exclude its own alignment padding under any other name — the field consumed a number regardless — and a DE could never sit on a nested field, which is exactly where one reported DDL puts them (04-level `FIELD-XX` / `FIELD-YY` inside a group). The default is unchanged but now overridable on the same `de` key: `false` excludes **without advancing the counter**, so the tail closes up rather than leaving a hole; `true` includes where the default says no, reaching inside a terminal group; `"children"` makes a group yield to its immediate children — one entry instead of marking the parent and every child. Fixed first because everything else misfired without it: `_meOvDeAnchors` read any non-null `de` as an anchor via `+v \|\| 1`, and `+false` is 0, `+true` is 1, `+"children"` is NaN — all three would have anchored numbering at DE 1. (2) VLG required the length and its payload **wrapped in a group**, and a group could carry exactly one, so a flat `PAN-LEN` then `PAN` could not be expressed and two lengths at one level had nowhere to go. `vlg: true` now works on **any field** and means "the next field's length comes from this one" — the general rule of which the group form is a special case. Implemented in `_meReadOneFieldFromDef`, the one reader every path shares, so `read-ddl`, the bitmap walk and `de` entries cannot drift apart; the re-layout rides the same `ovShift` a `bytes` override uses. Group forms are untouched. UI: a selection action bar with segmented groups, multi-select by ⌘/ctrl-click (shift is deliberately not a modifier — it collides with the browser's text-drag selection), bulk selection via filter + "Select shown", inline editors rather than `prompt()` (blocked outright in some hosts, which makes a button look dead), and Reset arming itself before it fires. The Field Map shows all three DE forms and a plain-field VLG, with the selection form folded into the DE cell signature — all three render differently but all have `de === null`, so a patch-only repaint kept showing the previous one. See §7.1, §8.0. |
| 2026-08-02 | **`read-tlv` gains `encoding: "ascii"` — the TLV shape production ISO 8583 actually carries — and fixed-width rows finally report where they are.** A live buffer looks like `0002 0005 HELLO 0003 0004 VISA`: a 4-character tag, a 4-character **decimal** length, then that many characters of value as text. Neither existing mode could read it. `binary` reads the length as a big-endian integer, so `"0005"` is `0x30303035`; `ascii-hex` hex-decodes the whole buffer before framing, which turns `HELLO` into garbage and also makes `tag_length`/`length_length` count decoded bytes rather than characters. The new mode decodes nothing: the widths count characters, the length parses as decimal, and the value is text. A length whose characters are not digits is **reported** rather than read as zero — the silent zero is precisely how the VLG length bug behaved (§8). The tag is keyed by **its characters**, so `tags` is written `{"0002": {"field": "CARD-TYPE"}}`; keying it by a hex rendering (`"30303032"`) would be unwritable, and a key mismatch fails silently, leaving unmapped rows and no error. Separately, the fixed-width path had **never** set `startByte`/`endByte` in any mode while the BER path always did, so the same buffer showed a populated Bytes column with `ber: true` and a blank one with `tag_length`/`length_length` — the values were right, but a tag could not be lined up against the raw dump. Positions are now reported wherever they are honest, which is `binary` and `ascii`; `ascii-hex` omits them rather than guessing, since no decoded byte corresponds to one message byte. 9 baseline cases moved, all the same shape: fixed-width TLV rows gaining positions, with values and hex unchanged. See §5.15. |
| 2026-08-02 | **Which leaf means "length" is no longer hardcoded — `vlg_identifier`; `read-ddl` honours variable-length groups.** The VLG auto-detect assumed the names `LEN` / `LGTH` / `LENGTH` and a 2-4 byte width. Both are assumptions about someone else's DDL. `vlg_identifier` on `read-ddl` and `read-bitmap-fields` now says which name **this** DDL uses; omitted keeps the built-in names, a name matches only that one (and **wherever it sits** in the group, so a TAG may precede it), and `""` switches the guess **off** — the case that motivated it, a group whose first field is honestly called `AMT-LEN` but is not variable-length, was being framed by it and everything after it slid. The LEN's **width** now comes from the DDL definition of whichever leaf matched, so a 1-byte binary length works like an LLLVAR's 3; the old 2-4 gate silently ignored both. An explicit `overrides[…].vlg` still wins: the attribute governs the *guess*, not the user's choice. Separately `read-ddl` read every field at its declared length, so an LLVAR group read its DATA at the DDL's **maximum** and every field after it was wrong; the group is now read as a unit and the difference between what it consumed and what the DDL declares feeds the same running `ovShift` correction a `bytes` override uses. The VLG read is extracted into one helper shared with `read-bitmap-fields`, returning rows so `read-ddl`'s `fields`/`from`/`until` filters still apply. Auto-detect is aligned on **direct children** at all three call sites — the main group path had scanned every leaf at any depth, so a grandchild's LEN could frame the group above it (a grandchild LEN still frames its own group, just never its parent). The Field Map reads `vlg_identifier` off the spec so the VLG column shows what the parse will do, with `undefined` and `""` kept distinct end to end. **Content validation now follows the type override:** the declared type is deliberately kept on the field for the "declared ↩ override" annotation, and the content-vs-type check was still reading it — so a field whose override made its bytes legal stayed painted red. Bytes are judged against the override; only `ascii` still requires printable bytes, since overriding to ASCII is a claim *about* the bytes. UI: the VLG column shows one `VLG` marker instead of the LEN's field name (on the group when collapsed, on the LEN leaf when expanded) — production field names are long enough to blow the column out, and the old form printed the same fact twice one row apart. See §8. |
| 2026-08-02 | **One `overrides` map; `bytes` re-sizes a field; parse-spec help reworked into executable examples.** `de_map`, `var_length_groups` and `field_overrides` were three parallel arrays keyed by field id, folded at load into a single `overrides` map (legacy shapes still migrate, including bare-string `var_length_groups`). New `bytes` override re-sizes a field: an override stands in for an edit to the DDL, so it **always** wins, and the bytes it frees or claims re-lay out the rest of the record through a running `ovShift` counted once per field id so a REDEFINES cannot double-shift. Effective length is `bytes` → a fixed-width type's size → the DDL's declared length. The Overrides panel was rebuilt (column chooser, row count, resizable columns, VLG pill, column-click highlight) and a DE anchor now renumbers the tail without an explicit override on every element. `read-fixed`'s `type` and `encoding` were documented from the start and **ignored by the engine** — now implemented through the same converter a field type override uses, with `bcd` reported as unimplemented rather than silently dropped; 104 `combo/read-fixed` baseline cases had been recording the inert behaviour and were re-recorded. Help: every attribute description is lines or a form-by-form table rather than one paragraph, selecting an attribute narrows the examples to the ones that use it, and **every block ships at least one example the panel executes** — payload bytes, the spec, and the result the engine actually produced, so a documented result cannot drift from the code. Six enforcement tests keep it honest: every documented attribute has an example and is actually read by its block, every block has an executable example that runs clean, no description is a wall of prose, and the help table and the dispatcher agree in both directions. The attribute check matches `attrs.x` / a quoted key / a destructuring binding rather than a bare word — `type` and `encoding` sat inert for months while those words appeared all around them. See §5.4, §7, §8, §9. |
| 2026-08-01 | **`read` follows the cursor, not the field's declared DDL offset — `skip` was inert.** Reported: `[{"skip": {"length": 9}}, {"read": "SDLC-DEST"}, …]` returned bytes 0-1, 2-3, 4-7. The skip moved the cursor correctly; every `read` then jumped to its own declared DDL offset and ignored it, so the block could never step over a header the DDL does not describe. The rule is now one sentence: **the DDL supplies structure — length, type, sub-fields — the cursor supplies position, and `at` (§5.11) overrides position explicitly.** Reading a field in the middle without listing what precedes it is what `at` exists for. This also reverts v1.1.2.412, which had made `read` on a *group* use declared offsets to match leaves; leaves now follow the cursor, so both agree again — and reading the same non-repeated group twice advances instead of repeating. REDEFINES keeps its seek, since an overlay is by definition a second view of bytes another field covers. 10 baseline cases moved, all the same shape: a `read` that was the only block, previously jumping to its declared offset. See §5.7. |
| 2026-08-01 | **The spec is now checked against the code by the test suite.** Every stale section this week was found by eye — DDLMM described as live long after it was decommissioned, recognizer types renamed underneath the table, the hex overrides added without documenting them, §11 describing tabs that are collapsible sections, `priority` badges removed a month earlier, and `min-length`/`max-length` where the **help named the wrong attribute** so a recognizer written from it passed or blocked everything silently. Eight tests in `test.js` now assert the mechanically checkable claims: every parse_spec block type is documented; recognizer **evaluators** (`_R`, what actually runs) each have a help entry and a spec row, and the §4.4 table lists nothing that no longer exists; every alias is in the alias table; §9 lists every `type` and `display` option; §13 lists every localStorage key; no `§` cross-reference dangles and no table row is malformed; and DDLMM appears only in the changelog and its own tombstone. Mutation-verified against eight reintroduced drifts, including renaming an evaluator *without* renaming its help — the case the first version of the check missed, because it read the help table instead of the registry. Also filled from the code: §9 gained the full `type`/`display` option tables (only `binary` and `datetime` had been named), §13 gained seven storage keys, and §4.2 gained the nine spec-object fields it never listed. |
| 2026-08-01 | **§11 UI rewritten to the UI that exists; recognizer attributes and aliases corrected against the code.** The layout diagram still showed `priority` badges (removed 2026-05-31), had no **Files** list (shipped 2026-07-19) and no **Test** area at all, and described the right panel as *tabs* when it is five collapsible sections on one scrolling page — so a spec can be read end to end and a recognizer seen next to the parse_spec that depends on it. Test area documented: input (a formatted NETARD record works as-is), the AUTO/HEX/ASCII toggles that lock with a NETARD badge when the wrapper determines the format, and ▶ Run reporting per-spec which recognizer failed and where (`failAt`) before parsing with the winner — the reason it beats "detection returned UNKNOWN". Remaining `priority` prose removed from §4.1 and §4.2 (replaced by `kind`). Recognizer attributes fixed where the spec had drifted: `mti` gained `value` (4-char pattern, `#` = any digit), `hex-density`/`oct-density` take `min` + `encoding` (not `min_density`), and the alias table gained `length-prefix` → `length-payload` and `flag-prefix` → `flag-payload`, which are back-compat rather than HPE naming. |
| 2026-08-01 | **`min-length` / `max-length` accept the attribute their help documented.** The evaluators read `length`; the in-app help said `value`. A recognizer written from the help therefore got `length=0`, so `min-length` passed **every** message and `max-length` blocked **every** message — silently, since a recognizer only returns a boolean. Both now read `length ?? value`, so specs written either way work, and the help names `length` as canonical. Two tests cover both spellings, including that `max-length` with `value` actually rejects an over-long message rather than everything. |
| 2026-08-01 | **Documented what was only ever in the changelog: segmented files, file specs, and six recognizers.** Segmented-file handling had shipped 2026-07-19 and was described nowhere in the reference sections — `read-segment-fields` was not even listed in the §5.1 block table. New **§5.16** covers it: `read-bitmap`'s three modes (wire / file-read / declared) and how they map onto the three Base24 cases (non-IDF pre-6.0 reads `SEG-MAP` from the record, IDF 6.0 reads `FIID-SEG-MAP` from the record, non-IDF 6.0 supplies the map because its `SEG-MAP` is zeroed); that file-read uses the field's declared TYPE big-endian with bit 0 leftmost, trusts the field name, and treats an all-zeros map as an **error** rather than silently assuming all segments present — that pattern is precisely the 6.0 signal; the SEG-MAP bar override; and what manual override does on a segmented DDL. New **§3.2** documents `kind: 'file'` — file detection is filename-keyed and order-free, a file spec must carry a `filename` recognizer, and one with neither binding nor parse_spec is inert. §4.4 corrected against the code: `length-prefix`→`length-payload`, `flag-prefix`→`flag-payload`, `ebcdic-density` removed (it no longer exists), and `ebcdic` / `source` / `destination` / `filename` added. Recognizer names in the spec and in the code are now verified to match exactly, in both directions. |
| 2026-08-01 | **Explicit positioning — `at` / `peek` on every block; `read-bitmap` width from the spec.** Blocks could only read where the previous one stopped, so anything the DDL did not describe in sequence was unreachable. `at` takes an absolute byte (0-based, matching DDL Doc and the raw dump) or an anchor relative to a field an earlier block produced (`{"field", "offset", "from": "end"\|"start"}`, negative offsets allowed). Resolved once in the block dispatcher, so it applies to every block type — `skip` included, via its object form. The cursor stays where the positioned read ends; `"peek": true` restores it for an overlay read. An unresolvable position reports why and skips the block rather than reading from a wrong offset. Separately, `read-bitmap` gains `length` (bytes) for a map the message carries but the DDL never declares: the strict field-existence check is waived and the row is synthetic. Because such a map is not ISO 8583, bit 0 no longer doubles the read and bit 1 is kept as data rather than dropped as the secondary-present indicator. See §5.11–5.12. |
| 2026-08-01 | **Per-bit parsing in `read-bitmap-fields` (`de`), framed by the engine.** `{"de": {"55": [blocks]}}` reads one bit with its own blocks; every other set bit is unchanged. Keys are bit numbers — the DE-to-element relation still comes from the Overrides panel (`de_map`), and an optional `field` overrides it per entry. Names inside an entry resolve **within that element** (`ARQC` → `EMV-ELEMENT.ARQC`); since only leaves are compiled, a group is recognised by the prefix on its children's ids. Crucially the **engine frames the element and the entry only interprets it**: where a DE starts and ends is the same question for every DE and the engine already knows it, honouring the same `vlg` config as the default walk. Blocks run inside that window and the cursor resumes at the boundary whatever they did, so a runaway read is reported and stopped instead of consuming the DEs that follow. A length the *message* states cannot exceed the message and is reported; a size the *DDL* declares is only capacity — a message carrying fewer tags than the DDL has room for is normal — so it is clamped in silence. See §5.14. |
| 2026-08-01 | **`read-tlv`: BER framing and tags filed into DDL elements.** EMV DE-55 is BER-TLV, not fixed-width: tags are 1 **or** 2 bytes and lengths above 127 use the `81`/`82` long form. A fixed `tag_length` mis-frames the first 1-byte tag (`82`) and every triple after it silently becomes garbage — `"ber": true` parses the real rules. `tags` maps each tag to the element that receives it, filling that subgroup's LEN and DATA leaves; `tag_field`/`length_field`/`value_field` name those leaves when the layout is not EMV, per read-tlv or per tag; `unknown` chooses `emit`/`skip`/`error` for unmapped tags. **Whether the tag itself is stored is read from the DDL** — a subgroup declaring a TAG leaf gets it, one that does not is already identified by its element — so there is deliberately no `store_tag` attribute that could disagree with the DDL. `field` is optional inside a `de` entry, where the element being read is itself the buffer. Fixing this required teaching the resolver to recognise a group by the prefix on its children's ids: only leaves are compiled, so `"field": "ARQC"` matched nothing and every tag→group mapping failed. See §5.15. |
| 2026-08-01 | **`length_prefix` — a length on the wire that the DDL deliberately omits.** Once a group's tags are mapped to elements, its LEN leaf holds nothing worth keeping, so the DDL may leave it out — but the bytes remain on the wire and nothing could express that. `read` and `de` entries now take `length_prefix` (bytes); the payload is framed by what those bytes say rather than by declared sizes, and the prefix is emitted as its own `<field>.LEN-PREFIX` row. Emitting it is deliberate: consuming bytes without a row is exactly how four bytes of every STM record went missing under `RTE-GRP`. Sub-fields share the window in declaration order; a length past the end of the message is reported and clamped, and bytes no sub-field claims are reported rather than skipped. See §5.13. |
| 2026-08-01 | **Variable-length group LEN is decoded in the message's own encoding.** The LEN was converted to characters and `parseInt`'d with `\|\| 0` swallowing the failure, so on a **binary** message — where a length is a plain big-endian integer — `parseInt` saw non-digit bytes, returned `NaN`, and the group read **zero** bytes: it collapsed and every field after it shifted, with nothing reported. Now ASCII digits parse as digits and anything else as a big-endian integer, in one rule shared with `length_prefix`. EBCDIC needs no case of its own (the message is translated to ASCII upstream), which makes the breakage narrower than it first appeared: binary only. Bounds replace the silent zero — past the end of the message stops and reports, naming how the length was read; past the payload the DDL declares is still framed by the wire but reported. Auto-detect of the LEN leaf is restricted to **direct children**: scanning every transitive leaf found a grandchild's `LEN` (a nested TLV triple's length) and read the first tag `9F26` as a 40742-byte length. See §8. |
| 2026-08-01 | **`read` on a group reads at its declared DDL position, like a field.** `read` on a **field** jumped to where the DDL says it lives; `read` on a **group** read at the cursor. Not a rule anyone chose: only **leaves** are compiled into the definition list, so no group has a record of its own to carry an offset (`RQST.SAVE-ACCT` and `RQST` are simply absent from it). With nothing to read a position from, `read` fell through to the occurrence matcher, which discards positions because occurrence 2 of a repeated group cannot use occurrence 1's — and plain groups inherited that. Both forms now use the DDL's positions, and re-reading a non-repeated group returns the same bytes exactly as re-reading a field does, instead of failing with "All 1 occurrences already read" (a message describing the machinery rather than anything the user did). A genuinely repeated id still consumes one occurrence per read and still reports running out. See §5.7. |
| 2026-08-01 | **DDL validation: two rules from the Reference Manual, both save-blocking.** (1) A DEFINITION whose items carry no level numbers compiles to **zero fields**; it used to save clean and then surface as a bogus "DDL not found" on the binding badge, because `getDDLFromPath` returns null both when a file/DEF is missing and when it compiles to nothing. (2) A group cannot carry a PICTURE or TYPE clause ("a group description cannot have either clause"; "a group's size is the total of the lengths of its member fields"). The second caught a live defect in `BASE/STM/DDLFSTM`: `04 RTE-GRP PIC X(11).` with two `06` items under it, where the parser charged **11 bytes for the group AND 4 more for the children while emitting neither child** — four bytes of every STM record belonged to no field, and nothing reported it because the byte count still added up. Fixed in the DDL by wrapping the children in their own group (`04 SAVE-ACCT.`), which named those bytes without moving any offsets. The binding badge now distinguishes "file missing" / "no such DEF" / "DEF declares no fields" instead of always blaming the path. |
| 2026-08-01 | **Keyboard: arrows only, everywhere.** The audit-record popup bound `v`/`s`/`p`/`Enter`/`1`–`4` and then called `preventDefault()` on **every** remaining plain keystroke; the DDL-picker overlay did the same with `Tab`/`S`/`Enter`. With either open the keyboard was dead across the whole app and stray letters fired actions. Both are reduced to the arrow keys — records and picker candidates navigate with ↑↓ (and ←→ in the popup, which its buttons already advertised but the handler never bound). The global `Escape` handler is gone too: every menu, modal and overlay it closed has its own visible control, and intercepting keys the user never aimed at this handler is what made typing feel unreliable. Verified with 25 non-arrow keys in both states — none captured. |
| 2026-08-01 | **Characterization baseline (`baseline.js` + `baseline.golden.json`).** 1472 cases run through the real engine, each one's full output serialized and compared byte-for-byte. Unlike `test.js` it asserts nothing about what is *correct* — it records what the code *does*, so a refactor that shifts one cursor calculation shows up as a diff in every case it touches, including cases nobody thought to write a test for. Recorded on untouched code **before** this branch's features, which is how they were shown to be additive: all 1064 original cases stayed identical. Attribute products are generated from the app's own `_PS_HELP` schema, so a new attribute is covered without editing the corpus; domains mix valid, edge and invalid values (error behaviour is part of the contract) and `undefined` means the attribute is omitted, so each product covers every subset of optional attributes. 64 ordered block pairs cover cursor hand-off. `node baseline.js --update` re-records deliberately, and the diff is reviewed in git. **Caveat worth stating:** "no drift" is not proof — it stayed silent on both the VLG binary-length fix and the group-position fix because no case exercised them. It protects only what it exercises. |
| 2026-08-01 | **Parse-spec help: worked examples for every new attribute, and a copy control.** The attribute rows shipped with the features but the examples did not, so the panel could say `at` exists without showing what it looks like. Twelve examples added across the affected blocks — absolute/relative/`from: "start"` positioning and a `peek` overlay, a wire length with the DDL's LEN omitted, a bitmap the DDL never declares, the full EMV case end to end, two DEs handled specially while the rest are untouched, and the scoped `read-tlv` form with no `field` — plus "Use when" guidance naming the situation each solves. `at`/`peek` render from one shared definition appended to every block's table rather than being repeated fifteen times. Each snippet carries a copy button holding the **raw** JSON (not the highlighted markup), so a spec can be lifted straight into the editor. All 50 examples are machine-checked: every block type in them is real and every one serializes. |
| 2026-07-20 | **Test bar format selector → AUTO/HEX/ASCII toggle that auto-detects NETARD and locks itself.** Replaced the `<select>` with a 3-state toggle styled like the parse-spec variant toggle. On every paste/keystroke (`_meTestUpdateFmtState`, `oninput`) the input is checked for a NETARD wrapper (SOURCE/DEST line or a formatted `H-`/hexascii block); if wrapped, a **NETARD** badge shows, the toggles dim and lock (forced to AUTO), reflecting that the format is stripped + auto-detected and the manual choice is irrelevant there. For bare/stripped input the toggles are live and drive `extractBytes` (`hex` un-hexes, `ascii` reads chars, `auto` runs `detectFormat`). `_meRunTest` reads the selection via `_meTestFmt()`. |
| 2026-07-20 | **Test bar sets the NETARD ruler width before stripping (fixes standard-format records collapsing to one char/line).** `parseNetardLog` clips/pads each standard-format data line to `W = rulerCol − leftMargin`, where `rulerCol` is `S.netardRulerCol` — a global the **Main panel** auto-detects from the longest content line on every input change, but the **Test bar** never set. With it at the default `0`, `W = max(1, 0−7) = 1`, so every data line collapsed to its first character (a real `0210` STM message became `020810…` garbage and failed recognition — the "auto works but sometimes returns junk" symptom). Extracted the Main panel's detection into a shared `_detectNetardRuler(text, isSubFmt)` (longest non-header, non-blank line; trailing `[ascii]` column for hex sub-formats) and call it in `_meRunTest` before `parseNetardLog`. Verified against `test/Message-Tests/Audit_GZ.txt`: a full formatted STM record now recognizes and parses **213 fields** in the Test bar, on both auto and manual formats — matching the main-flow equivalence baseline. |
| 2026-07-20 | **Test bar: a manual format no longer bypasses the NETARD wrapper-strip.** After the autodetect change, picking a format other than *auto* took the old `extractBytes` path over the *whole* pasted text (SOURCE/DEST/header lines included), so a formatted record's message "started" at the header and recognizers failed at offset 0 — auto worked, ascii/hex didn't. Now a wrapped record (SOURCE/DEST present, or a formatted `H-`/hexascii block → `parseNetardLog` returns source/dest/netardFmt) is stripped+decoded by `parseNetardLog` for **both** auto and manual; the manual format only overrides the label/engine format, never re-adds the wrapper. Only bare stripped input (no wrapper) falls through to `extractBytes` — which also fixes a latent case where bare hex on *auto* wasn't un-hexed. |
| 2026-07-20 | **Test bar autodetects formatted NETARD data and uses the recognizer-resolved encoding.** The Data Editor's Test panel decoded input with the simple `detectFormat`/`extractBytes` path plus the old EBCDIC density heuristic, so pasting a real formatted NETARD record (SOURCE/DEST/`H-`/hexascii headers) required stripping it first, and its encoding handling diverged from the main pipeline. On **auto**, the Test bar now runs the same `parseNetardLog` audit parser as Message Input — pulling the record's raw bytes straight from formatted data — and resolves ASCII/EBCDIC from the selected entity's recognizer (`_specEncoding`), decoding deterministically. Recognizers run on the raw bytes; the parse-spec engine gets the decoded stream plus `rawBytes` + the mapped input format, so `binary` bitmaps read raw (un-mangled) and digits/`hex` decode correctly — identical to a real parse. A manual format override still bypasses autodetect via `extractBytes`. |
| 2026-07-20 | **Startup sync reconciles saved specs with defaults field-by-field + persists the ascii-hex→hex migration.** The earlier startup merge only added entirely-missing *entities*, so an entity the user already had (e.g. ISO 8583 Standard from before it gained a parse_spec) never received the new default fields. Replaced with a versioned one-time `_fmtSyncDefaults` (gated by `up_format_sync_ver`): (1) migrates every saved spec and **persists** it — previously `_fmtGetData` migrated in memory only, so `ascii-hex`→`hex` never stuck; (2) **field-overlays** each default onto its matching saved entity, filling any field the saved copy lacks (parse_spec, source, bindings…) while the saved values win on everything set — "load defaults, apply your data on top"; (3) adds missing default entities (still `up_format_default_seen`-guarded so deleted ones aren't resurrected). Also: `_migratePsSource` now rewrites **wire-mode** read-bitmap `ascii-hex`→`hex` in the JSONC source (declared-mode seg-map `ascii-hex`/`ascii-bits` kept), so the displayed spec matches the array. Bump `_FMT_SYNC_VER` to re-reconcile after future default changes. |
| 2026-07-20 | **Startup merges missing built-in defaults onto saved specs (get both).** Saved specs (`up_format_specs`) take precedence over the built-in defaults, so a default added in a later version (e.g. the Segmented File template, 2026-07-19) never reached users who already had saved specs. `_fmtMergeNewDefaults()` now runs once at app startup: it overlays any built-in default the saved set doesn't already have (matched by unique label) onto the user's specs — saved customizations win on conflicts, missing defaults appear. A `up_format_default_seen` marker records every default label offered, so a default the user **deleted** is not resurrected on later runs (only genuinely-new defaults are added). No-op for fresh installs (they already get the full defaults) and idempotent. Kept out of `_fmtGetData` so reading specs never mutates them. |
| 2026-07-20 | **Character encoding is resolved once from the recognizer, not per parse-spec; detection runs on raw bytes.** Encoding (ASCII vs EBCDIC) must never force a separate parse-spec — that's only for different parse *logic*. A message's character encoding is now derived from the winning entity's recognizer (`_specEncoding`: the MTI recognizer's `encoding` wins, else the first recognizer that declares one, else ASCII) and attached to the detection winner. **Detection runs on the RAW bytes** (`detectMsgTypeTrace(rec.rawMsg, …)`, and the secondary FUP/token/netard-picker callers) instead of a pre-decoded stream, so an `ebcdic` MTI recognizer matches raw `F0 F8…` and an `ascii` one matches `30 38…` — the match that picks the entity also fixes the encoding (no density heuristic, no fallback). The EBCDIC→ASCII decode is then **deterministic** from that resolved encoding (replacing `_netardEbcdic`'s density guess). Field representation collapses to two values: **`binary`** (raw bytes — read from the pre-decode raw bytes so the message-wide decode can't mangle a raw bitmap) and **`hex`** (16 hex chars, ASCII or EBCDIC per the resolved encoding; `ascii-hex` kept as a legacy alias, auto-migrated wire-mode `ascii-hex`→`hex`, declared-mode `hex`→`ascii-hex` unchanged). Fixes the Switch case end-to-end: EBCDIC `0800` self-detects as "ISO 8583 Switch", PBIT-MAP reads `82 20 00 00 80 00 00 00` (un-mangled), DEs decode. Default BIC/Standard wire bitmaps → `hex`; Switch stays `binary`. Parse-spec editor's variant selector replaced with a 3-state toggle (Binary / ASCII) — selected/in-use/dim. |
| 2026-07-20 | **ISO 8583 Switch bitmap: `binary` encoding + separate PBIT-MAP/SBIT-MAP rows.** The default "ISO 8583 Switch" (SEM) parse_spec read its bitmap as `ascii-hex` (16 hex chars), but Switch messages are EBCDIC with a **raw** primary bitmap `PBIT-MAP PIC X(8)` (8 bytes) — so `read-bitmap` encoding is corrected to **`binary`**. Legacy `parseHPEISOMessage` read the bitmap straight from the DDL's `PIC X(8)` and ignored the spec, which masked the mismatch until a bound Switch spec routes through the parse-spec engine (engine obeys the spec — `ascii-hex` yielded 0 DEs on a real `0800`). Second fix, engine-side: `read-bitmap` now emits the primary and (conditional) secondary bitmaps as **separate rows, each exactly the declared PIC width** (X(8) raw / X(16) ascii-hex) instead of one merged double-width row; the secondary row is named from the DDL field declared right after the primary (e.g. `SBIT-MAP`) when it looks like a bitmap (bitmap-ish name or same width), else `<primary>-2`. The primary row still carries the full primary+secondary bitset so `read-bitmap-fields` walks every present DE. Verified on a real Switch `0800` (PBIT-MAP 8 + SBIT-MAP 8, DEs 7/11/33 decode identically to legacy); 129 tests pass. Default-only — no binding added to Switch (only ISO 8583 Standard ships a default bind); existing localStorage specs untouched. |
| 2026-07-19 | **Default specs: ISO 8583 Standard parse_spec, BIC binding, Segmented File template.** ISO 8583 Standard is now a full parse_spec — `read-ddl` ISO_PFX→MTI · `read-bitmap BMP` (ascii-hex) · `read-bitmap-fields` — bound to `SWITCH/1987/Standard ISO` (canonical ISO 8583:1987, "ISO" routing prefix + MTI + 16-char ascii-hex primary bitmap + DEs 2–128 per the Wikipedia field table). ISO 8583 BIC bound to `ISOPSEM`/`ISOSSEM` with the header read `from: STRT-OF-TXT`. A **Segmented File** default is added — a file template carrying the `read-bitmap` (declared-map) + `read-segment-fields` parse_spec, `*` filename, and NO binding (the user binds their own segmented DEFINITION; the missing-binding warning guides them). Defaults apply only to fresh installs; existing localStorage specs are untouched. |
| 2026-07-19 | **Parse-spec engine now drives extraction for bound message specs.** Recognized records whose winning spec has a DDL binding + parse_spec (STM, BIC, ISO Standard, …) are extracted by the parse-spec engine in the main pipeline, not the legacy parsers — scoring only that one binding (never the whole candidate pool), the winning spec resolved by **label** (unique; `Standard`/`BIC`/`Switch` share the name "ISO"). Legacy DDL *resolution* (detect → score → picker) is unchanged; only field *extraction* moved. Proven byte-identical to legacy: STM `Audit_GZ`/`HEXASCII-DUMMY` 213/213 fields, BIC/ISOPSEM 100% (primary bitmap). Two engine gaps closed to reach equivalence: (1) `read-bitmap-fields` auto-detects implicit **LLVAR** groups (first sub-field `*-LEN/LGTH/LENGTH`, 2/3/4 digits — same rule as the ISO layout builder) and honors the runtime LEN prefix; (2) a **shared** TYPE BINARY renderer (`_binaryFieldValue`, used by both `parseFlatMessage` and the engine) decodes binary fields identically per input format — integer for binary-class (hex/tandem/netard-dump/ebcdic), printable/[??] for ASCII-class — with the record's original bytes threaded through for the decode. A recognized message spec whose parse_spec reads DDL but has no binding shows a persistent "missing DDL binding" warning (it falls back to candidate scoring + the picker until bound). CI equivalence tests lock `engine ≡ parseHPEISOMessage` (LLVAR, partial+full) and `engine ≡ parseFlatMessage` (incl. TYPE BINARY across five formats). Full legacy-parser removal deferred until every in-use spec is bound + parse_spec'd. |
| 2026-07-19 | **Segmented-file (Base24 IDF) parsing + read-bitmap declared mode.** `read-bitmap` gains a **declared mode** (`bits`/`value` present) for a map that lives outside the payload — e.g. a `FIID-SEG-MAP` on the institution's IDF — consuming zero record bytes; its value comes from the block or the ad-hoc SEG-MAP input at parse time. `read-segment-fields` walks the bound DEFINITION's top-level `SEGn` fields and reads only the segments whose bit is set (mapped by the trailing number, non-consecutive OK), skipping absent ones and flagging leftover bytes. An inline SEG-MAP bar in Parse Results overrides the map per parse (file-spec and manual-segmented-DDL paths). Encoding vocabulary settled to one meaning each: `ascii-hex` (hex digits), `binary` (raw wire bytes), `ascii-bits` (0/1 text, spaces optional for readability). Parse-spec blocks renamed for consistency — `bitmap-fields`→`read-bitmap-fields`, `segment-fields`→`read-segment-fields`, `seg-map`→`read-bitmap` (declared); old names + `ascii-hex`-legacy encodings are **auto-migrated on spec load** (arrays + JSONC source), no runtime aliases. |
| 2026-07-19 | **Data Detection: Messages/Files split; file detection is filename-keyed and order-free.** The Data Editor sidebar splits into Messages and Files; a spec's `kind: 'file'` puts it in Files. File detection matches on the wrapper filename (`$VOL.SUBVOL.FILE`) only — a record with no filename can never be a file, so file specs never sit in front of (or slow down) message lookup, and the Files list has no manual order. A file spec must carry a filename recognizer, and one with neither a binding nor a parse_spec is **inert** (never claims records) — both surfaced as live warnings. FUP COPY records now pass their `$VOL.SUBVOL.FILE` to detection; a manually selected DDL still wins as Priority 1. The Settings → Data Detection section is expanded by default. |
| 2026-07-17 | **Full line-item clause-zoo support per the DDL Reference Manual.** Verified against the manual (docs/HPE_a00022739en_us …, pp. 55/74: "clauses can be in any order", only 88/89 must come last): every clause — AS, DISPLAY, EDIT-PIC, EXTERNAL, HEADING, HELP, JUSTIFIED, KEYTAG, LN, MUST BE, NULL, NOVALUE, [NOT] SQLNULLABLE, SPI-NULL, TACL, UPSHIFT, USAGE, VALUE, 88/89/66 levels — is tolerated in any position without corrupting PIC/TYPE/OCCURS/REDEFINES extraction and without warnings. Fixes: clause keywords inside quoted strings no longer fabricate clauses (HEADING "OCCURS 5 TIMES" was creating a phantom ×5; HELP "REDEFINES X" a phantom overlay; VALUE "PIC 9(9)" hijacked the PIC) — clause regexes run on a string-blanked copy while HEADING/AS keep the original; EDIT-PIC's keyword can no longer be read as the field's PICTURE (lookbehind); quoted picture strings (PIC "X(5)") are unquoted and sized; OCCURS works without TIMES and with INDEXED BY — the validator's size math now sees TIMES-less OCCURS (it previously mis-directed the REDEFINES size check). **FILLER per the manual:** repeated FILLERs all survive (dedup by id+offset — id-only silently dropped them), FILLER is transparent to DE numbering (neither owns nor advances the counter — user decision, consistent with "never referenced directly"), takes no Type/Display overrides, and the validator enforces its rules: mandatory PIC/TYPE, noncomputational PIC, nonnumeric TYPE, and no DISPLAY/HEADING/HELP/KEYTAG/MUST BE/NULL/REDEFINES/UPSHIFT. Tests 104 → 113. |
| 2026-07-16 | **A data element is a TOP-LEVEL field — nested structure never owns a DE.** The DE walker previously gave a number to every group and every non-terminal leaf at ANY depth, so a composite element (`02 DATA-ELEMENT-44. 04 LEN… 04 DATA. 06 …`) burned 2–3+ DEs — inflating a ~127-element record to 325 "DE fields" and pushing 106 of them past DE-128. Rule now: only depth-0 rows (group or leaf) of the bound definition own and advance a DE; every nested group/leaf carries none (tooltip: "Nested field — the top-level element owns the DE"). Applies to the Field Map, Auto Order eligibility/counting, and the engine's `bitmap-fields` consumption (same walker). **Migration:** DE anchors saved under the old inflated numbering are wrong — Clear DEs (header ↺) once, then re-run Auto Order. Regression-tested against a file holding several definitions (decoy fields + decoy comments in sibling DEFs must not leak into the bound DEF's field list, DE rows, or comment matching). |
| 2026-07-16 | **Auto Order is definition-scoped; DE numbering caps at 128.** The binding defines the boundary: a 4-part binding scopes comments AND eligible fields to its DEF section; a whole-file binding on a multi-DEF file resolves the record definition as the one declaring the parse spec's bitmap field (fallback: first DEF) and reports the choice ("…spans 3 definitions — scoped to ISOMSG"). Fields from other DEFs never match comments and are counted separately ("N fields outside the bound definition ignored") — a prod run had reported 325 "DE fields" because the whole multi-DEF file was walked. A 4-part binding whose DEF doesn't exist now resolves to ⚠ missing instead of silently falling through to the whole file. DE numbering hard-caps at **128** (a bitmap has 128 bits): fields past the cap show no DE pill (tooltip explains) while the uncapped sequence is kept internally so an Auto Order comment or manual anchor can pull an overflowed range back into 1–128 (e.g. a secondary-elements binding re-anchored at 65). Toast reports matched/anchored/already-in-order/without-comment/out-of-scope/beyond-128 explicitly. |
| 2026-07-15 | **Field Map toolbar & column UX.** Auto Order moves from the Data Element header to the toolbar (before Collapse All); its toast reports honestly across bindings ("68 of 313 DE fields matched a comment (12 anchored, 56 already in order) · 245 DE fields across 2 bindings have no comment"). New ⚙ column chooser (same dialog as the parse panel) hides/shows #, Offset, Length, Data Type, Data Element, VLG, Display — hiding a column immediately re-fits the rest so FIELD absorbs the freed width. Column titles centered. A header-level ↺ next to the Data Element title clears ALL DE overrides at once (row-level ↺ still clears one); nudge chevrons and ↺ buttons are borderless until hovered. Editor toasts render at the BOTTOM of the Data Editor popup (the main-page toast host sits below the overlay). |
| 2026-07-15 | **Per-message Field Map toggle persistence.** Collapse All / collapsed groups, Hide Redef, and Auto Order (with its revert snapshot) persist per message spec in a localStorage side-store (`up_me_fm_ui`, keyed name\|label — never inside the spec JSON, so exports stay clean) and survive item switches and reloads. |
| 2026-07-15 | **VLG column: toggles instead of a dropdown.** Eligible group rows show a compact VLG pill; switching it on reveals a LEN pill on every leaf beneath (radio semantics — first leaf is the default LEN). Long sub-field names no longer squeeze into a narrow dropdown. Storage format (`var_length_groups: {group, len}`) unchanged. |
| 2026-07-15 | **Virtual window hardening.** Row height measured fractionally (zoom/DPI produce non-integer heights; integer math drifted spacers on long lists), plus redundant render triggers — a 350 ms scroll/viewport drift check and a ResizeObserver on the wrap — for machines where the scroll→rAF chain proved unreliable (production report: list stopped filling partway). |
| 2026-07-14 | **Auto Order — DE anchors from DDL comments.** Toggle button in the Field Map's Data Element column header (shown when the parse spec uses `bitmap-fields`). Scans the RAW text of every bound file (comments intact, scoped to the bound DEF): the comment block preceding each field declaration is searched for the last `Bit map position = NN` literal (tolerates `postion`/`pos`, `:` or `=`, any case, `*`-line and inline `!…!` comments), building a field-name → DE map. **Minimal anchoring:** the target sequence is applied as the smallest `de_map` that reproduces it — a field is anchored (accent border) only when its comment DE differs from what it would extrapolate to given prior anchors, so fields already in natural order stay unmarked (a documented run like `TRACK2=35, TRACK3=36` needs one anchor, not two). Only uniquely-named DE-capable rows are matched; duplicates skipped; unmatched fields keep extrapolating. **Toggle:** the first press snapshots the prior `de_map` and applies; the button stays lit; a second press restores the snapshot (natural order / prior manual anchors). Notifications render inside the Data Editor popup (the main-page toast host sits below the editor overlay). A ⚠ toast lists genuine name-vs-comment mismatches — flagged only for `…ELEMENT-N` / `DE-N`-style names (e.g. `DATA-ELEMENT-40` commented `= 41`), never for ISO field names like `TRACK2 → DE-35`. |
| 2026-07-14 | **REDEFINES child no longer splits a group's DE.** A group like `02 DATA-ELEMENT-37. 04 DATA PIC X(12). 04 TLR REDEFINES DATA.` was not classified as a terminal group (TLR is a group child), so BOTH the group and `DATA` drew DE numbers — shifting every subsequent DE by one. Terminal-group classification now ignores REDEFINES children (an overlay adds no bytes): the group owns the single DE, `DATA`/`TLR`/its leaves carry none, and numbering continues correctly. Affects the Field Map display AND the engine's `bitmap-fields` consumption (same walker) — hand-set anchors added downstream to compensate for the old off-by-one should be cleared. |
| 2026-07-13 | **KEYTAG clause accepted on groups.** Per the HPE DDL manual, `KEYTAG key-specifier [DUPLICATES [NOT] ALLOWED]` marks a field **or group** as an Enscribe key field. The validator's space-in-name heuristic only knew clauses that follow a name on elementary items, so a group-level `02 GRP KEYTAG "pn".` (no PIC/TYPE before the clause) was falsely flagged "illegal space in name". `KEYTAG` and `DISPLAY` are now recognized as legal first clauses; string and numeric key-specifiers and the `DUPLICATES` tail all validate cleanly, and layout is unchanged (the clause is ignored for sizing, as before). |
| 2026-07-13 | **`read` of a repeated (OCCURS) field/group by canonical id.** `{"read": "SRVCS"}` where the DDL declares `SRVCS OCCURS n` (group or leaf occurrences emitted as `SRVCS[01].TYP`, …) no longer errors "Field not found in any DDL binding". Each `read` call consumes the **next occurrence** in declaration order — its leaves are read sequentially at the cursor (declared offsets ignored, loop idiom) and emitted under their `[NN]` ids — so `repeat`/`read-while` bodies walk `SRVCS[01]`, `SRVCS[02]`, … off the wire. Reading past the last occurrence yields an explicit "All n occurrences already read" error row. The parse-spec lint's known-id set now also accepts occurrence-stripped ids (`SRVCS`, `SRVCS.TYP`) and their group prefixes. |
| 2026-07-13 | **DDL-binding suggestion pick repaints validation.** Selecting a path from the DDL Bindings autocomplete list left the input's red "missing" border/badge from the last typed prefix until another keystroke; the pick path now runs the same live revalidation as typing. |
| 2026-07-13 | **Huge-DDL performance.** (1) `getDDLFromPath` results are memoized (keyed by path; invalidated on DDL-tree or DE-override changes) — it was re-parsing the full DDL on every binding keystroke, Field Map render, and lint pass. (2) Field Map Data Type / Display cells render as lightweight fake-select spans; a real `<select>` (auto-opened via `showPicker()`) materializes only on click — thousands of rows no longer create 2 live selects each at open. (3) Changing an override repaints only that field's cells (all `[NN]` occurrence rows) instead of re-rendering the whole right pane. (4) `_meFmCountUnresolved` and the binding-autocomplete entry list are cached per DDL-tree version. |
| 2026-07-13 | **Unresolved-TYPE warning uses repo-wide resolution.** The Overrides banner ("N DDL items not shown — unresolved TYPE references") resolved TYPE refs against the bound file only, falsely flagging types defined in another loaded DDL file; it now expands through the same repo-wide section registry as the DDL Doc (local sections still take precedence). Genuinely missing TYPEs still warn. |
| 2026-07-13 | **DDL Doc filter hides non-matching groups.** Group rows were always shown regardless of the filter; a group row now appears only when its own name matches or some descendant row matches — so filtering `NAME` no longer surfaces unrelated REDEFINES overlays (e.g. `ACCT`, `CRD-REVIEW`) whose subtrees contain no match. |
| 2026-07-11 | **Field Map expands nested OCCURS; overrides are occurrence-independent.** The Field Map override view now shows every occurrence of a nested OCCURS group as its own row (matching the parse results) instead of one `[01]` representative. A repeated field is one logical DE — only the all-`[01]` representative owns/advances a DE; the repeats render as rows with no DE. `field_overrides` are stored and matched by the occurrence-stripped id (`ACCT.MULT.INFO.NUM`), so a Type/Display override set on any occurrence applies to **all** of them — in the config UI, the parse-spec engine, and the main-parse value application. |
| 2026-07-11 | **`gmt-ts` display — NonStop JULIANTIMESTAMP.** New display-override option: decodes the field's raw bytes as a 64-bit big-endian JULIANTIMESTAMP (microseconds since the Julian-day epoch; Unix epoch = Julian day 2440588 = 210866803200000000 µs) and renders GMT date/time as `YYYY-MM-DD HH:MM:SS.ffffff GMT`. Reads raw bytes directly, so no type override is needed on the `BINARY 64` field. |
| 2026-07-11 | **Data-Type override dropdown simplified.** The seven fixed `uint8` / `uint16-be` / `uint16-le` / `uint32-be` / `uint32-le` / `uint64-be` / `uint64-le` options collapse to size-adaptive **`uint-be`** / **`uint-le`** — the integer width is the field's own byte length (BigInt, any width) — removing the fixed-width clutter and the "wrong width" validation error. Legacy `uintN` values still decode (engine + inline `parse_spec`) and are migrated to `uint-be`/`uint-le` on spec load. |
| 2026-07-11 | **Full nested-OCCURS support.** An `OCCURS` group inside another `OCCURS` (e.g. `MULT OCCURS 2` containing `INFO OCCURS 5`) is now handled everywhere. `buildDDLDocFields` sizes groups deepest-first and recomputes from settled offsets, so an inner OCCURS rolls up into its parent (`MULT` = 198, grandparent `ACCT` = 370, not 46/198). `parseHPEDDL`'s expansion is recursive: a leaf emits once per combination of enclosing occurrence indices, with a `[NN]` label at each level and offset `+ Σ(childSize·idx)` — `INFO` now repeats 5× within each `MULT`. Each expanded leaf carries `_occursPath` (outer→inner frames); legacy `_occurs*` scalars are kept set to the outermost frame. Consumers migrated: a shared `_occursShouldSkip` (the two `& ` eye-catcher actual-count scanners in `parseFlatMessage` + `_meReadDDLBinding`) counts each frame from its own real byte start; `_meWalkDEFields` collapses to one representative row per group (`_occursPath.every(idx===0)`), fixing duplicate rows / double DE numbering; `_meBuildDEMap` gathers a group DE's whole repeated block via occurrence-stripped id match; the PSTM ASCII relabel targets the outer occurrence segment only. |
| 2026-07-11 | **Import persistence fix.** `confirmImport` no longer routes imported message specs into the Data Editor's unsaved buffer whenever `_meState` merely exists — it now checks the editor overlay is actually **visible**. A closed-editor import persists directly (`_fmtSave`) instead of being silently dropped on reload; an open-editor import still stages for review + Save. |
| 2026-07-11 | **Override annotation + main-parse application.** The parse-results "Description" column is renamed **Type / Description** and now lists a field's configured override as `<new type> ↩ <original>` (REDEFINES-style arrow; applied type dimmed-white, original in redefine accent-blue) plus ` as <DISPLAY>` when a display override is set, sourced from the spec via `_fmtSpecByName`. The main parse now **applies** `field_overrides` (type + display) to the field values (once per message, `dataType` preserved), so the value column matches the annotation — previously overrides ran only in the parse-spec test engine. |
| 2026-07-11 | **Display override `text` → `ascii`; `ebcdic` added.** The Display-override dropdown renames `text` to `ascii` (raw bytes → printable ASCII, non-printable → `.`) and adds `ebcdic` (raw bytes decoded through the EBCDIC table). `text` still works as a back-compat alias and is migrated to `ascii` on load. `hex` unchanged (raw bytes, no charset conversion); `datetime`/`amount` still format the parsed value. |
| 2026-07-11 | **`uint64-be` / `uint64-le` Data-Type override.** The Data-Type override dropdown gains 8-byte unsigned-integer decoders (BigInt — the 32-bit helper overflowed past 4 bytes), consistent with the existing `uint8`/`uint16`/`uint32` options and covering the full 2⁶⁴ range without precision loss. |
| 2026-07-10 | **PIC sign & national handling.** `picSize` now counts `S` (separate leading/trailing sign) as **1 byte** in DISPLAY numerics, so `S9(5)` / `9(5)S` = 6 bytes (`COMP`/`COMP-3` unaffected — the sign folds into the packed/binary width). Value-column content validation (`normalizeDataType` / `validateFieldContent`) now recognises signed DISPLAY numerics (`S`/`T` → `SN`, accepts digits + `+ - space` and `A-R {}` embedded-sign overpunch), national (`N` → `NAT`, byte-validation skipped), and treats any `COMP`/`COMP-3`/`BINARY` field as binary (`B`) — fixing a prior false-positive where unsigned `COMP` numerics were validated as ASCII digits and trailing-sign fields flagged their sign byte red. |
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

> *Added to the spec 2026-08-01 — behaviour shipped 2026-07-19.*

`kind: 'file'` makes an entity a **file spec**; anything else is a message spec.
The Data Editor sidebar splits on it.

File detection is **filename-keyed and order-free**: a file spec matches on the
wrapper filename (`$VOL.SUBVOL.FILE`) via a `filename` recognizer (§4.4) and
nothing else. A record carrying no filename can therefore never be a file, so file
specs never sit in front of — or slow down — message lookup, and the Files list
needs no manual ordering.

Two rules follow:

- a file spec **must** carry a filename recognizer;
- a file spec with neither a DDL binding nor a parse_spec is **inert** — it can
  never claim a record. Both conditions are surfaced as live warnings in the
  editor.

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
| `binary` | At least one byte in range is non-printable (< 0x20 or ≥ 0x7F) | `offset`, `length` |
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
| `read` | Read a single DDL-defined field, **or a window of them from the cursor** | `field` (DDL field ID), `from`/`until` (walk a range at the cursor — `from` required, `until` inclusive), `length_prefix` (bytes of length on the wire, absent from the DDL — §5.13) |
| `read-fixed` | Read N bytes inline — no DDL ref needed | `length` (int literal OR field ID ref), `type`, `encoding`, `as` (DDL field ID) |
| `read-until` | Read bytes until sentinel(s) or EOM | `sentinels` (list of hex bytes), `eom` (bool), `as` (DDL field ID) |
| `read-length-prefix` | Read length N then N bytes | `prefix` (`uint8`\|`uint16-be`\|`uint16-le`\|`bcd2`), `as` (DDL field ID), `sentinels` (optional stop list), `eom` (bool) |
| `read-bitmap` | Read 8 or 16 bytes as bitmap, store result | `field` (DDL field ID), `encoding` (`binary`\|`ascii-hex`), `length` (explicit width in bytes when the DDL does not declare the map — §5.12) |
| `read-bitmap-fields` | Read all DE fields indicated by a bitmap, resolved via `overrides[…].de` (§7), honouring `overrides[…].vlg` (§8) | `bitmap` (ref to prior `read-bitmap` field ID), `de` (per-bit parsing — §5.14), `vlg_identifier` (§8), `overrides` (§8.1) |
| `read-segment-fields` | Read only the segments a prior `read-bitmap` marks present (§5.16) | *(bare string)* or `map` — field id of the declared/file-read map, `binding` |
| `skip` | Advance N bytes | `length` (int) |
| `read-to-end` | Consume remaining bytes | `as` (DDL field ID) |
| `when` | Branch on a prior field value | `field` (field ID), `is` / `not` (value, list, or range), `then` (block list) |
| `repeat` | Loop N times — N from a prior field | `count` (field ID), `body` (block list) |
| `read-while` | Loop body blocks while a guard predicate matches at the cursor; use when iteration count is unknown or unreliable | `while` (guard), `body` (block list), `max` (int \| field id) |
| `read-tlv` | Parse a DDL buffer field as repeating TLV triples until buffer exhausted | `field` (buffer; optional inside a `de` entry), `ber` (BER-TLV framing), `tag_length`/`length_length` (fixed-width form), `encoding` (`binary` \| `ascii` \| `ascii-hex`), `tags` (tag → DDL element), `tag_field`/`length_field`/`value_field`, `unknown` — §5.15 |
| `token-area` | Read tokens from the message (see §5.3) | `tokens` (`"ANY"` \| list), `from`, `until` |

**Every** block additionally accepts `at` and `peek` — see §5.11.

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

> *Added 2026-05-23 — `tokens`, `from`, `until` attributes; `"ANY"` is the canonical no-filter value.*
> *2026-08-13 — the type code is read from the spec's `name`, not only `type`.*

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

> *Both attributes were documented from the start but ignored by the engine until 2026-08-02;
> the characterization baseline recorded the inert behaviour for 104 `combo/read-fixed` cases
> and was re-recorded when they were implemented.*

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

### 5.7 `read` — the DDL gives structure, the cursor gives position

> *Settled 2026-08-01.*

**The DDL supplies structure — length, type, sub-fields. The cursor supplies
position. `at` (§5.11) overrides position explicitly.** A field's declared offset
is never used to place a read.

This is what makes `skip` mean anything. A spec stepping over a header the DDL
does not describe:

```jsonc
[{"skip": {"length": 9}}, {"read": "SDLC-DEST"}, {"read": "SDLC-ORIGIN"}]
```

reads `SDLC-DEST` at byte 9. Until 2026-08-01 every `read` jumped to its declared
DDL offset instead, so the skip moved the cursor and the next read ignored it —
the block was inert exactly where it was needed. Reading a field in the middle
without listing what precedes it is what `at` is for.

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

### 5.11 Explicit positioning — `at` / `peek` (every block)

> *Added 2026-08-01.*

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

The cursor **stays** where the positioned read ends, so following blocks continue
from there. `"peek": true` restores it afterwards, for an overlay read that must
not disturb the sequence.

A position that cannot be resolved — past the end, negative, an anchor not yet
read, a bad `from` — reports why and **skips the block**, rather than reading from
a wrong offset.

### 5.12 `read-bitmap` — explicit width

> *Added 2026-08-01.*

`"length": N` states the map's width in bytes for a bitmap the **message carries
but the DDL never declares**. The field need not exist in the bound DDL (the
strict existence check is waived) and the row is synthetic.

Because such a map is by definition not ISO 8583, two ISO-only rules are turned
off: bit 0 is **not** read as "a secondary bitmap follows" (so the read is never
silently doubled) and bit 1 is kept as ordinary data instead of being dropped as
the secondary-present indicator.

`at` and `length` are independent — `at` says *where*, `length` says *how wide*.

### 5.13 `length_prefix` — a length on the wire, absent from the DDL

> *Added 2026-08-01.*

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

### 5.14 `read-bitmap-fields` — per-bit parsing (`de`)

> *Added 2026-08-01.*

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

**Names inside the entry resolve within that element**, so `ARQC` means
`EMV-ELEMENT.ARQC`. Only leaves are compiled, so a group is recognised by the
prefix on its children's ids.

**The engine frames the element, the entry only interprets it.** Where a DE starts
and ends is the same question for every DE and the engine already knows it — from
the bitmap walk plus the group's LEN, honouring the same `vlg`
configuration the default walk uses. The entry's blocks then run inside that
window and the cursor resumes at the boundary whatever they did, so a block that
reads too far is reported and stopped instead of consuming the DEs that follow.
Window precedence: `length_prefix` → the group's VLG LEN → an explicit `length` →
the element's declared size.

A length the **message** states cannot exceed the message: that is malformed and
reported. A size the **DDL** declares is only capacity — a message carrying fewer
tags than the DDL has room for is normal — so it is clamped silently.

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
*(added 2026-08-14)*. A TLV subgroup holds the three parts of one triple, so once
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

**Every row honours its overrides** *(fixed 2026-08-14)*. `read-tlv` was the only
read path that never ran the type and display override pass, so nothing it
emitted was reinterpreted — not the mapped values, not the tags, not the lengths,
nor the buffer length in front of them. Synthetic rows have no DDL def and are
keyed by the id they are given, so an override on that id works like any other.

**An unmapped tag is one row spanning its whole triple** *(changed 2026-08-14)*.
It used to cover the value alone, which left its own tag and length bytes
belonging to no row at all and made the input highlight jump over them between
rows. `valueLength` deliberately stays the **value's** length: it means that
everywhere else in the engine — a decimal TLV length is checked against it — so
only the byte range widened.

`field` names the buffer and is **optional inside a `de` entry**, where the element
being read is itself the buffer.

**`encoding` — how the tag and length are written** *(added 2026-08-02)*

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
omitted rather than guessed. *(Fixed 2026-08-02 — the fixed-width path had never
reported positions in any mode, while the BER path always did, so the same buffer
showed a populated Bytes column one way and a blank one the other.)*

### 5.16 Segmented files — `read-bitmap` declared/file-read modes + `read-segment-fields`

> *Added to the spec 2026-08-01 — behaviour shipped 2026-07-19, file-read modes 2026-07-2x.*

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

**Naming the map.** `{"read-segment-fields": "SEG-MAP"}` is the shorthand. The
object form takes the same value as `map`, which is what you need when `binding`
is also set: `{"read-segment-fields": {"map": "SEG-MAP", "binding": 0}}`. With
neither, the block falls back to the most recent map any `read-bitmap` produced.

**SEG-MAP bar.** Parse Results shows an inline SEG-MAP input whenever the parse
used a segmented map — spec-driven or a manually selected segmented DDL. A value
typed there overrides the map for that parse; blank falls back to the spec's value
(declared mode) or to the file's own map (file-read).

**Manual override** on a segmented DDL walks the full DDL once, all segments
assumed present, since no spec is consulted. Typing a map in the SEG-MAP bar is
what narrows it to the present segments.

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
  "MSGTYPE":           { "type": "hex-char", "bytes": 2, "display": "hex" }
}
```

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

**Length decoding** *(rewritten 2026-08-08)* — one rule, shared with
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

> **Superseded.** Until 2026-08-08 this section read: *"if every length byte is
> an ASCII digit the value parses as digits, otherwise it is a big-endian
> integer. EBCDIC needs no case of its own because the message is translated to
> ASCII before parsing."* The translation claim holds **only when the input
> format is `ebcdic`** (§2). The same message captured as a hex or NETARD dump
> arrives untranslated, so an EBCDIC `"19"` reached the decoder as `F1 F9`, was
> not made of ASCII digits, and read as **61945**.

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

**How a complaint is reported** *(added 2026-08-08)* — a problem with a field
rides **on that field** as `issue`; it is never pushed as a row of its own.
Pushing it separately produced two rows carrying the same id — the real field and
a second, blank one — which is exactly the duplicate `TRACK2.LEN` that was
reported. `error` is different and means *this row is not a field at all*: it
gates the byte map, the render-time override pass and the coverage count, so a
real field with a complaint must never carry it.

### 8.0 A length field sizes the field after it *(added 2026-08-04)*

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

**Auto-detect** applies to **direct children only**. Scanning every transitive leaf
would find a grandchild's `LEN` — the length of a nested TLV triple, not of the
group — and read the first tag as a length. A grandchild `LEN` still frames *its
own* group; it just never frames the group above it.

**Which leaf is the length — `vlg_identifier`** *(added 2026-08-02)*

The auto-detect used to hardcode the names `LEN` / `LGTH` / `LENGTH` and a 2–4 byte
width. Both are assumptions about someone else's DDL, so both are now settable per
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

**The payload does not have to be a sibling leaf** *(corrected 2026-08-14)*. The
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

**A variable group's unreached tail is not rendered** *(added 2026-08-14)*. When
the length is spent the walk stops. A **fixed** group's empty field is a field
the message contains and left blank, and keeps its row; a variable group's is a
field the wire never sent. Emitting them anyway put a row of "0 bytes, no value"
under every remaining leaf — two hundred of them beneath a one-byte payload,
burying the field that is real. A child the length reaches only **partly** is
still emitted with the bytes it got: that is the boundary the trim must not
cross.

**The LEN is not reprinted on its payload** *(corrected 2026-08-14)*. Every child
borrows the LEN's rendered value so an LLVAR-style prefix can sit beside the
data. A VLG group's length has its own **row**, so printing it again showed the
same bytes twice — and on children the length left empty it was the entire value
column. The length column had excluded it on this same flag since it was added;
the value column and both clipboard helpers had not. An LLVAR prefix still
prints and still counts: it has no row of its own.

**`read-ddl` honours variable-length groups** *(added 2026-08-02)* — it previously
read every field at its declared length, so an LLVAR group read its `DATA` at the
DDL's maximum and every field after it was wrong. A group read this way rarely
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

### 8.1 Inline overrides on a block (`overrides`) *(added 2026-08-03)*

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

### 7.1 Which fields are data elements *(added 2026-08-04)*

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

Until 2026-08-02 a `type` needing more bytes than the DDL declared produced an
`override ignored` error row and left the value untouched. It now re-sizes the
field instead. The one thing still length-checked is an **inline** `type` on a
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

> *2026-07-31 — renamed with no aliases: `hex-ascii` → `hex-ascii-decimal`,
> `hex-ebcdic` → `hex-ebcdic-decimal`, and `hex-char` added. An override using an
> old name no longer converts.*

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
| `bitmap-list` | *(added 2026-08-03)* The same map read out as the bit NUMBERS that are set — `Bits — 2, 3, 5, 11, …` (no count: the row's description already states it). Nobody counts columns across 16 bytes to discover DE 11 is present. Prefers the engine's own bitset, which is exactly what `read-bitmap-fields` walks, so it reflects the ISO rule that bit 1 is the secondary-bitmap indicator on a wire map but real data on an explicitly sized one |

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

## 10. DDLMM — decommissioned

> *DDLMM was removed; this section is kept so the numbering of later sections is
> stable. Data Detection (§4) supersedes it entirely.*

DDLMM was a separate rule table that routed a record to a DDL by matching source,
dest and content, with a `TYPE` column naming the message short code and a `##`
sentinel for type-only rules. Recognizers (§4) do that job now, on the Message
Entity itself, so routing and the definition of a message live in one place
instead of two that could disagree.

Nothing in the current pipeline evaluates DDLMM rules. The only traces left in
the code are comments recording where each evaluation step used to be.

## 11. UI — Data Editor

> *Rewritten 2026-08-13 — it was a modal opened from Settings; it is a page
> reached from the app's top bar, and Settings no longer mentions it at all.*

Entry point: **⊞ Data Editor** in the app's top bar.

Flow:
1. User clicks **⊞ Data Editor**.
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
│  Data Editor                        [Delete] [Cancel] [✓ Save]  [✕]  │
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

**Sidebar — Messages and Files.** Two independent lists (§3.2). Order is manual
and authoritative: there is no priority field — it was removed 2026-05-31 because
two orderings that could disagree is one too many. The Files list needs no
ordering at all, since file detection is filename-keyed (§3.2). Each entry shows
a `⚠N` gap badge when the spec is missing a recognizer, a parse_spec or a DDL
binding; hovering names which.

**Right panel — collapsible sections, not tabs.** Identity, Recognizers, Parse
Spec, DDL Bindings and Overrides all live on one scrolling page and each collapses
independently, so a spec can be read end to end without switching context — you
can see a recognizer and the parse_spec that depends on it at the same time.

**The block reference sits beside the spec** *(rewritten 2026-08-15)*. It used to
open between the toolbar and the editor, pushing the editor down the page — so
reading the reference and reading the spec it describes were mutually exclusive.
It is now the right-hand column of a fixed-height split, with a drag bar beneath
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
- Three sub-sections, each collapsible:
  - **Overrides list** — only the fields that carry config, each with its
    settings as chips and a ✕ to remove it. Selecting one opens the editor.
  - **Editor** — Data Type, Bytes, Display, DE, and (on a group) Variable
    Length, plus that field's JSON. Edit either; the two stay in sync.
  - **Reference** — read-only, every field the DDL declares. It is the picker:
    select a row, then **+ Add Override**.

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

- Message and file specs are stored in `localStorage` as JSON.
- YAML is a documentation format only — the internal representation is always JSON.

| Key | Holds |
|-----|-------|
| `up_format_specs` | The specs themselves (replaces `up_detect_rules`) |
| `up_format_default_seen` | Every built-in default label ever offered, so a default the user **deleted** is not resurrected on the next run (§12) |
| `up_format_sync_ver` | Version marker for the one-time startup reconcile of saved specs against defaults; bumping it re-runs the merge (§12) |
| `up_me_last_sel` | Last-selected entity in the Data Editor |
| `up_me_fm_ui` | Per-spec Field Map view state — Collapse All, collapsed groups, Hide Redef, Auto Order + its revert snapshot. Deliberately a side-store keyed `name\|label`, never inside the spec JSON, so exports stay clean |
| `up_me_fm_col_w` | Field Map column widths |
| `up_me_fm_colvis` | Field Map column visibility — which columns the ⚙ chooser is showing |
| `up_msg_export_cols` | Export Messages column selection — which of Field / Description / Value / Raw Hex the text file carries |
| `up_me_ps_fmt` | Parse-spec **Format** shape — `compact` (one line per block) or `expanded` (one line per attribute). A reading preference, so it persists. |
| `up_me_sidebar_w` | Data Editor Entities column width |
| `up_me_sidebar_collapsed` | Data Editor Entities column collapsed to its rail |
| `up_me_test_h` | Data Editor Test subpanel height |
| `up_me_test_in_h` | Data Editor Test input height |
| `up_me_test_col_w` | Data Editor Test results column widths |
| `up_me_ps_split_h` | Parse Spec editor / block-reference split height |
| `up_me_ps_help_w` | Block-reference column width |
| `up_me_rec_split_h` | Recognizer list / reference split height |
| `up_me_rec_help_w` | Recognizer-reference column width |
| `up_me_fm_split_h` | Overrides table / reference split height |
| `up_me_fm_help_w` | Column-reference width |
| `up_me_test_collapsed` | Data Editor Test subpanel collapsed to its header |
| `up_cc_…` | Per-editor column-chooser state (prefix) |

Only `up_format_specs` is exported (§13.2); the rest is local view state.

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
- Exact format of per-recognizer inline editor UI (attribute fields per type).

**Settled since:**
- *PSTM services loop* — decided both ways, by input class. The binary spec is
  count-driven (`repeat` with `count: NUM-SERVICES`); the ASCII spec stays
  guard-based (`read-while`), because a `TYPE BINARY` counter cannot be read from
  an ASCII capture — that is precisely why the ASCII variant exists.
- *Auto-migration from DDLMM* (§10) — moot: it was decommissioned, not migrated.
