import { NextResponse } from "next/server";
import { APP_HOME, readSetupState, resolvePython } from "@/app/lib/setup/paths";
import { hasNvidiaGpu } from "@/app/lib/setup/install";
import { portOpen } from "@/app/lib/setup/service";

/** Whether the pipeline can run, or the installer still has to be shown. */
export async function GET() {
  const [serviceUp, gpu] = await Promise.all([portOpen(), hasNvidiaGpu()]);
  const ready = serviceUp || resolvePython() !== null;
  return NextResponse.json({
    ready,
    home: APP_HOME,
    cuda: gpu.cuda,
    gpuName: gpu.name ?? null,
    installed: readSetupState(),
  });
}
