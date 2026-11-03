# Expliziter Speichermodus ohne automatische Offline-Synchronisierung

Die Anwendung verwendet entweder die lokale IndexedDB oder die konfigurierte Serverspeicherung. Ein nicht erreichbarer Server oder eine abgelaufene Sitzung löst keinen automatischen Wechsel zur lokalen Speicherung aus, weil dadurch auseinanderlaufende Datenbestände entstehen würden. In der Servervariante bleibt der aktuelle Entwurf bei solchen Fehlern im Browser erhalten und ausstehendes Speichern wird sichtbar angezeigt; Offline-Synchronisierung ist für die erste Version ausgeschlossen.

Ungespeicherte Serverentwürfe werden zusätzlich lokal gesichert, getrennt nach Server, Benutzer und Projekt. Nach erneuter Anmeldung wird ihre Wiederherstellung angeboten; nach erfolgreichem Speichern wird die zugehörige Sicherung entfernt. Diese Sicherungen sind keine automatische Synchronisierung und gehören nicht zum Import des bisherigen lokalen Planbestands.

Beim bewussten Abmelden werden die lokalen Entwurfssicherungen des abgemeldeten Benutzers für diesen Server entfernt. Bei ungespeicherten Änderungen wird vorher gewarnt; zur Auswahl stehen „Abbrechen“ und „Entwürfe verwerfen und abmelden“. Ein bloßer Sitzungsablauf entfernt die Sicherungen dagegen nicht.
