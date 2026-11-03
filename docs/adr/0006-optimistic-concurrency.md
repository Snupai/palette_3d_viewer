# Versionskonflikte statt stiller Überschreibungen

Schreiben und Löschen prüfen atomar die erwartete Datensatzversion. Bei einem Konflikt antwortet der Server mit 409 und der Client behält den ungespeicherten Entwurf, damit parallele Bearbeitung nicht zu stillen Überschreibungen führt.

Die Konfliktansicht zeigt links den eigenen Entwurf und rechts den aktuellen Serverstand mit hervorgehobenen Unterschieden. Zunächst werden vollständige Planstände verglichen und ausgewählt; alternativ kann der eigene Entwurf als Kopie gespeichert werden. Vor dem Speichern wird erneut die aktuelle Serverversion geprüft. Feldweises Zusammenführen ist eine mögliche spätere Erweiterung, weil unabhängig kombinierte Paketmaße und Platzierungen einen widersprüchlichen Plan ergeben können; automatisches Überschreiben oder Zusammenführen entfällt.
