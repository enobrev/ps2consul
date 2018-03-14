"use strict";

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const consul         = require('consul')();
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

ParameterStore.setRegion(AWS_REGION);
ParameterStore.mergePathsAsObject([
    '/deploy/',
    `/${ENVIRONMENT}`
], (oError, oConfig) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    const oFlattened = flattenObject(oConfig);
    const oSorted    = sortObject(oFlattened);

    Object.keys(oSorted).map(sKey => {
        consul.kv.set(sKey, oSorted[sKey], (oError, oResult) => {
            if (oError) {
                console.error('Error', oError);
            } else {
                console.log('Written', sKey);
            }
        });
    });

    /*
    // Create File for mass-import into consul
    const aImport    = Object.keys(oSorted).map(sKey => {
        return {
            key:   sKey,
            flags: 0,
            value: Buffer.from(oSorted[sKey]).toString('base64')
        }
    });
    const sStringed  = JSON.stringify(aImport, null, '    ');

    fs.writeFileSync(`${PATH}/config.consul_import.json`, sStringed);
    */
});
