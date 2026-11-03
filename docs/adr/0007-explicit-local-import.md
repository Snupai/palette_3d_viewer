# Lokalen Bestand ausdrücklich veröffentlichen

Die Übernahme bisheriger Browserdaten in die Serverspeicherung erfolgt nach Anmeldung, mit vorheriger Übersicht und ausdrücklicher Bestätigung der Veröffentlichung, weil importierte Projekte anschließend auch anonym lesbar sind. Für neu angelegte Projekte wird der angemeldete Benutzer als Ersteller eingetragen; lokale Originale bleiben erhalten. Ein erneuter Versuch nach einem Verbindungsabbruch darf weder Duplikate noch stille Überschreibungen erzeugen. Bereits erfolgreich importierte, unveränderte Einträge werden übersprungen.

Bei abweichenden Inhalten verwendet der Import dieselbe Konfliktansicht wie parallele Bearbeitung: lokaler Plan links, vorhandener Serverstand rechts, Unterschiede hervorgehoben. Es werden vollständige Planstände ausgewählt, keine einzelnen Felder zusammengeführt. Der Serverstand kann beibehalten oder der lokale Stand als eigene Kopie mit neuer ID angelegt werden. Das vorhandene Original darf nur mit Schreibberechtigung und ausdrücklicher Auswahl des lokalen Stands ersetzt werden; auch dabei wird die erwartete Serverversion atomar geprüft. Ein erneuter Versionskonflikt erfordert einen aktualisierten Vergleich. Eine Importkollision ändert weder Ersteller noch Berechtigungen des vorhandenen Projekts.

Den gemeinsamen Werkskatalog dürfen auch beim Import nur Admins befüllen oder verändern.
