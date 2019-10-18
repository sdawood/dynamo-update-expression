const jp = require('jsonpath');
const _ = require('lodash');

const due = require('./dynamo-update-expression');

const original = Object.freeze({
    id: 123,
    title: 'Bicycle 123',
    description: '123 description',
    bicycleType: 'Hybrid',
    brand: 'Brand-Company C',
    price: 500,
    color: ['Red', 'Black'], // String Set if you use docClient.createSet() before put/update
    productCategory: 'Bicycle',
    inStok: true,
    quantityOnHand: null,
    relatedItems: [341, 472, 649], // Numeric Set if you use docClient.createSet() before put/update
    pictures: {
        frontView: 'http://example.com/products/123_front.jpg',
        rearView: 'http://example.com/products/123_rear.jpg',
        sideView: 'http://example.com/products/123_left_side.jpg'
    },
    productReview: {
        fiveStar: [
            "Excellent! Can't recommend it highly enough! Buy it!",
            'Do yourself a favor and buy this.'
        ],
        oneStar: [
            'Terrible product! Do no buy this.'
        ]
    },
    comment: 'This product sells out quickly during the summer',
    'Safety.Warning': 'Always wear a helmet' // attribute name with `.`
});

describe('dynamodb-update-expression', () => {
    const ADDITIONS = {
        '$.root0': 'root0',
        '$.newParent.newChild1.newGrandChild1': 'c1gc1',
        '$.newParent.newChild1.newGrandChild2': 'c1gc',
        '$.newParent.newChild2.newGrandChild1': 'c2gc1',
        '$.newParent.newChild2.newGrandChild2': 'c2gc2',
        '$.newParent.newChild3': {},
        '$.pictures.otherSideView': 'pictures.otherSideView',
        '$.color[2]': 'Blue',
        '$.relatedItems[3]': 1000,
        '$.productReview.oneStar[1]': 'Never again!',
        '$["prefix-suffix"]': 'Value for attribute name with -',
        '$["name with space"]': 'name with spaces is also okay',
        '$["1atBeginning"]': 'name starting with number is also okay',
        '$.productReview.thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen': 'Value for attribute name with 255 characters excluding the parent path',
        '$.thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen[0]': 'Value for attribute name with 255 characters with subscript excluding the parent path'
    };

    const ADDITIONS_NO_ORPHANS = {
        '$.color[2]': 'Blue',
        '$.newParent': {
            'newChild1': {'newGrandChild1': 'c1gc1', 'newGrandChild2': 'c1gc'},
            'newChild2': {'newGrandChild1': 'c2gc1', 'newGrandChild2': 'c2gc2'},
            'newChild3': {}
        },
        '$.pictures.otherSideView': 'pictures.otherSideView',
        '$.productReview.oneStar[1]': 'Never again!',
        '$.relatedItems[3]': 1000,
        '$.root0': 'root0',
        '$["prefix-suffix"]': 'Value for attribute name with -',
        '$["name with space"]': 'name with spaces is also okay',
        '$["1atBeginning"]': 'name starting with number is also okay',
        '$.productReview.thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen': 'Value for attribute name with 255 characters excluding the parent path',
        '$.thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen': [
            'Value for attribute name with 255 characters with subscript excluding the parent path'
        ]
    };

    const UPDATES = {
        '$.title': 'root0',
        '$.pictures.rearView': 'root1.level1',
        '$.color[0]': 'Blue',
        '$.relatedItems[1]': 1000,
        '$.productReview.oneStar[0]': 'Never again!',
        '$["Safety.Warning"]': 'Value for attribute with DOT'
    };

    const DELETES = [
        '$.title',
        '$.pictures.rearView',
        '$.color[0]',
        '$.relatedItems[1]',
        // '$.productReview' // our delete diff paths enumerate leaves to preserve document structure allowing for subsequent queries with no null check on collections, and subsequent SET expressions without missing levels in the document
        '$.productReview.fiveStar[0]',
        '$.productReview.fiveStar[1]',
        '$.productReview.oneStar[0]'
    ];


    const applyUpdates = (document, updates) => {
        const modified = _.cloneDeep(document);
        // const modified = JSON.parse(JSON.stringify(document));
        for (const path in updates) {
            jp.value(modified, path, updates[path]);
        }
        return modified;
    };

    const applyDeletes = (document, deletes, nullify = true) => {
        const modified = _.cloneDeep(document);
        // const modified = JSON.parse(JSON.stringify(document));
        for (const path of deletes) {
            const parent = jp.parent(modified, path);
            if (_.isArray(parent)) {
                const _subscript = /\[([\d]+)\]$/;
                const subscript = _subscript.exec(path)[1];
                if (nullify) {
                    parent[subscript] = null; // delete array['0'] doesn't work with jsonpath! list items should be deleted by setting to null or undefined,
                } else {
                    parent.splice(subscript, 1);
                }
            } else {
                delete parent[path.split('.').pop()];
            }
        }
        return modified;
    };


    describe('diff', () => {
        it('returns the diff objects with the ADD fields', () => {
            const modified = applyUpdates(original, ADDITIONS);

            const {ADD} = due.diff(original, modified, true);
            expect(ADD.reduce((acc, node) => {
                acc[node.path] = node.value;
                return acc;
            }, {})).toEqual(ADDITIONS);
        });

        it('returns the diff objects with the ADD fields with no orphans', () => {
            const modified = applyUpdates(original, ADDITIONS);

            const {ADD} = due.diff(original, modified, false);
            expect(ADD.reduce((acc, node) => {
                acc[node.path] = node.value;
                return acc;
            }, {})).toEqual(ADDITIONS_NO_ORPHANS);
        });

        it('returns the diff objects with the SET fields', () => {
            const modified = applyUpdates(original, UPDATES);

            const {SET} = due.diff(original, modified);
            expect(SET.reduce((acc, node) => {
                acc[node.path] = node.value;
                return acc;
            }, {})).toEqual(UPDATES);
        });

        it('returns the diff objects with the DELETE fields', () => {
            const modified = applyDeletes(original, DELETES);

            const {DELETE, SET, ADD} = due.diff(original, modified);
            expect(DELETE.reduce((acc, node) => {
                acc.push(node.path);
                return acc;
            }, []).sort()).toEqual(DELETES.sort());
            expect(ADD).toEqual([]);
            expect(SET).toEqual([]);
        });
    });

    describe('getUpdateExpression', () => {

        it('showcase test case default usage', () => {
            const modified = {
                id: 123,
                // title: 'Bicycle 123', // DELETED
                description: '123 description',
                bicycleType: 'Hybrid',
                brand: 'Brand-Company C',
                price: 600, // UPDATED
                color: ['Red', undefined, 'Blue'], // ADDED color[2] = 'Blue', REMOVED color[1] by setting to undefined, never pop, see why it is best below
                productCategory: 'Bicycle',
                inStok: false, // UPDATED boolean true => false
                quantityOnHand: null, // No change, was null in original, still null. DynamoDB recognizes null.
                relatedItems: [100, null, 649], // UPDATE relatedItems[0], REMOVE relatedItems[1], always nullify or set to undefined, never pop
                pictures: {
                    frontView: 'http://example.com/products/123_front.jpg',
                    rearView: 'http://example.com/products/123_rear.jpg',
                    sideView: 'http://example.com/products/123_right_side.jpg', // UPDATED Map item
                    'left-view': 'http://example.com/products/123_left_side.jpg' // UPDATED Map item with dash
                },
                productReview: {
                    fiveStar: [
                        "", // DynamoDB doesn't allow empty string, would be REMOVED
                        'Do yourself a favor and buy this.',
                        'This is new' // ADDED *deep* list item
                    ],
                    oneStar: [
                        'Actually I take it back, it is alright' // UPDATED *deep* List item
                    ]
                },
                comment: 'This product sells out quickly during the summer',
                'Safety.Warning': 'Always wear a helmet, ride at your own risk!' // UPDATED attribute name with `.`
            };
            const updateExpression = due.getUpdateExpression({original, modified});
            expect(updateExpression).toEqual({
                "UpdateExpression": "SET #color[2] = :color2, #pictures.#leftView = :picturesLeftView, #productReview.#fiveStar[2] = :productReviewFiveStar2, #inStok = :inStok, #pictures.#sideView = :picturesSideView, #price = :price, #productReview.#oneStar[0] = :productReviewOneStar0, #relatedItems[0] = :relatedItems0, #safetyWarning = :safetyWarning REMOVE #color[1], #productReview.#fiveStar[0], #relatedItems[1], #title",

                "ExpressionAttributeNames": {
                    "#color": "color",
                    "#fiveStar": "fiveStar",
                    "#inStok": "inStok",
                    "#leftView": "left-view",
                    "#oneStar": "oneStar",
                    "#pictures": "pictures",
                    "#price": "price",
                    "#productReview": "productReview",
                    "#relatedItems": "relatedItems",
                    "#safetyWarning": "Safety.Warning",
                    "#sideView": "sideView",
                    "#title": "title"
                },
                "ExpressionAttributeValues": {
                    ":color2": "Blue",
                    ":inStok": false,
                    ":picturesLeftView": "http://example.com/products/123_left_side.jpg",
                    ":picturesSideView": "http://example.com/products/123_right_side.jpg",
                    ":price": 600,
                    ":productReviewFiveStar2": "This is new",
                    ":productReviewOneStar0": "Actually I take it back, it is alright",
                    ":relatedItems0": 100,
                    ":safetyWarning": "Always wear a helmet, ride at your own risk!"
                }
            });
        });

        it('showcase test case orphans = false', () => {
            const partial = {
                id: 123,
                title: 'Bicycle 123',
                inStock: false,
                description: '123 description'
            };
            const modified = {
                id: 123,
                title: 'Bicycle 123',
                inStock: true,
                stock: 10,
                description: 'modified 123 description',
                pictures: {
                    topView: 'http://example.com/products/123_top.jpg'
                }
            };

            const updateExpression = due.getUpdateExpression({original: partial, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#description": "description",
                    "#inStock": "inStock",
                    "#pictures": "pictures",
                    "#stock": "stock"
                },
                "ExpressionAttributeValues": {
                    ":description": "modified 123 description",
                    ":inStock": true,
                    ":pictures": {
                        "topView": "http://example.com/products/123_top.jpg"
                    },
                    ":stock": 10
                },
                "UpdateExpression": "SET #pictures = :pictures, #stock = :stock, #description = :description, #inStock = :inStock"
            });
        });

        it('showcase test case orphans = true', () => {
            const partial = {
                id: 123,
                title: 'Bicycle 123',
                inStock: false,
                description: '123 description'
            };
            const modified = {
                id: 123,
                title: 'Bicycle 123',
                inStock: true,
                stock: 10,
                description: 'modified 123 description',
                pictures: {
                    topView: 'http://example.com/products/123_top.jpg'
                }
            };

            const updateExpression = due.getUpdateExpression({original: partial, modified, orphans: true});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#description": "description",
                    "#inStock": "inStock",
                    "#pictures": "pictures",
                    "#stock": "stock",
                    "#topView": "topView"
                },
                "ExpressionAttributeValues": {
                    ":description": "modified 123 description",
                    ":inStock": true,
                    ":picturesTopView": "http://example.com/products/123_top.jpg",
                    ":stock": 10
                },
                "UpdateExpression": "SET #pictures.#topView = :picturesTopView, #stock = :stock, #description = :description, #inStock = :inStock"
            });
        });

        it('showcase test case deep additions, orphans = false', () => {
            const partial = {
                id: 123,
                title: 'Bicycle 123',
                inStock: false,
                description: '123 description'
            };
            const modified = {
                id: 123,
                title: 'Bicycle 123',
                inStock: true,
                stock: 10,
                description: 'modified 123 description',
                productReview: {
                    fiveStar: {
                        comment: 'Such a fantastic item!'
                    }
                }
            };

            const updateExpression = due.getUpdateExpression({original: partial, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#description": "description",
                    "#inStock": "inStock",
                    "#productReview": "productReview",
                    "#stock": "stock"
                },
                "ExpressionAttributeValues": {
                    ":description": "modified 123 description",
                    ":inStock": true,
                    ":productReview": {
                        "fiveStar": {
                            "comment": "Such a fantastic item!"
                        }
                    },
                    ":stock": 10
                },
                "UpdateExpression": "SET #productReview = :productReview, #stock = :stock, #description = :description, #inStock = :inStock"
            });
        });

        it('showcase test case deep additions, orphans = true', () => {
            const partial = {
                id: 123,
                title: 'Bicycle 123',
                inStock: false,
                description: '123 description'
            };
            const modified = {
                id: 123,
                title: 'Bicycle 123',
                inStock: true,
                stock: 10,
                description: 'modified 123 description',
                productReview: {
                    fiveStar: {
                        comment: 'Such a fantastic item!'
                    }
                }
            };

            const updateExpression = due.getUpdateExpression({original: partial, modified, orphans: true});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#comment": "comment",
                    "#description": "description",
                    "#fiveStar": "fiveStar",
                    "#inStock": "inStock",
                    "#productReview": "productReview",
                    "#stock": "stock"
                },
                "ExpressionAttributeValues": {
                    ":description": "modified 123 description",
                    ":inStock": true,
                    ":productReviewFiveStarComment": "Such a fantastic item!",
                    ":stock": 10
                },
                "UpdateExpression": "SET #productReview.#fiveStar.#comment = :productReviewFiveStarComment, #stock = :stock, #description = :description, #inStock = :inStock"
            });
        });

        it('creates update expression for ADDITIONS with orphans and long name truncation to 255', () => {
            const modified = applyUpdates(original, ADDITIONS);
            const updateExpression = due.getUpdateExpression({original, modified, orphans: true});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#1AtBeginning": "1atBeginning",
                    "#color": "color",
                    "#nameWithSpace": "name with space",
                    "#newChild1": "newChild1",
                    "#newChild2": "newChild2",
                    "#newChild3": "newChild3",
                    "#newGrandChild1": "newGrandChild1",
                    "#newGrandChild2": "newGrandChild2",
                    "#newParent": "newParent",
                    "#oneStar": "oneStar",
                    "#otherSideView": "otherSideView",
                    "#pictures": "pictures",
                    "#prefixSuffix": "prefix-suffix",
                    "#productReview": "productReview",
                    "#relatedItems": "relatedItems",
                    "#root0": "root0",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen"
                },
                "ExpressionAttributeValues": {
                    ":1AtBeginning": "name starting with number is also okay",
                    ":color2": "Blue",
                    ":nameWithSpace": "name with spaces is also okay",
                    ":newParentNewChild1NewGrandChild1": "c1gc1",
                    ":newParentNewChild1NewGrandChild2": "c1gc",
                    ":newParentNewChild2NewGrandChild1": "c2gc1",
                    ":newParentNewChild2NewGrandChild2": "c2gc2",
                    ":newParentNewChild3": {},
                    ":picturesOtherSideView": "pictures.otherSideView",
                    ":prefixSuffix": "Value for attribute name with -",
                    ":productReviewOneStar1": "Never again!",
                    ":productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2": "Value for attribute name with 255 characters excluding the parent path",
                    ":relatedItems3": 1000,
                    ":root0": "root0",
                    ":thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4": "Value for attribute name with 255 characters with subscript excluding the parent path"
                },
                "UpdateExpression": "SET #color[2] = :color2, #newParent.#newChild1.#newGrandChild1 = :newParentNewChild1NewGrandChild1, #newParent.#newChild1.#newGrandChild2 = :newParentNewChild1NewGrandChild2, #newParent.#newChild2.#newGrandChild1 = :newParentNewChild2NewGrandChild1, #newParent.#newChild2.#newGrandChild2 = :newParentNewChild2NewGrandChild2, #newParent.#newChild3 = :newParentNewChild3, #pictures.#otherSideView = :picturesOtherSideView, #productReview.#oneStar[1] = :productReviewOneStar1, #productReview.#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1 = :productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2, #relatedItems[3] = :relatedItems3, #root0 = :root0, #thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3[0] = :thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4, #1AtBeginning = :1AtBeginning, #nameWithSpace = :nameWithSpace, #prefixSuffix = :prefixSuffix"
            });
        });

        it('creates update expression for ADDITIONS with no orphans', () => {
            const modified = applyUpdates(original, ADDITIONS);
            const updateExpression = due.getUpdateExpression({original, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#1AtBeginning": "1atBeginning",
                    "#color": "color",
                    "#nameWithSpace": "name with space",
                    "#newParent": "newParent",
                    "#oneStar": "oneStar",
                    "#otherSideView": "otherSideView",
                    "#pictures": "pictures",
                    "#prefixSuffix": "prefix-suffix",
                    "#productReview": "productReview",
                    "#relatedItems": "relatedItems",
                    "#root0": "root0",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen"
                },
                "ExpressionAttributeValues": {
                    ":1AtBeginning": "name starting with number is also okay",
                    ":color2": "Blue",
                    ":nameWithSpace": "name with spaces is also okay",
                    ":newParent": {
                        "newChild1": {
                            "newGrandChild1": "c1gc1",
                            "newGrandChild2": "c1gc"
                        },
                        "newChild2": {
                            "newGrandChild1": "c2gc1",
                            "newGrandChild2": "c2gc2"
                        },
                        "newChild3": {}
                    },
                    ":picturesOtherSideView": "pictures.otherSideView",
                    ":prefixSuffix": "Value for attribute name with -",
                    ":productReviewOneStar1": "Never again!",
                    ":productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2": "Value for attribute name with 255 characters excluding the parent path",
                    ":relatedItems3": 1000,
                    ":root0": "root0",
                    ":thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4": [
                        "Value for attribute name with 255 characters with subscript excluding the parent path"
                    ]
                },
                "UpdateExpression": "SET #color[2] = :color2, #newParent = :newParent, #pictures.#otherSideView = :picturesOtherSideView, #productReview.#oneStar[1] = :productReviewOneStar1, #productReview.#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1 = :productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2, #relatedItems[3] = :relatedItems3, #root0 = :root0, #thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3 = :thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4, #1AtBeginning = :1AtBeginning, #nameWithSpace = :nameWithSpace, #prefixSuffix = :prefixSuffix"
            });
        });

        it('creates update expression for UPDATES', () => {
            const modified = applyUpdates(original, UPDATES);
            const updateExpression = due.getUpdateExpression({original, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#color": "color",
                    "#oneStar": "oneStar",
                    "#pictures": "pictures",
                    "#productReview": "productReview",
                    "#rearView": "rearView",
                    "#relatedItems": "relatedItems",
                    "#safetyWarning": "Safety.Warning",
                    "#title": "title"
                },
                "ExpressionAttributeValues": {
                    ":color0": "Blue",
                    ":picturesRearView": "root1.level1",
                    ":productReviewOneStar0": "Never again!",
                    ":relatedItems1": 1000,
                    ":safetyWarning": "Value for attribute with DOT",
                    ":title": "root0"
                },
                "UpdateExpression": "SET #color[0] = :color0, #pictures.#rearView = :picturesRearView, #productReview.#oneStar[0] = :productReviewOneStar0, #relatedItems[1] = :relatedItems1, #title = :title, #safetyWarning = :safetyWarning"
            });
        });

        it('creates update expression using REMOVE for Map and List', () => {
            const modified = applyDeletes(original, DELETES);
            const updateExpression = due.getUpdateExpression({original, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#color": "color",
                    "#fiveStar": "fiveStar",
                    "#oneStar": "oneStar",
                    "#pictures": "pictures",
                    "#productReview": "productReview",
                    "#rearView": "rearView",
                    "#relatedItems": "relatedItems",
                    "#title": "title"
                },
                "UpdateExpression": "REMOVE #color[0], #pictures.#rearView, #productReview.#fiveStar[0], #productReview.#fiveStar[1], #productReview.#oneStar[0], #relatedItems[1], #title"
            });
        });

        // it.skip('creates update expression using REMOVE Map and List, and DELETES for Set', () => {
        //     const modified = applyDeletes(original, DELETES);
        //     const updateExpression = due.getUpdateExpression({original, modified, orphans: true, supportSets: true});
        //     expect(updateExpression).toEqual({});
        // });

        it('creates update expression using SET & REMOVE for mixed add/update/delete document changes', () => {
            let modified = applyUpdates(original, ADDITIONS);
            modified = applyUpdates(modified, UPDATES);
            modified = applyDeletes(modified, DELETES);
            const updateExpression = due.getUpdateExpression({original, modified});
            expect(updateExpression).toEqual({
                "ExpressionAttributeNames": {
                    "#1AtBeginning": "1atBeginning",
                    "#color": "color",
                    "#fiveStar": "fiveStar",
                    "#nameWithSpace": "name with space",
                    "#newParent": "newParent",
                    "#oneStar": "oneStar",
                    "#otherSideView": "otherSideView",
                    "#pictures": "pictures",
                    "#prefixSuffix": "prefix-suffix",
                    "#productReview": "productReview",
                    "#rearView": "rearView",
                    "#relatedItems": "relatedItems",
                    "#root0": "root0",
                    "#safetyWarning": "Safety.Warning",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen",
                    "#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3": "thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasLen",
                    "#title": "title"
                },
                "ExpressionAttributeValues": {
                    ":1AtBeginning": "name starting with number is also okay",
                    ":color2": "Blue",
                    ":nameWithSpace": "name with spaces is also okay",
                    ":newParent": {
                        "newChild1": {
                            "newGrandChild1": "c1gc1",
                            "newGrandChild2": "c1gc"
                        },
                        "newChild2": {
                            "newGrandChild1": "c2gc1",
                            "newGrandChild2": "c2gc2"
                        },
                        "newChild3": {}
                    },
                    ":picturesOtherSideView": "pictures.otherSideView",
                    ":prefixSuffix": "Value for attribute name with -",
                    ":productReviewOneStar1": "Never again!",
                    ":productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2": "Value for attribute name with 255 characters excluding the parent path",
                    ":relatedItems3": 1000,
                    ":root0": "root0",
                    ":safetyWarning": "Value for attribute with DOT",
                    ":thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4": [
                        "Value for attribute name with 255 characters with subscript excluding the parent path"
                    ]
                },
                "UpdateExpression": "SET #color[2] = :color2, #newParent = :newParent, #pictures.#otherSideView = :picturesOtherSideView, #productReview.#oneStar[1] = :productReviewOneStar1, #productReview.#thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL1 = :productReviewThisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesA2, #relatedItems[3] = :relatedItems3, #root0 = :root0, #thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL3 = :thisIsAVeryLongAttributeNameAndHadToKeepTypingRandomWordsToTryToGetUpTo255CharactersYouWouldThinkThatThisIsEnoughOrThatItWillHappenOftenWhenYouHaveAnAttributeThatLongYouMightAlsoOpenAnIssueAboutItPleaseDoNotSinceTheLibraryDoesTrimYourNamesAndLimitAliasL4, #1AtBeginning = :1AtBeginning, #nameWithSpace = :nameWithSpace, #prefixSuffix = :prefixSuffix, #safetyWarning = :safetyWarning REMOVE #color[0], #pictures.#rearView, #productReview.#fiveStar[0], #productReview.#fiveStar[1], #productReview.#oneStar[0], #relatedItems[1], #title"
            });
        });
    });

    describe('getVersionedUpdateExpression backward compatible versionning', () => {

        it('creates update expression for ADDITIONS with orphans with version = 1 if attribute_not_exists', () => {
            const original = {};
            const modified = {parent: {child: 'newChildValue'}, version: 1};
            const updateExpression = due.getVersionedUpdateExpression({original, modified, orphans: true});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":parentChild": "newChildValue",
                    ":version": 1
                },
                "UpdateExpression": "SET #parent.#child = :parentChild, #version = :version"
            });
        });

        it('creates update expression for ADDITIONS with no orphans with version = 1 if attribute_not_exists', () => {
            const original = {};
            const modified = {parent: {child: 'newChildValue'}, version: 1};
            const updateExpression = due.getVersionedUpdateExpression({original, modified, orphans: false});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":parent": {
                        "child": "newChildValue"
                    },
                    ":version": 1
                },
                "UpdateExpression": "SET #parent = :parent, #version = :version"
            });
        });

        it('creates update expression for UPDATES with version = 1 if attribute_not_exists', () => {
            const original = {parent: {child: 'oldChildValue'}};
            const modified = {parent: {child: 'newChildValue'}, version: 1};
            const updateExpression = due.getVersionedUpdateExpression({original, modified, orphans: false});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":parentChild": "newChildValue",
                    ":version": 1
                },
                "UpdateExpression": "SET #version = :version, #parent.#child = :parentChild"
            });
        });

        it('creates update expression using REMOVE for Map and List with version = 1 if attribute_not_exists', () => {
            const original = {parent: {child: 'oldChildValue'}, childList: ['one', 'two']};
            const modified = {parent: {}, childList: [null, 'two'], version: 1};
            const updateExpression = due.getVersionedUpdateExpression({original, modified, orphans: false});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":version": 1
                },
                "UpdateExpression": "SET #version = :version REMOVE #childList[0], #parent.#child"
            });
        });

        it('creates update expression using SET & REMOVE for mixed add/update/delete document changes with version = 1 if attribute_not_exists', () => {
            const original = {
                parent: {
                    child: 'oldChildValue',
                    secondChild: 'secondChildValue'
                },
                childList: ['one', 'two']
            };
            const modified = {parent: {child: 'newChildValue'}, childList: [null, 'three'], version: 1};
            const updateExpression = due.getVersionedUpdateExpression({original, modified, orphans: false});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#secondChild": "secondChild",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":childList1": "three",
                    ":parentChild": "newChildValue",
                    ":version": 1
                },
                "UpdateExpression": "SET #version = :version, #childList[1] = :childList1, #parent.#child = :parentChild REMOVE #childList[0], #parent.#secondChild"
            });
        });
    });

    describe('getVersionedUpdateExpression current version condition', () => {

        it('creates update expression for ADDITIONS with orphans with current version condition', () => {
            const original = {parent: {child: 'original value'}, version: 1};
            const modified = {parent: {child: 'new value'}, version: 2};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                condition: '='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedVersion = :expectedVersion",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#expectedVersion": "version",
                    "#parent": "parent",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":expectedVersion": 1,
                    ":parentChild": "new value",
                    ":version": 2
                },
                "UpdateExpression": "SET #parent.#child = :parentChild, #version = :version"
            });
        });

        it('creates update expression for ADDITIONS with no orphans with current version condition', () => {
            const original = {expiry: 500};
            const modified = {parent: {child: 'newChildValue'}, expiry: 1000};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.expiry',
                orphans: false, //default
                useCurrent: true,
                condition: '<'
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedExpiry < :expectedExpiry",
                "ExpressionAttributeNames": {
                    "#expectedExpiry": "expiry",
                    "#expiry": "expiry",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":expectedExpiry": 500,
                    ":expiry": 1000,
                    ":parent": {
                        "child": "newChildValue"
                    }
                },
                "UpdateExpression": "SET #parent = :parent, #expiry = :expiry"
            });
        });

        it('creates update expression for UPDATES with current version condition', () => {
            const original = {parent: {child: {name: 'oldChildValue', age: 0}}};
            const modified = {parent: {child: {name: 'newChildValue', age: 10}}};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.parent.child.age',
                useCurrent: true,
                aliasContext: {prefix: 'InvalidValue'},
                condition: '<='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#invalidValueParent.#invalidValueChild.#invalidValueAge <= :invalidValueParentChildAge",
                "ExpressionAttributeNames": {
                    "#age": "age",
                    "#child": "child",
                    "#invalidValueAge": "age",
                    "#invalidValueChild": "child",
                    "#invalidValueParent": "parent",
                    "#name": "name",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":invalidValueParentChildAge": 0,
                    ":parentChildAge": 10,
                    ":parentChildName": "newChildValue"
                },
                "UpdateExpression": "SET #parent.#child.#age = :parentChildAge, #parent.#child.#name = :parentChildName"
            });
        });

        it('creates update expression using REMOVE for Map and List with current version condition', () => {
            const original = {parent: {child: 'oldChildValue', childList: ['one', 'two']}, consumed: 100};
            const modified = {parent: {childList: [null, 'two']}, consumed: 0};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.consumed',
                useCurrent: true,
                aliasContext: {prefix: ''},
                condition: '>='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#consumed >= :consumed",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#consumed": "consumed",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":consumed": 100
                },
                "UpdateExpression": "SET #consumed = :consumed REMOVE #parent.#child, #parent.#childList[0]"
            });
        });

        it('creates update expression using SET & REMOVE for mixed add/update/delete document changes with with current version condition', () => {
            const original = {
                v: 1,
                parent: {
                    child: 'oldChildValue',
                    childList: ['one', 'two'],
                    secondChild: 'secondChildValue'
                }
            };
            const modified = {parent: {child: 'newChildValue', childList: [null, undefined]}, v: 5};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.v',
                useCurrent: true,
                aliasContext: {prefix: ''},
                condition: '='

            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#v = :v",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#parent": "parent",
                    "#secondChild": "secondChild",
                    "#v": "v"
                },
                "ExpressionAttributeValues": {
                    ":parentChild": "newChildValue",
                    ":v": 1
                },
                "UpdateExpression": "SET #parent.#child = :parentChild, #v = :v REMOVE #parent.#childList[0], #parent.#childList[1], #parent.#secondChild"
            });
        });
    });

    describe('getVersionedUpdateExpression new version condition', () => {

        it('creates update expression for ADDITIONS with orphans with new version condition', () => {
            const modified = {coupon: {code: 'HG74XSD'}, price: 10};
            const updateExpression = due.getVersionedUpdateExpression({
                modified,
                versionPath: '$.coupon.code',
                orphans: true,
                aliasContext: {prefix: ''}
            });

            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#coupon.#code)",
                "ExpressionAttributeNames": {
                    "#code": "code",
                    "#coupon": "coupon",
                    "#price": "price"
                },
                "ExpressionAttributeValues": {
                    ":couponCode": "HG74XSD",
                    ":price": 10
                },
                "UpdateExpression": "SET #coupon.#code = :couponCode, #price = :price"
            });
        });

        it('creates update expression for ADDITIONS with orphans with new version condition, overriding currentVersion value', () => {
            const modified = {coupon: {code: 'HG74XSD'}, price: 10};
            const updateExpression = due.getVersionedUpdateExpression({
                modified,
                versionPath: '$.coupon.code',
                orphans: true,
                useCurrent: false,
                currentVersion: 'N/A',
                condition: '<>'
            });

            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedCoupon.#expectedCode <> :expectedCouponCode",
                "ExpressionAttributeNames": {
                    "#code": "code",
                    "#coupon": "coupon",
                    "#expectedCode": "code",
                    "#expectedCoupon": "coupon",
                    "#price": "price"
                },
                "ExpressionAttributeValues": {
                    ":couponCode": "HG74XSD",
                    ":expectedCouponCode": "HG74XSD",
                    ":price": 10
                },
                "UpdateExpression": "SET #coupon.#code = :couponCode, #price = :price"
            });
        });

        it('creates update expression for ADDITIONS with no orphans with new version condition', () => {
            const original = {expiry: 500};
            const modified = {parent: {child: 'newChildValue'}, expiry: 1000};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.expiry',
                orphans: false, //default
                useCurrent: false,
                condition: '<='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedExpiry <= :expectedExpiry",
                "ExpressionAttributeNames": {
                    "#expectedExpiry": "expiry",
                    "#expiry": "expiry",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":expectedExpiry": 1000,
                    ":expiry": 1000,
                    ":parent": {
                        "child": "newChildValue"
                    }
                },
                "UpdateExpression": "SET #parent = :parent, #expiry = :expiry"
            });
        });

        it('creates update expression for UPDATES with new version condition', () => {
            const original = {parent: {child: {name: 'oldChildValue', age: 0}}};
            const modified = {parent: {child: {name: 'newChildValue', age: 10}}};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.parent.child.age',
                useCurrent: false,
                aliasContext: {prefix: 'InvalidValue'},
                condition: '<='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#invalidValueParent.#invalidValueChild.#invalidValueAge <= :invalidValueParentChildAge",
                "ExpressionAttributeNames": {
                    "#age": "age",
                    "#child": "child",
                    "#invalidValueAge": "age",
                    "#invalidValueChild": "child",
                    "#invalidValueParent": "parent",
                    "#name": "name",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":invalidValueParentChildAge": 10,
                    ":parentChildAge": 10,
                    ":parentChildName": "newChildValue"
                },
                "UpdateExpression": "SET #parent.#child.#age = :parentChildAge, #parent.#child.#name = :parentChildName"
            });
        });

        it('creates update expression using REMOVE for Map and List with new version condition', () => {
            const original = {parent: {child: 'oldChildValue', childList: ['one', 'two']}, consumed: 100};
            const modified = {parent: {childList: [null, 'two']}, consumed: 0};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.consumed',
                useCurrent: false,
                aliasContext: {prefix: ''},
                condition: '>='
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#consumed >= :consumed",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#consumed": "consumed",
                    "#parent": "parent"
                },
                "ExpressionAttributeValues": {
                    ":consumed": 0
                },
                "UpdateExpression": "SET #consumed = :consumed REMOVE #parent.#child, #parent.#childList[0]"
            });
        });

        it('creates update expression using SET & REMOVE for mixed add/update/delete document changes with with new version condition', () => {
            const original = {
                v: 1,
                parent: {
                    child: 'oldChildValue',
                    childList: ['one', 'two'],
                    secondChild: 'secondChildValue'
                }
            };
            const modified = {parent: {child: 'newChildValue', childList: [null, undefined]}, v: 5};
            const updateExpression = due.getVersionedUpdateExpression({
                original, modified,
                versionPath: '$.v',
                useCurrent: false,
                aliasContext: {prefix: ''},
                condition: '<'

            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#v < :v",
                "ExpressionAttributeNames": {
                    "#child": "child",
                    "#childList": "childList",
                    "#parent": "parent",
                    "#secondChild": "secondChild",
                    "#v": "v"
                },
                "ExpressionAttributeValues": {
                    ":parentChild": "newChildValue",
                    ":v": 5
                },
                "UpdateExpression": "SET #parent.#child = :parentChild, #v = :v REMOVE #parent.#childList[0], #parent.#childList[1], #parent.#secondChild"
            });
        });

        it('creates conditional update expression for try-range-lock with new version value with custom condition on current range-value', () => {
            const partial = { expiry: 1499758452832 }; // now
            const modified = { expiry: 1499762052832}; // now + 5 min
            const updateExpression = due.getVersionedUpdateExpression({
                original: partial,
                modified,
                versionPath: '$.expiry',
                condition: '<'
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedExpiry < :expectedExpiry",
                "ExpressionAttributeNames": {
                    "#expectedExpiry": "expiry",
                    "#expiry": "expiry"
                },
                "ExpressionAttributeValues": {
                    ":expectedExpiry": 1499758452832,
                    ":expiry": 1499762052832
                },
                "UpdateExpression": "SET #expiry = :expiry"
            });
        });
    });

    describe('getVersionLockExpression auto versionning', () => {

        it('creates conditional update expression for version-lock with auto version = 1 with backward compatibility check: if attribute_not_exists', () => {
            const updateExpression = due.getVersionLockExpression({});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#expectedVersion": "version",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":version": 1
                },
                "UpdateExpression": "SET #version = :version"
            });
        });

        it('creates conditional update expression for version-lock with auto version = 1 with backward compatibility check: if attribute_not_exists', () => {
            const updateExpression = due.getVersionLockExpression({original: {}});
            expect(updateExpression).toEqual({
                "ConditionExpression": "attribute_not_exists (#expectedVersion)",
                "ExpressionAttributeNames": {
                    "#expectedVersion": "version",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":version": 1
                },
                "UpdateExpression": "SET #version = :version"
            });
        });

        it('throws if auto-versioning is not possible for the current-version value', () => {
            expect(() => due.getVersionLockExpression({original: {version: 'sometext'}})).toThrow(/Invalid arguments/);
        });

        it('creates conditional update expression for range-lock with new version value with custom condition on current range-value', () => {
            const newStart = 1000;
            const updateExpression = due.getVersionLockExpression({
                versionPath: '$.start',
                newVersion: newStart,
                condition: '<'
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedStart < :expectedStart",
                "ExpressionAttributeNames": {
                    "#expectedStart": "start",
                    "#start": "start"
                },
                "ExpressionAttributeValues": {
                    ":expectedStart": 1000,
                    ":start": 1000
                },
                "UpdateExpression": "SET #start = :start"
            });
        });

        it('creates conditional update expression for version-lock with new version value with custom condition', () => {
            const expiryTimeStamp = 1499762052832;
            const updateExpression = due.getVersionLockExpression({
                newVersion: expiryTimeStamp,
                condition: '<'
            });
            expect(updateExpression).toEqual({
                "ConditionExpression": "#expectedVersion < :expectedVersion",
                "ExpressionAttributeNames": {
                    "#expectedVersion": "version",
                    "#version": "version"
                },
                "ExpressionAttributeValues": {
                    ":expectedVersion": expiryTimeStamp,
                    ":version": expiryTimeStamp
                },
                "UpdateExpression": "SET #version = :version"
            });
        });

        it('creates conditional update expression for version-lock with new version auto-incremented value ', () => {
            const original = {version: 1};
            const updateExpression = due.getVersionLockExpression({
                original,
                condition: '='
            });
            expect(updateExpression).toEqual({
                ConditionExpression: '#expectedVersion = :expectedVersion',
                ExpressionAttributeNames: {'#expectedVersion': 'version', '#version': 'version'},
                ExpressionAttributeValues: {':expectedVersion': 1, ':version': 2},
                UpdateExpression: 'SET #version = :version'
            });
        });
    });
});
