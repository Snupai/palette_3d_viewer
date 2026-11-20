# Palletizing planning

Domain terms of the application for planning pallets and robot sequences.

## Language

**Werkskatalog**:
Shared collection of reusable pallet, gripper and palletizing station definitions (the "factory catalog").
_Avoid_: personal resource catalog

**Browserplan (browser-local plan)**:
A plan kept only in the current browser while using the server variant, available
for later explicit publication after sign-in.
_Avoid_: offline server plan, local-mode plan

**Synchronization (Synchronisation)**:
Explicitly publishing a Browserplan to the server or reconciling it with a
previously linked server plan, with a user decision on conflicting whole plans.
_Avoid_: automatic upload, field merge

**Import**:
A one-way transfer of an existing plan into another inventory; legacy local-mode
import keeps the local original, unlike Browserplan synchronization.
_Avoid_: synchronization (for legacy local-mode import)

**Fertigstand (finished version)**:
The frozen, immutable `.rob` of one saved plan version, created by "Als fertig
markieren". A plan has at most one current Fertigstand; marking again replaces
it, "Nicht mehr fertig" or deleting the plan withdraws it.
_Avoid_: release, Freigabe-Export

**HMI**:
A registered Raspberry Pi operator panel (MultipackParser) with its own device
token.
_Avoid_: client, Pi user

**HMI-Abgleich (HMI sync)**:
An HMI fetching the list of current Fertigstände from the planner and
downloading new or changed ones; it never changes the running plan by itself.
_Avoid_: synchronization (already means Browserplan publication)

**Planvorschlag (plan proposal)**:
A hint sent from a phone (via the HMI's QR code) to one HMI to take over a
Fertigstand; it only takes effect once the operator confirms it on the HMI.
An HMI has at most one open Planvorschlag; it ends accepted or rejected (by
the operator), superseded (newer proposal or withdrawn Fertigstand), expired
(24 h) or taken back (by the planner user).
_Avoid_: push, remote activation
