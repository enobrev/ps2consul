"use strict";

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');

const AWS_REGION     = process.env['AWS_REGION'];

if (!AWS_REGION) {
    throw new Error('AWS_REGION needs to be set')
}

if (!fs.existsSync('./DOWNLOAD_KEYS.json')) {
    console.error('This script expects a file called DOWNLOAD_KEYS.json, which should hold an array of keys to download');
    process.exit(1);
}

const aCollection = JSON.parse(fs.readFileSync('./DOWNLOAD_KEYS.json', {encoding: 'utf8'}));

ParameterStore.setRegion(AWS_REGION);
aCollection.map(sParameter => {
    ParameterStore.get(sParameter, (oError, oResponse) => {
        console.log(sParameter, oResponse.Parameter.Value || oError);
    });
});