'use strict';

var _toConsumableArray2 = require('babel-runtime/helpers/toConsumableArray');

var _toConsumableArray3 = _interopRequireDefault(_toConsumableArray2);

var _slicedToArray2 = require('babel-runtime/helpers/slicedToArray');

var _slicedToArray3 = _interopRequireDefault(_slicedToArray2);

var _extends2 = require('babel-runtime/helpers/extends');

var _extends3 = _interopRequireDefault(_extends2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var jp = require('jsonpath');
var _ = require('lodash');

module.exports = {
    patches: patches,
    diff: diff,
    getUpdateExpression: getUpdateExpression,
    getVersionedUpdateExpression: getVersionedUpdateExpression,
    getVersionLockExpression: getVersionLockExpression
};

function getVersionLockExpression() {
    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
        original = _ref.original,
        _ref$versionPath = _ref.versionPath,
        versionPath = _ref$versionPath === undefined ? '$.version' : _ref$versionPath,
        _ref$newVersion = _ref.newVersion,
        newVersion = _ref$newVersion === undefined ? undefined : _ref$newVersion,
        _ref$condition = _ref.condition,
        condition = _ref$condition === undefined ? '=' : _ref$condition,
        _ref$orphans = _ref.orphans,
        orphans = _ref$orphans === undefined ? false : _ref$orphans;

    var currentVersion = original ? jp.value(original, versionPath) : null;
    var newAutoVersion = void 0;
    if (newVersion === undefined) {
        if (currentVersion === undefined || currentVersion === null) {
            newAutoVersion = 1;
            currentVersion = undefined; // auto versioning, trigger attribute_not_exists
        } else if (_.isNumber(currentVersion)) {
            newAutoVersion = currentVersion + 1;
        } else {
            throw new Error('Invalid arguments. Must specify [newVersion] for non-numeric currentVersion: [' + currentVersion + ']');
        }
    }
    var _original = {};
    jp.value(_original, versionPath, currentVersion);
    var modified = {};
    jp.value(modified, versionPath, newAutoVersion || newVersion);
    return getVersionedUpdateExpression({
        original: _original,
        modified: modified,
        versionPath: versionPath,
        useCurrent: newVersion === undefined,
        currentVersion: currentVersion,
        orphans: orphans,
        condition: condition
    });
}

function version(_ref2) {
    var currentVersion = _ref2.currentVersion,
        newVersion = _ref2.newVersion,
        _ref2$useCurrent = _ref2.useCurrent,
        useCurrent = _ref2$useCurrent === undefined ? true : _ref2$useCurrent,
        _ref2$versionPath = _ref2.versionPath,
        versionPath = _ref2$versionPath === undefined ? '$.version' : _ref2$versionPath,
        _ref2$condition = _ref2.condition,
        condition = _ref2$condition === undefined ? '=' : _ref2$condition,
        _ref2$aliasContext = _ref2.aliasContext,
        aliasContext = _ref2$aliasContext === undefined ? {} : _ref2$aliasContext;

    var conditionExpression = {
        ConditionExpression: '',
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: {}
    };

    var expectedVersion = useCurrent ? currentVersion : newVersion;
    var _aliasContext$prefix = aliasContext.prefix,
        prefix = _aliasContext$prefix === undefined ? 'expected' : _aliasContext$prefix,
        _aliasContext$truncat = aliasContext.truncatedAliasCounter,
        truncatedAliasCounter = _aliasContext$truncat === undefined ? 1 : _aliasContext$truncat;


    var expectedVersionNode = alias({ path: versionPath, value: expectedVersion }, conditionExpression.ExpressionAttributeNames, expectedVersion !== undefined ? conditionExpression.ExpressionAttributeValues : undefined, // else: no need for ExpressionAttributeValues
    {
        truncatedAliasCounter: truncatedAliasCounter,
        prefix: prefix
    });

    if (currentVersion !== undefined || currentVersion === null) {
        conditionExpression.ConditionExpression = expectedVersionNode.path + ' ' + condition + ' ' + expectedVersionNode.value;
    } else {
        conditionExpression.ConditionExpression = 'attribute_not_exists (' + expectedVersionNode.path + ')';
        //Avoid "ValidationException: Value provided in ExpressionAttributeValues unused in expressions: keys: ${expectedVersionNode.path}"
        delete conditionExpression.ExpressionAttributeValues[expectedVersionNode.value]; //value is aliasedValue
    }

    return conditionExpression;
}

function withCondition(updateExpression, conditionExpression) {
    return {
        UpdateExpression: updateExpression.UpdateExpression,
        ExpressionAttributeNames: (0, _extends3.default)({}, updateExpression.ExpressionAttributeNames, conditionExpression.ExpressionAttributeNames),
        ExpressionAttributeValues: (0, _extends3.default)({}, updateExpression.ExpressionAttributeValues, conditionExpression.ExpressionAttributeValues),
        ConditionExpression: conditionExpression.ConditionExpression
    };
}

function getVersionedUpdateExpression(_ref3) {
    var _ref3$original = _ref3.original,
        original = _ref3$original === undefined ? {} : _ref3$original,
        _ref3$modified = _ref3.modified,
        modified = _ref3$modified === undefined ? {} : _ref3$modified,
        _ref3$versionPath = _ref3.versionPath,
        versionPath = _ref3$versionPath === undefined ? '$.version' : _ref3$versionPath,
        _ref3$useCurrent = _ref3.useCurrent,
        useCurrent = _ref3$useCurrent === undefined ? true : _ref3$useCurrent,
        currentVersion = _ref3.currentVersion,
        _ref3$condition = _ref3.condition,
        condition = _ref3$condition === undefined ? '=' : _ref3$condition,
        _ref3$orphans = _ref3.orphans,
        orphans = _ref3$orphans === undefined ? false : _ref3$orphans,
        _ref3$aliasContext = _ref3.aliasContext,
        aliasContext = _ref3$aliasContext === undefined ? { truncatedAliasCounter: 1 } : _ref3$aliasContext;

    var updateExpression = getUpdateExpression({ original: original, modified: modified, orphans: orphans, aliasContext: (0, _extends3.default)({}, aliasContext, { prefix: '' }) });
    currentVersion = currentVersion || jp.value(original, versionPath);
    var newVersion = jp.value(modified, versionPath);
    updateExpression = withCondition(updateExpression, version({ currentVersion: currentVersion, newVersion: newVersion, useCurrent: useCurrent, versionPath: versionPath, condition: condition, aliasContext: aliasContext }));
    return updateExpression;
}

var regex = {
    numericSubscript$: /(.*)(\[[\d]+\])$/,
    isNumericSubscript$: /(.*)(\[[\d]+\])$/,
    invalidIdentifierName: /\["([\w\.\s-]+)"\]/g, // extract path parts that are surrounded by ["<invalid.name>"] by jsonpath.stringify
    isInvalidIdentifierName: /\["([\w\.\s-]+)"\]/,
    safeDot: /\.(?![\w]+")|\[\"([\w-]+)\"\]/ // will split a kebab case child $.x["prefix-suffix"]
    // but won't split an attribute name that includes a '.' within a path $.x["prefix.suffix"]
};

var maxAttrNameLen = 255;

function getUpdateExpression(_ref4) {
    var original = _ref4.original,
        modified = _ref4.modified,
        _ref4$orphans = _ref4.orphans,
        orphans = _ref4$orphans === undefined ? false : _ref4$orphans,
        _ref4$supportSets = _ref4.supportSets,
        supportSets = _ref4$supportSets === undefined ? false : _ref4$supportSets,
        _ref4$aliasContext = _ref4.aliasContext,
        aliasContext = _ref4$aliasContext === undefined ? { truncatedAliasCounter: 1 } : _ref4$aliasContext;

    var _partitionedDiff = partitionedDiff(original, modified, orphans, supportSets),
        SET = _partitionedDiff.SET,
        REMOVE = _partitionedDiff.REMOVE,
        DELETE = _partitionedDiff.DELETE;

    var updateExpression = {
        UpdateExpression: '',
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: {}
    };

    function removeExpression(removes) {
        var paths = removes.map(function (node) {
            return alias(node, updateExpression.ExpressionAttributeNames, undefined, aliasContext).path;
        });
        if (paths.length === 0) return;
        return 'REMOVE ' + paths.join(', ');
    }

    function setExpression(addOrUpdates) {
        var pairs = addOrUpdates.map(function (node) {
            return alias(node, updateExpression.ExpressionAttributeNames, updateExpression.ExpressionAttributeValues, aliasContext);
        }).map(function (node) {
            return node.path + ' = ' + node.value;
        });
        if (pairs.length === 0) return;
        return 'SET ' + pairs.join(', ');
    }

    function deleteExpression(setDeletes) {
        // @TODO: should group sibling set items into one subset for `DELETE #setNameAlias :setValueAlias, where :setValueAlias is e.g. {"SS": ['A', 'B']} or {"NS": [1, 2, 3, 4, 5]}
        var pairs = setDeletes.map(function (node) {
            return alias(node, updateExpression.ExpressionAttributeNames, updateExpression.ExpressionAttributeValues, aliasContext);
        }).map(function (node) {
            return node.path + ' ' + node.value;
        });
        if (pairs.length === 0) return;
        return 'DELETE ' + pairs.join(', ');
    }

    var setExp = setExpression(SET);
    var removeExp = removeExpression(REMOVE);
    var deleteExp = deleteExpression(DELETE);

    updateExpression.UpdateExpression = [setExp, removeExp, deleteExp].reduce(function (acc, value) {
        return value ? acc ? acc + ' ' + value : '' + value : acc;
    }, '');

    if (_.isEmpty(updateExpression.ExpressionAttributeValues)) delete updateExpression.ExpressionAttributeValues;
    if (_.isEmpty(updateExpression.ExpressionAttributeNames)) delete updateExpression.ExpressionAttributeNames;

    return updateExpression;
}

function checkLimit(name) {
    var maxLen = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : maxAttrNameLen;

    if (name.length > maxLen) throw new Error('Attribute name: [' + name + '] exceeds DynamoDB limit of [' + maxLen + '] ');
}

function truncate(name) {
    var maxLen = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : maxAttrNameLen - 1;
    var aliasContext = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : { truncatedAliasCounter: 1 };

    if (name.length <= maxLen) {
        return name;
    } else {
        var suffix = '' + aliasContext.truncatedAliasCounter++;
        return '' + name.slice(0, maxLen - suffix.length) + suffix;
    }
}

function alias(node, nameMap, valueMap) {
    var aliasContext = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
    var _aliasContext$prefix2 = aliasContext.prefix,
        prefix = _aliasContext$prefix2 === undefined ? '' : _aliasContext$prefix2;

    var parts = node.path.slice(1) // skip `$` part of the path
    .split(regex.safeDot) // first element is '', except for subscripted paths: $["prefix.suffix"] or $[0]
    .filter(function (part) {
        return part !== undefined;
    });

    var pathParts = parts.filter(function (part) {
        return part !== '';
    }).map(function (part) {
        var pathPart = void 0;
        var attrName = void 0;
        var attrNameAlias = void 0;

        if (regex.isInvalidIdentifierName.test(part)) {
            attrName = part.replace(regex.invalidIdentifierName, '$1'); // '["x.y"]' => 'x.y'
            checkLimit(attrName);
            attrNameAlias = '#' + truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext); // #xY
            pathPart = attrNameAlias; // #xY
        } else if (regex.isNumericSubscript$.test(part)) {
            var _regex$isNumericSubsc = regex.isNumericSubscript$.exec(part),
                _regex$isNumericSubsc2 = (0, _slicedToArray3.default)(_regex$isNumericSubsc, 3),
                whole = _regex$isNumericSubsc2[0],
                _attrName = _regex$isNumericSubsc2[1],
                subscript = _regex$isNumericSubsc2[2]; // relatedItems[1]


            attrName = _attrName; //relatedItems
            checkLimit(attrName);
            attrNameAlias = '#' + truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext);
            pathPart = '' + attrNameAlias + subscript; // #relatedItems[1]
        } else {
            attrName = part;
            checkLimit(attrName);
            attrNameAlias = '#' + truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext);
            pathPart = attrNameAlias;
        }

        nameMap[attrNameAlias] = attrName;
        return pathPart;
    });

    var value = node.value;

    if (valueMap) {
        var valueAlias = ':' + truncate(_.camelCase([prefix].concat((0, _toConsumableArray3.default)(parts))), maxAttrNameLen - 1, aliasContext);
        valueMap[valueAlias] = value;
        value = valueAlias;
    }
    return {
        path: pathParts.join('.'),
        value: value
    };
}

