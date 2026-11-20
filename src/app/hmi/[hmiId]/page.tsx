import type { Metadata } from "next";

import { HmiProposalScreen } from "~/features/hmi/HmiProposalScreen";

export const metadata: Metadata = { title: "HMI" };

/**
 * `/hmi/[hmiId]` — the target of the QR code on an HMI (ADR 0013): propose
 * a Fertigstand to that HMI from a phone. Needs a sign-in.
 */
export default async function HmiPage({
  params,
}: {
  params: Promise<{ hmiId: string }>;
}) {
  const { hmiId } = await params;
  return (
    <main className="fable-app">
      <HmiProposalScreen hmiId={hmiId} />
    </main>
  );
}
