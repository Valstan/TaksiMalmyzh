import next from "eslint-config-next";

// eslint-config-next 16 отдаёт готовый массив конфигов, а не фабрику.
const config = [
  {
    ignores: [".next/**", "node_modules/**", "public/**", "data/**", "release/**"],
  },
  ...next,
];

export default config;
