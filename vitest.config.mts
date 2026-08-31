import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "lib/ai/**",
        "app/api/ai/**",
        "lib/task/**",
        "app/api/tasks/**",
        "lib/services/**",
        "app/api/register/**",
        "app/api/change-password/**",
        "app/api/delete-account/**",
        "app/api/forgot-password/**",
        "app/api/reset-password/**",
        "app/api/verify-email/**",
        "app/api/resend-verification/**",
        "app/api/profile/**",
      ],
    },
  },
});
