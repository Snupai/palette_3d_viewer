# HTTPS für den angemeldeten Betrieb

Anmeldung und angemeldete Nutzung erfolgen im regulären Betrieb auch im Werksnetz über HTTPS, beispielsweise über einen Reverse Proxy. Sitzungscookies werden dort immer mit `Secure` gesetzt. HTTP bleibt auf lokale Entwicklung über `localhost` beschränkt, damit Zugangsdaten und Sitzungstokens im regulären Betrieb nicht unverschlüsselt übertragen werden.
