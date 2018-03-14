"use strict";

// Downloads everything in the Parameter Store as a single JSON object

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');

const AWS_REGION     = process.env['AWS_REGION'];

if (!AWS_REGION) {
    throw new Error('AWS_REGION needs to be set')
}

const PATH = (process.argv.length > 3 && process.argv.slice(3).shift().replace(/[/+]$/, '')) || '.';

ParameterStore.setRegion(AWS_REGION);
ParameterStore._collectByPath('/', (oError, aCollection) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    fs.writeFileSync(`${PATH}/CONFIG.json`, JSON.stringify(aCollection, null, '    '));
});
