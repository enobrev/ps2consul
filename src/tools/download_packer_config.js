"use strict";

// Downloads everything in the parameter store under the environment path, but with keys flattened rather than as a

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const {
    flattenObject,
    sortObject
}                    = require('./tools');

const ENVIRONMENT    = process.env['ENVIRONMENT'];
const AWS_REGION     = process.env['AWS_REGION'];

if (!ENVIRONMENT) {
    throw new Error('ENVIRONMENT needs to be set')
}

if (!AWS_REGION) {
    throw new Error('AWS_REGION needs to be set')
}

const PATH = (process.argv.length > 2 && process.argv.slice(2).shift().replace(/[/+]$/, '')) || '.';

ParameterStore.setRegion(AWS_REGION);
ParameterStore.mergePathsAsObject([
    `/${ENVIRONMENT}`
], (oError, oConfig) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    const oFlattened = flattenObject(oConfig, '.');
    const oSorted    = sortObject(oFlattened);
    const sStringed  = JSON.stringify(oSorted, null, '    ');
    const sFileJson  = `${PATH}/config.packer.json`;

    fs.writeFileSync(sFileJson, sStringed);

    console.log(`Wrote ${sFileJson}`);

    const oUnderscored = flattenObject(oConfig, '_');
    const oUnderSorted = sortObject(oUnderscored);
    const aOutput = Object.keys(oUnderSorted).map(sKey => {
        const mValue = oUnderSorted[sKey];
        let sValue;
        if (mValue.indexOf("\n") > -1) {
            sValue = "<<VALUE\n" + mValue + "\nVALUE"
        } else {
            sValue = isNaN(mValue) || mValue.indexOf('+') === 0 ? `"${mValue}"` : mValue;
        }

        let mCleanKey = sKey.replace(/\./g, '_');
        if (/^[0-9]/.test(sKey)) {
            mCleanKey = `_${mCleanKey}`;
        }

        return `${mCleanKey} = ${sValue}`
    });
    const sFileHcl  = `${PATH}/config.packer.hcl`;

    fs.writeFileSync(sFileHcl, aOutput.join("\n"));

    console.log(`Wrote ${sFileHcl}`);
});