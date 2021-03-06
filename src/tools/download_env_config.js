"use strict";

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');

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
    '/deploy/',
    `/${ENVIRONMENT}`
], (oError, oConfig) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    fs.writeFileSync(`${PATH}/config.${ENVIRONMENT}.json`, JSON.stringify(oConfig, null, '   '));
});