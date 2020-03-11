"use strict";

// Uploads full configuration file

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const async          = require('async');
const AWS_REGION     = process.env['AWS_REGION'];


if (!fs.existsSync('./NEW_KEYS.json')) {
    console.error('This script expects a file called NEW_KEYS.json, which should match the formatting of the output of download_whole_aws_config.js');
    process.exit(1);
}

ParameterStore.setRegion(AWS_REGION);

const aCollection = JSON.parse(fs.readFileSync('./NEW_KEYS.json', {encoding: 'utf8'}));

async.eachLimit(aCollection, 5, (oParameter, fCallback) => {
    console.log('Setting', oParameter.Name);
    ParameterStore.put(oParameter.Name, oParameter.Value, oParameter.Type, true, (oError, oResponse) => {
        console.log('Set', oParameter.Name, oError, oResponse);
        setTimeout(() => {
            fCallback(oError);
        }, 5000);
    });
}, oError => {
    if (oError) {
        console.error('Error', oError);
    } else {
        console.log('Done!');
    }
});