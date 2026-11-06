# Retain server record versions across deletion

Status: accepted. Amends [ADR 0006](0006-optimistic-concurrency.md) for issue #88.

Physical deletion restarted a recreated record at version 1, allowing an old
writer or synchronization link to mistake a recreation for the original.
Retain the `planner_records` row as a tombstone instead. Deletion atomically
checks ownership and the expected version, retains that version, marks the row
deleted, clears its JSON payload and removes its creator reference.

GET and list exclude tombstones. Updates and repeated deletes against them
conflict with `currentVersion: null`, preserving the existing API's missing-record
semantics. Creation with `expectedVersion: null` atomically inserts a new row or
replaces a tombstone, incrementing its retained version and assigning the new
creator and creation/update timestamps. Creation against a live row still
conflicts; updates cannot revive tombstones.

The migration adds a non-null `deleted` flag defaulting to false, preserving
existing records, versions and ownership. Previously physically deleted keys
cannot be recovered retroactively. Tombstones retain only the empty payload and
record metadata; they are not revision history and must not be purged without
another mechanism for retaining version continuity.

[ADR 0010](0010-browser-local-plans.md)'s consent, conflict, retry and new-identity
rules remain in force. No client protocol change or automatic republishing is
introduced.
