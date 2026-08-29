import next from "eslint-config-next";

// eslint-config-next 16 отдаёт готовый массив конфигов, а не фабрику.
const config = [
  {
    ignores: [".next/**", "node_modules/**", "public/**", "data/**", "release/**", "payload-types.ts", "app/(payload)/admin/importMap.js", "migrations/**"],
  },
  ...next,
];

export default config;
