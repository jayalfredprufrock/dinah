import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: {
      devExports: true,
    },
    format: ["esm", "cjs"],
    sourcemap: true,
    entry: [
      "src/index.ts",
      {
        streams: "src/streams.ts",
        cdk: "src/cdk.ts",
      },
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test.json",
    },
  },
});
