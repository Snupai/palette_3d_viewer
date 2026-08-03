import type { PalletData } from "~/lib/robParser";

export type { PalletData };

export type SavedPallet = {
  id: string;
  name: string;
  createdAt: number;
  data: PalletData;
  rawText?: string;
  originalRawText?: string;
};

export type PlanView = "original" | "edited";
