# Admin bei der Initialisierung anlegen

Die Serverinstallation erhält bei der Initialisierung einen Admin mit sicherem Kennwort. Eine öffentliche Erstregistrierung nach dem Prinzip „der erste Benutzer wird Admin“ entfällt, damit der administrative Zugang nicht vom ersten Besucher der Installation abhängt. Weitere Benutzer werden vom Admin angelegt.

Initialisierung und Wiederherstellung des Adminzugangs erfolgen über einen lokalen Verwaltungsbefehl auf dem Server mit verdeckter Kennworteingabe. Wiederholte Initialisierung lässt einen bestehenden Admin unverändert. Ein expliziter Reset setzt ein neues Kennwort und widerruft dessen bestehende Sitzungen.

Die erste Version verwendet lokale Benutzerkonten. Eine spätere Anmeldung mit Windows-/Domänen- oder Microsoft-365-Konten ist eine offene Erweiterung und keine Voraussetzung für die erste Version. Die vorhandene Firmenidentitätsinfrastruktur ist noch unbekannt; Anmeldeverfahren, Zuordnung externer Identitäten und Zulassung von Firmenbenutzern werden erst nach dieser Klärung entschieden.
