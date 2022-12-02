// jest.config.js
// Sync object
/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                tsconfig: "tsconfig.test.json"
            }
        ]
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
    modulePathIgnorePatterns: [
        "<rootDir>/integration/fabric-samples"
    ]
};
  
module.exports = config;