import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

// Guards against type-checking cost regressions. Some typing patterns (e.g. inferring a
// table type back through typebox's `Static`) silently cost ~1M type instantiations per
// repo or seed, slowing down every consumer's type-checking. The fixture exercises those
// patterns; it costs ~156k instantiations today (vs ~1.24M before they were fixed).
const INSTANTIATION_BUDGET = 300_000;

const tsgo = fileURLToPath(new URL("../node_modules/.bin/tsgo", import.meta.url));
const project = fileURLToPath(new URL("./type-perf/tsconfig.json", import.meta.url));

describe("type-checking cost", () => {
  test("stays within the instantiation budget", () => {
    const output = execFileSync(tsgo, ["-p", project, "--extendedDiagnostics"], {
      encoding: "utf8",
    });
    const instantiations = Number(/^Instantiations:\s+(\d+)/m.exec(output)?.[1]);

    expect(instantiations).toBeGreaterThan(0);
    expect(instantiations).toBeLessThan(INSTANTIATION_BUDGET);
  }, 60_000);
});
