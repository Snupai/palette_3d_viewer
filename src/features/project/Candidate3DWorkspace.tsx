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
    <div className="bg-viewport h-full min-h-[640px] overflow-hidden">
      {data ? (
        <RobViewer
          data={data}
          cameraResetKey={cameraResetKey}
          visibleUpToLayer={data.layer_count}
          showSceneControls
        />
      ) : (
        <div className="text-body text-viewport-ink/60 flex h-full items-center justify-center">
          Select a generated candidate before opening 3D inspection.
        </div>
      )}
    </div>
  );
}
