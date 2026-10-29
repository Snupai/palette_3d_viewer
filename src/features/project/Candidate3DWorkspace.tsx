"use client";

import { useT } from "~/i18n";
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
  const t = useT();
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
        <div className="text-body text-viewport-ink/60 flex h-full items-center justify-center px-6 text-center">
          {t("project.candidate3d.empty")}
        </div>
      )}
    </div>
  );
}
