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

**Synchronization (Synchronisierung)**:
Explicitly publishing a Browserplan to the server or reconciling it with a
previously linked server plan, with a user decision on conflicting whole plans.
_Avoid_: automatic upload, field merge

**Import**:
A one-way transfer of an existing plan into another inventory; legacy local-mode
import keeps the local original, unlike Browserplan synchronization.
_Avoid_: synchronization (for legacy local-mode import)
