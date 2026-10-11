# Mobile dependency security

`npm ci` installs SDK-compatible patches and applies source-hash checked changes
from `scripts/dependency-patches.json`. `npm run audit:security` fails on every
unmitigated advisory, including moderate findings, and on audit-service failure.
It exercises real package behavior before accepting these exact two upstream IDs:

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): braces
  3.0.3 has no upstream patched release. Parsing and all recursive AST entry points
  reject nesting beyond 64 levels. Tests include deeply nested strings and supplied
  ASTs, with normal brace expansion retained.
- [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): node-forge
  1.4.0 has no upstream patched release. RSA signature verification rejects extra
  DigestAlgorithm elements. The regression signs a deliberately malformed nested
  ASN.1 structure, verifies rejection, and accepts a normal signature.

These packages remain reported by npm because local patches do not change their
published versions. No severity or package-wide exception is used. Review and
remove each mitigation when upstream provides a fix; a changed source hash fails
installation so dependency updates cannot silently invalidate a patch.

Two narrow overrides install patched UUID 11.1.1 for xcode and URI decoder 0.5.0
for query-string. The decoder is adapted to CommonJS at installation because
query-string 7 requires a callable CommonJS export. Real query decoding tests
cover malformed input and valid UTF-8. Registry integrity remains in the lockfile;
original and resulting source hashes are both checked.

The mobile app does not use forge to authenticate Kuraki server requests. These
fixes also protect the development/build toolchain. Do not substitute a speculative
Expo or React Native downgrade for leaf remediation.
