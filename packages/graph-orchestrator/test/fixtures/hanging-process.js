import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const startupDelayMs = Number(
  process.env.GRAPH_TEST_CHILD_STARTUP_DELAY_MS ?? 0,
);
const skipDescendant =
  process.env.GRAPH_TEST_SKIP_CHILD_STARTUP === "1";

const startDescendant = () => {
  const descendant = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  writeFileSync(
    process.env.GRAPH_TEST_CHILD_PID_FILE,
    String(descendant.pid),
    "utf8",
  );
};

if (!skipDescendant) {
  if (Number.isFinite(startupDelayMs) && startupDelayMs > 0) {
    setTimeout(startDescendant, startupDelayMs);
  } else {
    startDescendant();
  }
}
setInterval(() => {}, 1_000);
