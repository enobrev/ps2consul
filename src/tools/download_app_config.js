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

const APP  = process.argv.slice(2).shift();
const PATH = (process.argv.length > 3 && process.argv.slice(3).shift().replace(/[/+]$/, '')) || '.';

if (!APP) {
    console.error('Please Add the program name in lower case as the first argument');
    process.exit(1);
}

ParameterStore.setRegion(AWS_REGION);
ParameterStore.mergePathsAsObject([
  `/${ENVIRONMENT}/shared`,
  `/${ENVIRONMENT}/${APP}`
], (oError, oConfig) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    fs.writeFileSync(`${PATH}/config.${APP}.json`, JSON.stringify(oConfig, null, '   '));
});