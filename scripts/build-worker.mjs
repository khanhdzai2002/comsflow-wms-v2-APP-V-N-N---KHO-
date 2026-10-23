import { build } from "esbuild";
await build({
  entryPoints: ["src/worker/main.ts", "src/worker/child.ts"],
  outdir: ".worker",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: true,
});
