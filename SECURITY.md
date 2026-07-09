# Security Policy

## Supported versions

Kuraki is pre-1.0. Security fixes are applied to the latest release and `main` only.

| Version | Supported |
|---|---|
| `main` / latest | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/kuraki-app/kuraki/security/advisories/new) (preferred), or
- Email **saranshhardaha05@gmail.com** with subject `SECURITY: Kuraki`.

Please include:
- Affected version / commit and platform.
- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.

You can expect an acknowledgement within **72 hours** and a coordinated disclosure timeline once the issue is confirmed. Please give us a reasonable window to ship a fix before public disclosure.

## Scope & design notes

Kuraki intentionally has **no server-side end-to-end encryption** — this is a documented non-goal, not a vulnerability. The server must read your files to generate thumbnails, extract EXIF, and power search. Users who require E2EE are better served by Ente.

In scope for reports: authentication/session flaws, path traversal, SQL injection, SSRF, RCE, privilege issues, data-loss bugs (originals are meant to be write-once — anything that mutates or deletes an original unexpectedly is high severity), and dependency vulnerabilities with a practical impact.

Thank you for helping keep Kuraki and its users safe.
