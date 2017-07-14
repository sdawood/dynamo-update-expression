const jp = require('jsonpath');
const _ = require('lodash');

// http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.Attributes.html
/*
 * You can use any attribute name in a document path, provided that the first character is a-z or A-Z and the second character (if present) is a-z, A-Z, or 0-9.
 * If an attribute name does not meet this requirement, you will need to define an expression attribute name as a placeholder.
 * For more information, see http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ExpressionAttributeNames.html
 */

module.exports = {
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
    jp.value(_original, versionPath, currentVersion); // 2nd run start = 1000, pass null as currentVersion
    const modified = {};
    jp.value(modified, versionPath, newAutoVersion || newVersion); // start = 1000, wont work
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

/**
 * currentVersion is read from original document.
 * Allows for a one-way-trip conditional-update check.
 * This is useful for use cases where you read the version value from a payload received by your lambda/worker, and you need
 * to make sure that you `lock` or reserve that `range-marker` or `version` number without doing a read first.
 * Example:
 * Normal use case:
 * original = {version: 1}, modified = {version: 2}
 * getVersionedUpdateExpression({original, modified, useCurrent: true, versionPath: '$.version', condition: '='})
 * Special use case:
 * payload = {..., start: 1000}, value in Dynamo is previous start === 1
 * To lock that range start, call update with the UpdateExpression from this call:
 * getVersionedUpdateExpression({original: {}, modified: {start: 1000}, useCurrent: false, versionPath: '$.start', condition: '<'})
 * If this range was not yet started by other workers, you would successfully update start to 1000
 * Any subsequent calls from duplicate or falling-behind workers (receiving the same payload with start = 1000) would fail to update start to any value not grater than 1000
 * hence erroring out, indicating a duplicate-processing for the same range.
 * @param original
 * @param modified
 * @param currentVersion
 * @param versionPath
 * @param condition
 * @param orphans
 * @param aliasContext
 * @returns {{UpdateExpression: string, ExpressionAttributeNames: {}, ExpressionAttributeValues: {}}}
 */
function getVersionedUpdateExpression({original = {}, modified = {}, versionPath = '$.version', useCurrent = true, currentVersion, condition = '=', orphans = false, aliasContext = {truncatedAliasCounter: 1}}) {
    let updateExpression = getUpdateExpression({original, modified, orphans, aliasContext: {...aliasContext, prefix: ''}});
    currentVersion = currentVersion || jp.value(original, versionPath);
    const newVersion = jp.value(modified, versionPath);
    updateExpression = withCondition(updateExpression, version({currentVersion, newVersion, useCurrent, versionPath, condition, aliasContext}));
    return updateExpression;
}

// Never use a regex with /g for test, it returns alternating values since it keeps state between calls: https://stackoverflow.com/questions/2630418/javascript-regex-returning-true-then-false-then-true-etc

const regex = {
    numericSubscript$: /(.*)(\[[\d]+\])$/,
    isNumericSubscript$: /(.*)(\[[\d]+\])$/,
    invalidIdentifierName: /\["([\w\.\s-]+)"\]/g, // extract path parts that are surrounded by ["<invalid.name>"] by jsonpath.stringify
    isInvalidIdentifierName: /\["([\w\.\s-]+)"\]/,
    safeDot: /\.(?![\w]+")/ // won't split an attribute name that includes a '.' within a path $.x["prefix.suffix"]
};

const maxAttrNameLen = 255;

/**
 * Note: all path parts are aliased, avoiding cases with key names containing '.',
 * also the huge list of Dynamo reserved (very common) words http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html
 * @param original
 * @param modified
 * @param orphans
 * @param supportSets
 * @returns {{UpdateExpression: string, ExpressionAttributeNames: {}, ExpressionAttributeValues: {}}}
 */
function getUpdateExpression({original, modified, orphans = false, supportSets = false, aliasContext = {truncatedAliasCounter: 1}}) {
    const {SET, REMOVE, DELETE} = partitionedDiff(original, modified, orphans, supportSets);

    const updateExpression = {
        UpdateExpression: '',
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: {}
    };

    /**
     * Note that the remove expression is consisting of all-leaves. What might appear inefficient at first glance, is quiet useful
     * when you think about it in the context of a a scenario, it is best to delete the leaves and leave the parent collections in there, empty as {} or []
     * which makes it easier to iterate over in code later instead of doing null checks.
     * The other solid benefit, is that if you want to re-add a leaf later or introduce a new leaf, the parent collection has to exist
     * or else the update expression doesn't pass validation, you would be thankful then that the previous remove expression did not clean up
     * parent nodes
     *
     * See https://forums.aws.amazon.com/thread.jspa?threadID=162907
     * @param removes
     * @returns {string}
     */
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
        .split(regex.safeDot); // first element is '', except for subscripted paths: $["prefix.suffix"] or $[0]

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

/**
 * Materialize diff document for every CRUD action, useful for logging and testing
 * @param original
 * @param modified
 * @returns {{ADD, SET, DELETE}}
 */
function calcPatches(original, modified) {
    const {ADD, DELETE, SET} = diff(original, modified);
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

/**
 * Calculate canonical diff ADD/SET/DELETE then partition into Dynamo update groups where:
 *
 * SET — Modifying or Adding Item Attributes
 * REMOVE — Deleting Attributes From An Item
 * ADD — Updating Numbers and Sets, not recommended, using SET instead
 * DELETE — Removing Elements From A Set (Numeric, String, Binary)
 * For more info, see: http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html
 * @param original
 * @param modified
 */
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

// NOTE: elements of a List should be removed by nullifying the value, not popping the element. If the element would be popped, the List would collapse, effectively altering the meaning of the positions.
// Nullifying the items allows for creation of a REMOVE expressions that removes the correct elements every time, it also allows to mix SET & REMOVE of list elements
// within the same update expression without running into `Overlapping path` errors or risking corrupting the list data.
// as mention above, even if you want to delete all the items in the list in this update, nullify all the items and don't delete the list, Dynamo would collapse the remote list as needed
// with each removal up to the point where you have an empty list. Later your code will safely enumerate an empty list instead of doing null checks and recreating the list.

function diff(original, modified, orphans = false) {
    const originalNodes = allNodes(original);
    const modifiedNodes = allNodes(modified);

    const originalLeafNodes = leafNodes(originalNodes);
    const modifiedLeafNodes = leafNodes(modifiedNodes);

    const nullified = (a, b) => !_.isNil(a.value) && _.isNil(b.value);
    const emptied = (a, b) => a.value !== '' && b.value === '';

    let addedNodes;
    if (orphans) {
        // new deep descendant paths are returned, even if the ancestor node is new.
        // Plays well when you use json path to set deep values but causes TypeError: Cannot set property 'z' of undefined with js syntax setting x.y.z = value if y and z are new
        addedNodes = _.differenceBy(modifiedLeafNodes, originalLeafNodes, 'path');
    } else {
        addedNodes = _.differenceBy(modifiedNodes, originalNodes, 'path');
        // for new parents, pop new children sub-trees from the list
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
    // NOTE: jp.stringify preserves attribute names that might contain a '.' in the form '$.x["prefix.suffix"]'
    // Using parts.join('.') would confuse the attribute name with real path e.g. $.x.prefix.suffix
    // Paths of numeric subscripts would become formatted as $.x[0] instead of $.x.0
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

/**
 * Returns minimal set of common ancestor nodes
 *
 * ancestor nodes !== non-leaf nodes
 * Example:
 * ['$.a', '$.a.b', '$.a.b[0]', '$a.c', '$.a.c.d', '$.x.y', '$x.y.z', '$x.y.z.w']
 * Non-leaf nodes:
 * ['$.a', '$.a.b', '$a.c', '$.x.y', '$x.y.z']
 * Ancestor nodes:
 * ['$.a', '$.x.y']
 * Which is useful in finding the common ancestor for newly created sub-trees to make sure the
 * Dynamo UpdateExpression doesn't include any broken paths with orphan leaves.
 * For such use case the function if applied on a list of all new paths it reduces the list into minmal common ancestors
 *
 * Note: The list of nodes has to be sorted by path, in ascending order.  Otherwise sort = true flag must be use to sort inside the function
 * @param nodes
 * @param sort
 */
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

/**
 * Can traverse be used in place of jsonpath?
 * Pros:
 * Smaller dependency and probably more efficient traversing sparing jsonpath parsing overheads.
 *
 * Yes Cases:
 * - traverse.reduce(fn) can do the equivalent of jp.nodes()
 * - leaves can be filtered in/out while reducing using this.isLeaf on the node. Note that call backs are bound, hence can't use arrow functions.
 *
 * No Cases:
 * - traverse.nodes() returns values only while jp.nodes() returns {path, node}. Solved!
 * - paths for numeric array items are returned as ['a', 'b', '0'] instead of ['a', 'b', 0] with jsonpath. Solvable.
 * - traverse.set(path, value) blindly sets new nodes as map members, even if there is a numeric index. jsonpath detects numeric indexes and creates new arrays. `if (!hasOwnProperty.call(node, key)) node[key] = {};` is buried deep in traverse code.
 * - traverse lacks .stringify(path), but it can easily be done by reducing the path array into required format.
 */


