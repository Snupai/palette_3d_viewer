"use client";

import { RobViewer } from "~/components/RobViewer";
import type { PalletData } from "~/domain/palletTypes";

export type Candidate3DWorkspaceProps = {
  data: PalletData | null;
  cameraResetKey: string | null;
};

export function Candidate3DWorkspace({
  data,
  cameraResetKey,
}: Candidate3DWorkspaceProps) {
  return (
    <div className="h-full min-h-[640px] overflow-hidden bg-viewport">
      {data ? (
        <RobViewer
          data={data}
          cameraResetKey={cameraResetKey}
          visibleUpToLayer={data.layer_count}
          showSceneControls
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-viewport-ink/60">
          Select a generated candidate before opening 3D inspection.
        </div>
      )}
    </div>
  );
}
