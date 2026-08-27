export function parseWrapperArguments(args) {
    let semantic = false;
    let dryRun = false;
    let optionsEnded = false;
    const prompt = [];
    for (const arg of args) {
        if (!optionsEnded && arg === "--") {
            optionsEnded = true;
        }
        else if (!optionsEnded && arg === "--semantic") {
            semantic = true;
        }
        else if (!optionsEnded && arg === "--dry-run") {
            dryRun = true;
        }
        else if (!optionsEnded && arg.startsWith("--")) {
            throw new Error(`unsupported wrapper option: ${arg}`);
        }
        else {
            prompt.push(arg);
        }
    }
    return {
        prompt: prompt.join(" ").trim(),
        semantic,
        dryRun,
    };
}
//# sourceMappingURL=wrapper.js.map