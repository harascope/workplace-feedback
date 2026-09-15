import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // projects を渡さないと、ワークスペースの外（ホーム配下）まで tsconfig.json を探しに行く
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] }), react()],
  resolve: {
    alias: {
      // "server-only" はクライアントから読むと throw する目印。テストでは空のモジュールに差し替える。
      // react-server 条件で解決すると react まで RSC 版になり useState が消えるので、条件は使わない。
      // exports が "server-only/empty.js" を公開していないため、実ファイルのパスを渡す
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/lib/**/*.test.ts", "src/app/**/*.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts", "./vitest.setup.components.ts"],
        },
      },
    ],
  },
});
