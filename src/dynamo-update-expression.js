const jp = require('jsonpath');
const _ = require('lodash');

module.exports = {
    patches,
    diff,
    getUpdateExpression,
    getVersionedUpdateExpression,
    getVersionLockExpression
};


function getVersionLockExpression({original, versionPath = '$.version', newVersion = undefined, condition = '=', orphans = false} = {}) {
    let currentVersion = original ? jp.value(original, versionPath) : null;
    let newAutoVersion;
    if (newVersion === undefined) {
        if (currentVersion === undefined || currentVersion === null) {
            newAutoVersion = 1;
            currentVersion = undefined; // auto versioning, trigger attribute_not_exists
        } else if (_.isNumber(currentVersion)) {
            newAutoVersion = currentVersion + 1;
        } else {
            throw new Error(`Invalid arguments. Must specify [newVersion] for non-numeric currentVersion: [${currentVersion}]`);
        }
    }
    const _original = {};
    jp.value(_original, versionPath, currentVersion);
    const modified = {};
    jp.value(modified, versionPath, newAutoVersion || newVersion);
    return getVersionedUpdateExpression({
        original: _original,
        modified,
        versionPath,
        useCurrent: (newVersion === undefined),
        currentVersion,
        orphans,
        condition
    });
}


function version({currentVersion, newVersion, useCurrent = true, versionPath = '$.version', condition = '=', aliasContext = {}}) {
    const conditionExpression = {
        ConditionExpression: '',
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: {}
    };

    const expectedVersion = useCurrent ? currentVersion : newVersion;
    const {prefix = 'expected', truncatedAliasCounter = 1} = aliasContext;

    const expectedVersionNode = alias(
        {path: versionPath, value: expectedVersion},
        conditionExpression.ExpressionAttributeNames,
        (expectedVersion !== undefined) ? conditionExpression.ExpressionAttributeValues : undefined, // else: no need for ExpressionAttributeValues
        {
            truncatedAliasCounter,
            prefix
        }
    );

    if (currentVersion !== undefined || currentVersion === null) {
        conditionExpression.ConditionExpression = `${expectedVersionNode.path} ${condition} ${expectedVersionNode.value}`;
    } else {
        conditionExpression.ConditionExpression = `attribute_not_exists (${expectedVersionNode.path})`;
        //Avoid "ValidationException: Value provided in ExpressionAttributeValues unused in expressions: keys: ${expectedVersionNode.path}"
        delete conditionExpression.ExpressionAttributeValues[expectedVersionNode.value]; //value is aliasedValue
    }

    return conditionExpression;
}


function withCondition(updateExpression, conditionExpression) {
    return {
        UpdateExpression: updateExpression.UpdateExpression,
        ExpressionAttributeNames: {
            ...updateExpression.ExpressionAttributeNames,
            ...conditionExpression.ExpressionAttributeNames
        },
        ExpressionAttributeValues: {
            ...updateExpression.ExpressionAttributeValues,
            ...conditionExpression.ExpressionAttributeValues
        },
        ConditionExpression: conditionExpression.ConditionExpression
    };
}


function getVersionedUpdateExpression({original = {}, modified = {}, versionPath = '$.version', useCurrent = true, currentVersion, condition = '=', orphans = false, aliasContext = {truncatedAliasCounter: 1}}) {
    let updateExpression = getUpdateExpression({original, modified, orphans, aliasContext: {...aliasContext, prefix: ''}});
    currentVersion = currentVersion || jp.value(original, versionPath);
    const newVersion = jp.value(modified, versionPath);
    updateExpression = withCondition(updateExpression, version({currentVersion, newVersion, useCurrent, versionPath, condition, aliasContext}));
    return updateExpression;
}


