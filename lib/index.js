'use strict';

var _require = require('./dynamo-update-expression'),
    patches = _require.patches,
    diff = _require.diff,
    getUpdateExpression = _require.getUpdateExpression,
    getVersionedUpdateExpression = _require.getVersionedUpdateExpression,
    getVersionLockExpression = _require.getVersionLockExpression;

module.exports = {
    patches: patches,
    diff: diff,
    getUpdateExpression: getUpdateExpression,
    getVersionedUpdateExpression: getVersionedUpdateExpression,
    getVersionLockExpression: getVersionLockExpression
};