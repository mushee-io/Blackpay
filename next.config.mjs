import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.experiments = {
      ...(config.experiments ?? {}),
      asyncWebAssembly: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "isomorphic-ws": path.resolve(__dirname, "src/lib/midnight/isomorphic-ws-shim.ts"),
    };

    return config;
  },
};

export default nextConfig;
