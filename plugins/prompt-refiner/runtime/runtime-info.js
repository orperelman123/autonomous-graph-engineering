import { readFile } from "node:fs/promises";
function validManifest(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    const components = record.components;
    return (record.schemaVersion === "1.0" &&
        typeof record.installId === "string" &&
        record.installId.length >= 8 &&
        record.installId.length <= 128 &&
        Boolean(components) &&
        typeof components?.promptRefiner === "string" &&
        typeof components?.graphEngineer === "string");
}
export async function getRuntimeInfo(component, version, options = {}) {
    const bootInstallId = options.installId ?? process.env.GRAPHVIGIL_INSTALL_ID;
    const manifestPath = options.manifestPath ?? process.env.GRAPHVIGIL_INSTALL_MANIFEST;
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
    let manifest;
    try {
        const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
        if (!validManifest(parsed))
            throw new Error("invalid manifest");
        manifest = parsed;
    }
    catch {
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
    const installedVersion = component === "prompt-refiner"
        ? manifest.components.promptRefiner
        : manifest.components.graphEngineer;
    const reloadRequired = manifest.installId !== bootInstallId || installedVersion !== version;
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
//# sourceMappingURL=runtime-info.js.map