import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.experiments = {
      ...(config.experiments ?? {}),
      asyncWebAssembly: true,
      topLevelAwait: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    // Only shim isomorphic-ws for the browser. Protocol packages are pinned
    // exactly in package.json and must resolve through npm normally; aliasing
    // their package directories bypasses their exports/dependency graph and
    // can create incompatible wasm/runtime instances.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "isomorphic-ws": path.resolve(__dirname, "src/lib/midnight/isomorphic-ws-shim.ts"),
    };

    return config;
  },
};

export default nextConfig;
