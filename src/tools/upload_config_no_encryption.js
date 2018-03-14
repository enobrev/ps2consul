"use strict";

// Uploads Secure Parameters in their unencrypted form - without kms

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const AWS_REGION     = process.env['AWS_REGION'];


if (!fs.existsSync('./CONFIG.json')) {
    console.error('This script expects a file called CONFIG.json, which should match the formatting of the output of download_whole_config.js');
    process.exit(1);
}

ParameterStore.setRegion(AWS_REGION);

const aCollection = JSON.parse(fs.readFileSync('./CONFIG.json', {encoding: 'utf8'}));
aCollection.map(oParameter => {
    if (oParameter.Type === 'SecureString') {
        console.log('Updating', oParameter.Name);
        ParameterStore.put(oParameter.Name, oParameter.Value, ParameterStore.TYPE_STRING, true, (oError, oResponse) => {
            console.log('Updated', oParameter.Name, oError, oResponse);
        });
    } else {
        console.log('Skipped', oParameter.Name);
    }
});