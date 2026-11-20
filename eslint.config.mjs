import next from "eslint-config-next";
export default [
  ...next,
  { ignores: [".next/**", ".open-next/**", "worker/**", "next-env.d.ts"] },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off", "react-hooks/purity": "off",
      // Hard navigations are intentional after sign-in/sign-out so server layouts re-evaluate the session.
      "@next/next/no-location-assign-relative-destination": "off", "@next/next/no-html-link-for-pages": "off",
      "import/no-anonymous-default-export": "off", "react/no-unescaped-entities": "off",
      // false positives for react-hook-form handlers / location redirects
      "react-hooks/refs": "off", "react-hooks/immutability": "off",
    },
  },
];
