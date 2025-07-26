import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  bundle: true,
  skipNodeModulesBundle: true,
  target: "node18",
  outDir: "dist",
  treeshake: true,
  platform: "node",
  external: [],
  noExternal: [],
  esbuildOptions: (options) => {
    options.conditions = ["node"];
  },
});