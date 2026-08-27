import { type Metadata, type Viewport } from "next";
import { MobilePlanner } from "~/features/mobile/MobilePlanner";

export const metadata: Metadata = {
  title: "Mobile plan creation",
  description:
    "Create a pallet plan on a phone: package dimensions, pallet, packages per layer, pattern selection.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MobilePlanPage() {
  return <MobilePlanner />;
}
