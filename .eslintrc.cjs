/* eslint-env node */
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
  rules: {
    "indent": [
      "error",
      2,
    ],
    "linebreak-style": [
      "error",
      "unix",
    ],
    "quotes": [
      "error",
      "double",
    ],
    "semi": [
      "error",
      "always",
    ],
    "comma-dangle": ["error", "always-multiline"],
    "max-len": ["error", {
      "code": 100,
      "ignoreUrls": true,
      "ignoreStrings": true,
    }],
    "eol-last": ["error", "always"],
    "@typescript-eslint/ban-types": [
      "error",
      {
        "types": {
          "BigInt": false,
        },
        "extendDefaults": true
      }
    ],
  },
};