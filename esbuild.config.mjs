// esbuild.config.mjs
import { build } from "esbuild";

build({
  entryPoints: ["build/index.js"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  target: ["es2020"],
  external: [],
}).catch(() => process.exit(1));
