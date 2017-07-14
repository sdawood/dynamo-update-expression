// Available settings at http://eslint.org/docs/user-guide/configuring
module.exports = {
    "ecmaVersion": "6",
    "parser": "babel-eslint",
    "ecmaFeatures": {
        "impliedStrict": true
    },
    "env": {
        "es6": true,
        "node": true,
        "jest": true
    },
    "extends": [
        "eslint:all"
    ],
    "rules": {
        // Rules definitions at http://eslint.org/docs/rules/
        // Overrides for "all" profile
        "arrow-body-style": "warn",
        "arrow-parens": ["off", "as-needed", { "requireForBlockBody": true }],
        "complexity": ["warn", 5], // Valid use cases exist
        "consistent-return" : "off",
        "curly": "warn",
        "dot-location": ["error", "property"],
        "dot-notation" : "off",
        "func-names" : "off",
        "func-style" : "off",
        "global-require": "warn",
        "generator-star-spacing": ["error", "both"],
        "guard-for-in": "warn",
        "id-length" : "off",
        "init-declarations" : "off",
        "line-comment-position" : "off",
        "max-len" : ["warn", {"code": 160, "ignoreComments": true}],
        "max-lines" : "warn",
        "max-params" : ["warn", 5],
        "max-statements" : "warn",
        "multiline-ternary" : "off",
        "newline-after-var" : "off",
        "newline-before-return" : "off",
        "newline-per-chained-call" : ["error", { ignoreChainWithDepth: 3 }],
        "no-console": "warn",
        "no-else-return" : "off",
        "no-extra-parens": ["error", "functions"],
        "no-inline-comments" : "warn", // Valid use cases exist, e.g. <-- this
        "no-magic-numbers": "warn",
        "no-process-env" : "off",
        "no-prototype-builtins" : "off",
        "no-return-assign": "warn",
        "no-shadow": "warn",
        "no-sync": "warn",
        "no-ternary" : "off",
        "no-trailing-spaces": ["error", { "skipBlankLines": true }],
        "no-undefined": "warn", // Keep? undefined triggers default function arguments, null doesn't
        "no-unused-vars": "warn",
        "no-use-before-define" : "off",
        "no-warning-comments": "warn",
        "object-curly-newline" : ["off", { "multiline": true, "minProperties": 2 }],
        "object-curly-spacing" : "off",
        "object-property-newline" : "off",
        "object-shorthand": "warn",
        "one-var" : ["error", "never"],
        "operator-linebreak" : ["error", "after"],
        "prefer-promise-reject-errors": "warn",
        "quote-props" : ["warn", "as-needed"],
        "quotes" : ["warn", "single"],
        "padded-blocks" : "off",
        "require-await": "off", // Async function is a contract for returning a promise, and a clean way to create one.
        "require-jsdoc" : "off",
        "sort-keys" : "off", // No value
        "space-before-function-paren" : "off",
        "strict" : "off",
        /* Quiet down rules temporarily */
        "no-underscore-dangle": "warn", // Builtin streams use that
        "valid-jsdoc": "warn", // Not currently used in Siren
        "no-empty-function": "warn", // Valid use cases exist
        "no-invalid-this": "warn", // Under evaluation
        "capitalized-comments": "off",
        "comma-dangle": "warn", // Was recently supported in arrays and object literals to minimize merge-lines
        "prefer-destructuring": "warn",
        "no-plusplus": "off",
        "callback-return": "warn",
        "spaced-comment": "warn",
        "no-await-in-loop": "warn",
        "no-param-reassign": "warn",
        "no-negated-condition": "off",
        "no-nested-ternary": "warn",
        "no-confusing-arrow": ["warn", {"allowParens": true}],
        "no-continue": "off",
        "no-return-await": "off",
        "no-extend-native": "warn",
        "no-constant-condition": "warn",
        "no-useless-escape": "warn", //complains about escape inside regex
        "no-implicit-coercion": "warn",
        "wrap-regex" : "warn"
    },
}
