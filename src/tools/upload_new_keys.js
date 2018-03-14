"use strict";

// Uploads full configuration file

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const AWS_REGION     = process.env['AWS_REGION'];


if (!fs.existsSync('./CONFIG.json')) {
    console.error('This script expects a file called NEW_KEYS.json, which should match the formatting of the output of download_whole_config.js');
    process.exit(1);
}

ParameterStore.setRegion(AWS_REGION);

const aCollection = JSON.parse(fs.readFileSync('./NEW_KEYS.json', {encoding: 'utf8'}));
aCollection.map(oParameter => {
    console.log('Setting', oParameter.Name);
    ParameterStore.put(oParameter.Name, oParameter.Value, oParameter.Type, true, (oError, oResponse) => {
        console.log('Set', oParameter.Name, oError, oResponse);
    });
});