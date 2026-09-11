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

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "isomorphic-ws": path.resolve(__dirname, "src/lib/midnight/isomorphic-ws-shim.ts"),
      "@midnight-ntwrk/compact-runtime$": path.resolve(
        __dirname,
        "node_modules/@midnight-ntwrk/compact-runtime",
      ),
      "@midnight-ntwrk/onchain-runtime-v3$": path.resolve(
        __dirname,
        "node_modules/@midnight-ntwrk/onchain-runtime-v3",
      ),
    };

    return config;
  },
};

export default nextConfig;