function patches(original, modified) {
    var orphans = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    var _diff = diff(original, modified, orphans),
        ADD = _diff.ADD,
        DELETE = _diff.DELETE,
        SET = _diff.SET;

    var addPatch = ADD.reduce(function (acc, field) {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    var updatePatch = SET.reduce(function (acc, field) {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    var removePatch = DELETE.reduce(function (acc, field) {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    return { ADD: addPatch, SET: updatePatch, DELETE: removePatch };
}

function partitionedDiff(original, modified) {
    var orphans = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
    var supportSets = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

    var _diff2 = diff(original, modified, orphans),
        ADD = _diff2.ADD,
        DELETE = _diff2.DELETE,
        SET = _diff2.SET;

    var _ref5 = supportSets ? _.partition(DELETE, function (node) {
        return regex.isNumericSubscript$.test(node.path) && (_.isNumber(node.value) || _.isString(node.value));
    } // @TODO: Support Node Buffer and/or ArrayBuffer sets?
    ) : [[], DELETE],
        _ref6 = (0, _slicedToArray3.default)(_ref5, 2),
        _DELETE = _ref6[0],
        _REMOVE = _ref6[1];

    /**
     * http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html#Expressions.UpdateExpressions.ADD
     * Note: In general, we recommend using SET rather than ADD.
     */

    return {
        SET: [].concat((0, _toConsumableArray3.default)(ADD), (0, _toConsumableArray3.default)(SET)),
        REMOVE: _REMOVE,
        DELETE: _DELETE
    };
}

function diff(original, modified) {
    var orphans = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    var originalNodes = allNodes(original);
    var modifiedNodes = allNodes(modified);

    var originalLeafNodes = leafNodes(originalNodes);
    var modifiedLeafNodes = leafNodes(modifiedNodes);

    var nullified = function nullified(a, b) {
        return !_.isNil(a.value) && _.isNil(b.value);
    };
    var emptied = function emptied(a, b) {
        return a.value !== '' && b.value === '';
    };

    var addedNodes = void 0;
    if (orphans) {
        addedNodes = _.differenceBy(modifiedLeafNodes, originalLeafNodes, 'path');
    } else {
        addedNodes = _.differenceBy(modifiedNodes, originalNodes, 'path');
        addedNodes = ancestorNodes(addedNodes, true);
    }

    var removedLeafNodes = _.differenceWith(originalLeafNodes, modifiedNodes, function (a, b) {
        return a.path === b.path && !nullified(a, b) && !emptied(a, b);
    });

    var updatedLeafNodes = _.intersectionWith(modifiedLeafNodes, originalLeafNodes, function (a, b) {
        return a.path === b.path && a.value !== b.value && !nullified(b, a) && !emptied(b, a);
    });

    // @TODO: REMOVE should be paritioned into REMOVE for map-attributes and DELETE for set-elements.
    // Sets (aws-sdk specific immutable class instance!) are created using docClient.createSet() from arrays with first item being number, string or base64 encoded binary.
    return {
        ADD: addedNodes,
        DELETE: removedLeafNodes,
        SET: updatedLeafNodes
    };
}

function sortBy(sortBy) {
    var mapping = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function (v) {
        return v;
    };

    return function (a, b) {
        return +(mapping(a[sortBy]) > mapping(b[sortBy])) || +(mapping(a[sortBy]) === mapping(b[sortBy])) - 1;
    };
}

function escape(str) {
    return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function isParentOf(parent, child) {
    var parentRegex = '^' + escape(parent) + '[.|[].*$';
    return new RegExp(parentRegex).test(child);
}

function allNodes(data) {
    return jp.nodes(data, '$..*').map(function (_ref7) {
        var path = _ref7.path,
            value = _ref7.value;
        return { path: jp.stringify(path), value: value };
    }).sort(sortBy('path'));
}

function leafNodes(nodes) {
    var sort = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    if (sort) nodes.sort(sortBy('path'));

    return nodes.reduce(function (acc, node, index, arr) {
        if (index < arr.length - 1 && isParentOf(node.path, arr[index + 1].path)) return acc; // skip parent node
        acc.push(node);
        return acc;
    }, []);
}

function ancestorNodes(nodes) {
    var sort = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    if (sort) nodes.sort(sortBy('path'));

    return nodes.reduce(function (acc, node, index) {
        if (index === 0) {
            acc.push(node);
            return acc;
        }

        var _acc$slice = acc.slice(-1),
            _acc$slice2 = (0, _slicedToArray3.default)(_acc$slice, 1),
            previous = _acc$slice2[0];

        if (!isParentOf(previous.path, node.path)) {
            acc.push(node);
        }
        return acc;
    }, []);
}