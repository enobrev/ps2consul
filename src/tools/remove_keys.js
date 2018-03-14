"use strict";

// Deletes selected keys from parameter store

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const AWS_REGION     = process.env['AWS_REGION'];

if (!fs.existsSync('./REMOVE_KEYS.json')) {
    console.error('This script expects a file called REMOVE_KEYS.json, which should contain an array of keys to be removed');
    process.exit(1);
}

ParameterStore.setRegion(AWS_REGION);

const aCollection = JSON.parse(fs.readFileSync('./REMOVE_KEYS.json', {encoding: 'utf8'}));
aCollection.map(sParameter => {
    console.log('Deleting', sParameter);
    ParameterStore.delete_(sParameter, (oError, oResponse) => {
        console.log('Deleted', sParameter, oError, oResponse);
    });
});