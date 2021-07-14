// jest.config.js
// Sync object
/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
    transform: {
        "^.+\\.tsx?$": "ts-jest"
    },
    testRegex: "integration/.*\.test\.ts$",
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
        "<rootDir>/integration/fabric-samples"
    ]
};
  
module.exports = config;