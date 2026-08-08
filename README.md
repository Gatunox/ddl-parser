# DDL Parser

NonStop / Base24 / ISO 8583 — multi-message analysis with field tracking.

A single-page tool for reading HPE NonStop DDL definitions and parsing captured
messages against them: message-format detection, parse specs, field maps, byte
coverage and per-field overrides.

- **Live:** https://ddl-parser.gu2.dev
- **Mirror:** https://gatunox.github.io/ddl-parser

---

## License

Copyright © 2026 Gatunox. All rights reserved.

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU Affero General Public License, version 3** or (at your
option) any later version, as published by the Free Software Foundation.

The full text is in [LICENSE](LICENSE). In plain terms:

- **You may** use it, study it, modify it and share it.
- **You must** keep the copyright notice and state what you changed.
- **You must** release any version you distribute **or host for others** under
  the AGPL too, with its complete source.
- **There is no warranty.** See sections 15 and 16 of the license.

That third point is the one people miss. This is a web application, and the
AGPL — unlike the ordinary GPL — treats *running it on a server for other
people* the same as handing them a copy. Put a modified version behind a URL and
you owe its users the source.

### Commercial licensing

The AGPL is deliberately strict, and it does not suit everyone. If you want to

- build on this in a **closed-source** product, or
- run a modified version as a service **without publishing your changes**, or
- ship it under terms that AGPL section 13 makes impossible for you,

then you need a separate commercial license, which is available. As the sole
copyright holder I can grant terms the AGPL does not.

**Contact:** ddl-parser@gu2.dev

Using this software commercially is fine under the AGPL — selling it, offering
it as a service, using it at work. What is *not* fine is doing any of that while
keeping your source closed. The commercial license exists for exactly that case.

---

## Build

`source.html` is the source of truth. `index.html` is generated from it and is
the file that gets served.

```bash
npm run build      # source.html -> index.html (bundles CodeMirror, obfuscates)
```

The obfuscation in the build is a packaging step, not a licensing one. It does
not restrict any right the AGPL grants you: the readable source is in this
repository, which is how the license requires it.
