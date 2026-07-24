import { readFile } from "node:fs/promises";

export type RuntimeComponent = "prompt-refiner" | "graph-engineer";
export type RuntimeStatus =
  | "current"
  | "reload_required"
  | "unmanaged"
  | "invalid_manifest";

export interface RuntimeInfo {
  component: RuntimeComponent;
  version: string;
  status: RuntimeStatus;
  reloadRequired: boolean;
  managedInstallation: boolean;
  bootInstallId: string | null;
  activeInstallId: string | null;
  installedVersion: string | null;
}

export interface RuntimeInfoOptions {
  installId?: string | undefined;
  manifestPath?: string | undefined;
}

type InstallManifest = {
  schemaVersion: "1.0";
  installId: string;
  components: {
    promptRefiner: string;
    graphEngineer: string;
  };
};

function validManifest(value: unknown): value is InstallManifest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const components = record.components as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === "1.0" &&
    typeof record.installId === "string" &&
    record.installId.length >= 8 &&
    record.installId.length <= 128 &&
    Boolean(components) &&
    typeof components?.promptRefiner === "string" &&
    typeof components?.graphEngineer === "string"
  );
}

export async function getRuntimeInfo(
  component: RuntimeComponent,
  version: string,
  options: RuntimeInfoOptions = {},
): Promise<RuntimeInfo> {
  const bootInstallId =
    options.installId ?? process.env.GRAPHVIGIL_INSTALL_ID;
  const manifestPath =
    options.manifestPath ?? process.env.GRAPHVIGIL_INSTALL_MANIFEST;
  if (!bootInstallId && !manifestPath) {
    return {
      component,
      version,
      status: "unmanaged",
      reloadRequired: false,
      managedInstallation: false,
      bootInstallId: null,
      activeInstallId: null,
      installedVersion: null,
    };
  }
  if (!bootInstallId || !manifestPath) {
    return {
      component,
      version,
      status: "invalid_manifest",
      reloadRequired: true,
      managedInstallation: true,
      bootInstallId: bootInstallId ?? null,
      activeInstallId: null,
      installedVersion: null,
    };
  }

  let manifest: InstallManifest;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!validManifest(parsed)) throw new Error("invalid manifest");
    manifest = parsed;
  } catch {
    return {
      component,
      version,
      status: "invalid_manifest",
      reloadRequired: true,
      managedInstallation: true,
      bootInstallId,
      activeInstallId: null,
      installedVersion: null,
    };
  }

  const installedVersion =
    component === "prompt-refiner"
      ? manifest.components.promptRefiner
      : manifest.components.graphEngineer;
  const reloadRequired =
    manifest.installId !== bootInstallId || installedVersion !== version;
  return {
    component,
    version,
    status: reloadRequired ? "reload_required" : "current",
    reloadRequired,
    managedInstallation: true,
    bootInstallId,
    activeInstallId: manifest.installId,
    installedVersion,
  };
}
