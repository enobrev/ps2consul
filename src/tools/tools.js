
// https://gist.github.com/penguinboy/762197
exports.flattenObject = ob => {
    let toReturn = {};

    for (let i in ob) {
        if (!ob.hasOwnProperty(i)) continue;

        if ((typeof ob[i]) === 'object') {
            let flatObject = exports.flattenObject(ob[i]);
            for (let x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;

                toReturn[i + '/' + x] = flatObject[x];
            }
        } else {
            toReturn[i] = ob[i] + '';
        }
    }
    return toReturn;
};

exports.sortObject = oObject => {
    let oSorted = {};
    const aKeys = Object.keys(oObject);

    aKeys.sort(function (sKey1, sKey2) {
        sKey1 = sKey1.toLowerCase();
        sKey2 = sKey2.toLowerCase();

        if (sKey1 < sKey2) return -1;
        if (sKey1 > sKey2) return 1;

        return 0;
    });

    for (let iIndex in aKeys) {
        const sKey = aKeys[iIndex];
        if (typeof oObject[sKey] === 'object'
            && !(oObject[sKey] instanceof Array)) {
            oSorted[sKey] = exports.sortObject(oObject[sKey]);
        } else {
            oSorted[sKey] = oObject[sKey];
        }
    }

    return oSorted;
};