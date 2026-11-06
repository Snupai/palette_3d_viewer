# HTTPS for authenticated operation

In regular operation, sign-in and authenticated use run over HTTPS even on the factory network, for example via a reverse proxy. Session cookies are always set with `Secure` there. HTTP remains limited to local development via `localhost`, so that credentials and session tokens are not transmitted unencrypted in regular operation.

## Addendum: failed-login throttling (#87)

For the single-process LAN deployment (ADR 0009), failed logins are bounded in
memory by normalized username and client address, using expiring fixed windows.
Successful authentication resets username failures; address failures remain to
limit password sprays. Pending checks reserve capacity. A bounded map refuses
new entries at capacity instead of evicting active counters. Responses are
account-independent `429` with `Retry-After`; no permanent account lock is stored.

This deliberately accepts lost counters on restart and no coordination across
processes. Multi-process deployment requires shared or proxy-level limiting.
Forwarding headers are untrusted by default: Next.js has no socket peer in its
Request API, so unidentified clients share an address bucket. Explicit proxy
trust requires blocking direct app access and overwriting `X-Forwarded-For` with
one client IP. See [deployment](../DEPLOYMENT.md#login-throttling).
