# Generische Datensätze mit begrenzter Servervalidierung

Die Serverspeicherung verwendet eine generische Tabelle für JSON-Datensätze statt einer eigenen Tabelle je Store, weil die bestehenden Zugriffe vollständige Datensätze laden und anschließend im Client filtern. Der Server validiert erlaubte Stores, IDs, Berechtigungen, erwartete Version, JSON-Struktur und Größenlimits; die vollständige fachliche Zod-Validierung verbleibt zunächst im Client. Öffentliche Lesbarkeit von Projekten ist gesondert zu berücksichtigen und darf nicht durch eine pauschale Filterung auf den angemeldeten Ersteller ausgeschlossen werden.

Originalfotos werden nach der Extraktion nicht dauerhaft gespeichert; nur die übernommenen Ergebnisse gehören zum gespeicherten Plan. Eine zusätzliche Ablage für Originalfotos ist daher zunächst nicht erforderlich.