const regex = {
    numericSubscript$: /(.*)(\[[\d]+\])$/,
    isNumericSubscript$: /(.*)(\[[\d]+\])$/,
    invalidIdentifierName: /\["([\w\.\s-]+)"\]/g, // extract path parts that are surrounded by ["<invalid.name>"] by jsonpath.stringify
    isInvalidIdentifierName: /\["([\w\.\s-]+)"\]/,
    safeDot: /\.(?![\w]+")|\[\"([\w-]+)\"\]/ // will split a kebab case child $.x["prefix-suffix"]
    // but won't split an attribute name that includes a '.' within a path $.x["prefix.suffix"]
};

const maxAttrNameLen = 255;


function getUpdateExpression({original, modified, orphans = false, supportSets = false, aliasContext = {truncatedAliasCounter: 1}}) {
    const {SET, REMOVE, DELETE} = partitionedDiff(original, modified, orphans, supportSets);

    const updateExpression = {
        UpdateExpression: '',
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: {}
    };

    function removeExpression(removes) {
        const paths = removes
            .map(node => alias(node, updateExpression.ExpressionAttributeNames, undefined, aliasContext).path);
        if (paths.length === 0) return;
        return `REMOVE ${paths.join(', ')}`;
    }

    function setExpression(addOrUpdates) {
        const pairs = addOrUpdates
            .map(node => alias(node, updateExpression.ExpressionAttributeNames, updateExpression.ExpressionAttributeValues, aliasContext))
            .map(node => `${node.path} = ${node.value}`);
        if (pairs.length === 0) return;
        return `SET ${pairs.join(', ')}`;
    }

    function deleteExpression(setDeletes) {
        // @TODO: should group sibling set items into one subset for `DELETE #setNameAlias :setValueAlias, where :setValueAlias is e.g. {"SS": ['A', 'B']} or {"NS": [1, 2, 3, 4, 5]}
        const pairs = setDeletes
            .map(node => alias(node, updateExpression.ExpressionAttributeNames, updateExpression.ExpressionAttributeValues, aliasContext))
            .map(node => `${node.path} ${node.value}`);
        if (pairs.length === 0) return;
        return `DELETE ${pairs.join(', ')}`;
    }

    const setExp = setExpression(SET);
    const removeExp = removeExpression(REMOVE);
    const deleteExp = deleteExpression(DELETE);

    updateExpression.UpdateExpression = [
        setExp,
        removeExp,
        deleteExp
    ].reduce((acc, value) => {
        return value ? acc ? `${acc} ${value}` : `${value}` : acc;
    }, '');

    if (_.isEmpty(updateExpression.ExpressionAttributeValues)) delete updateExpression.ExpressionAttributeValues;
    if (_.isEmpty(updateExpression.ExpressionAttributeNames)) delete updateExpression.ExpressionAttributeNames;

    return updateExpression;
}

function checkLimit(name, maxLen = maxAttrNameLen) {
    if (name.length > maxLen) throw new Error(`Attribute name: [${name}] exceeds DynamoDB limit of [${maxLen}] `);
}

function truncate(name, maxLen = maxAttrNameLen - 1, aliasContext = {truncatedAliasCounter: 1}) {
    if (name.length <= maxLen) {
        return name;
    } else {
        const suffix = `${aliasContext.truncatedAliasCounter++}`;
        return `${name.slice(0, maxLen - suffix.length)}${suffix}`;
    }
}

function alias(node, nameMap, valueMap, aliasContext = {}) {
    const {prefix = ''} = aliasContext;
    const parts = node.path
        .slice(1) // skip `$` part of the path
        .split(regex.safeDot) // first element is '', except for subscripted paths: $["prefix.suffix"] or $[0]
        .filter(part => part !== undefined);

    const pathParts = parts
        .filter(part => part !== '')
        .map(part => {
            let pathPart;
            let attrName;
            let attrNameAlias;

            if (regex.isInvalidIdentifierName.test(part)) {
                attrName = part.replace(regex.invalidIdentifierName, '$1'); // '["x.y"]' => 'x.y'
                checkLimit(attrName);
                attrNameAlias = `#${truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext)}`; // #xY
                pathPart = attrNameAlias; // #xY
            } else if (regex.isNumericSubscript$.test(part)) {
                const [whole, _attrName, subscript] = regex.isNumericSubscript$.exec(part); // relatedItems[1]
                attrName = _attrName; //relatedItems
                checkLimit(attrName);
                attrNameAlias = `#${truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext)}`;
                pathPart = `${attrNameAlias}${subscript}`; // #relatedItems[1]
            } else {
                attrName = part;
                checkLimit(attrName);
                attrNameAlias = `#${truncate(_.camelCase([prefix, attrName]), maxAttrNameLen - 1, aliasContext)}`;
                pathPart = attrNameAlias;
            }

            nameMap[attrNameAlias] = attrName;
            return pathPart;
        });

    let {value} = node;
    if (valueMap) {
        const valueAlias = `:${truncate(_.camelCase([prefix, ...parts]), maxAttrNameLen - 1, aliasContext)}`;
        valueMap[valueAlias] = value;
        value = valueAlias;
    }
    return {
        path: pathParts.join('.'),
        value
    };
}


function patches(original, modified, orphans = false) {
    const {ADD, DELETE, SET} = diff(original, modified, orphans);
    const addPatch = ADD.reduce((acc, field) => {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    const updatePatch = SET.reduce((acc, field) => {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    const removePatch = DELETE.reduce((acc, field) => {
        jp.value(acc, field.path, field.value);
        return acc;
    }, {});

    return {ADD: addPatch, SET: updatePatch, DELETE: removePatch};
}


function partitionedDiff(original, modified, orphans = false, supportSets = false) {
    const {ADD, DELETE, SET} = diff(original, modified, orphans);
    const [_DELETE, _REMOVE] = supportSets ? _.partition(
        DELETE,
        node => regex.isNumericSubscript$.test(node.path) &&
        (_.isNumber(node.value) ||
        _.isString(node.value)) // @TODO: Support Node Buffer and/or ArrayBuffer sets?
    ) : [[], DELETE];

    /**
     * http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html#Expressions.UpdateExpressions.ADD
     * Note: In general, we recommend using SET rather than ADD.
     */

    return {
        SET: [...ADD, ...SET],
        REMOVE: _REMOVE,
        DELETE: _DELETE
    };
}


function diff(original, modified, orphans = false) {
    const originalNodes = allNodes(original);
    const modifiedNodes = allNodes(modified);

    const originalLeafNodes = leafNodes(originalNodes);
    const modifiedLeafNodes = leafNodes(modifiedNodes);

    const nullified = (a, b) => !_.isNil(a.value) && _.isNil(b.value);
    const emptied = (a, b) => a.value !== '' && b.value === '';

    let addedNodes;
    if (orphans) {
        addedNodes = _.differenceBy(modifiedLeafNodes, originalLeafNodes, 'path');
    } else {
        addedNodes = _.differenceBy(modifiedNodes, originalNodes, 'path');
        addedNodes = ancestorNodes(addedNodes, true);
    }

    const removedLeafNodes = _.differenceWith(
        originalLeafNodes,
        modifiedNodes,
        (a, b) => a.path === b.path && !nullified(a, b) && !emptied(a, b)
    );

    const updatedLeafNodes = _.intersectionWith(
        modifiedLeafNodes,
        originalLeafNodes,
        (a, b) => a.path === b.path && a.value !== b.value && !nullified(b, a) && !emptied(b, a)
    );


    // @TODO: REMOVE should be paritioned into REMOVE for map-attributes and DELETE for set-elements.
    // Sets (aws-sdk specific immutable class instance!) are created using docClient.createSet() from arrays with first item being number, string or base64 encoded binary.
    return {
        ADD: addedNodes,
        DELETE: removedLeafNodes,
        SET: updatedLeafNodes
    };
}

function sortBy(sortBy, mapping = v => v) {
    return (a, b) => +(mapping(a[sortBy]) > mapping(b[sortBy])) || +(mapping(a[sortBy]) === mapping(b[sortBy])) - 1;
}

function escape(str) {
    return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function isParentOf(parent, child) {
    const parentRegex = `\^${escape(parent)}[\.|\[].*$`;
    return new RegExp(parentRegex).test(child);
}

function allNodes(data) {
    return jp
        .nodes(data, '$..*')
        .map(({path, value}) => ({path: jp.stringify(path), value}))
        .sort(sortBy('path'));
}

function leafNodes(nodes, sort = false) {
    if (sort) nodes.sort(sortBy('path'));

    return nodes
        .reduce((acc, node, index, arr) => {
            if (index < arr.length - 1 && isParentOf(node.path, arr[index + 1].path)) return acc; // skip parent node
            acc.push(node);
            return acc;
        }, []);
}


function ancestorNodes(nodes, sort = false) {
    if (sort) nodes.sort(sortBy('path'));

    return nodes.reduce((acc, node, index) => {
        if (index === 0) {
            acc.push(node);
            return acc;
        }
        const [previous] = acc.slice(-1);
        if (!isParentOf(previous.path, node.path)) {
            acc.push(node);
        }
        return acc;
    }, []);
}
