# HTTPS for authenticated operation

In regular operation, sign-in and authenticated use run over HTTPS even on the factory network, for example via a reverse proxy. Session cookies are always set with `Secure` there. HTTP remains limited to local development via `localhost`, so that credentials and session tokens are not transmitted unencrypted in regular operation.
