import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

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
setInterval(() => {}, 1_000);
