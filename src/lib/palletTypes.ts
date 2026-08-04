import type { PalletData } from "~/domain/palletTypes";

export type { PalletData } from "~/domain/palletTypes";

export type SavedPallet = {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  data: PalletData;
  rawText?: string;
  originalRawText?: string;
};

export type PlanView = "original" | "edited";
