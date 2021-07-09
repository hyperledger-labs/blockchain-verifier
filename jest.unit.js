// jest.config.js
// Sync object
/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
    transform: {
        "^.+\\.tsx?$": "ts-jest"
    },
    testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    moduleFileExtensions: [
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "node"
    ],
    globals: {
        "ts-jest": {
            tsconfig: "tsconfig.test.json"
        }
    },
    modulePathIgnorePatterns: [
        "<rootDir>/integration/"
    ]
};
  
module.exports = config;