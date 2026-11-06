# Generic records with limited server validation

The server storage uses a generic table for JSON records instead of a separate table per store, because the existing access paths load complete records and then filter them in the client. The server validates allowed stores, IDs, permissions, expected version, JSON structure and size limits; full domain-level Zod validation remains in the client for now. Public readability of projects must be taken into account separately and must not be ruled out by blanket filtering on the signed-in creator.

Original photos are not stored permanently after extraction; only the adopted results belong to the saved plan. Additional storage for original photos is therefore not required for now.
