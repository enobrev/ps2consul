"use strict";

const ParameterStore = require('aws-parameter-store').default;
const fs             = require('fs');
const DeepMerge      = require('deepmerge');

const ENVIRONMENT    = process.env['ENVIRONMENT'];
const AWS_REGION     = process.env['AWS_REGION'];

if (!ENVIRONMENT) {
    throw new Error('ENVIRONMENT needs to be set')
}

if (!AWS_REGION) {
    throw new Error('AWS_REGION needs to be set')
}

const PATH = (process.argv.length > 2 && process.argv.slice(2).shift().replace(/[/+]$/, '')) || '.';
const APPS = (process.argv.length > 3 && process.argv.slice(3).shift().split(','))           || [];

ParameterStore.setRegion(AWS_REGION);
ParameterStore.objectFromPath(`/${ENVIRONMENT}`, (oError, oConfig) => {
    if (oError) {
        console.error('ERROR', oError);
        process.exit(1);
    }

    const aApps   = Object.keys(oConfig).filter(sApp => sApp !== 'shared');
    const oShared = oConfig.shared;

    aApps.forEach(sApp => {
        if (APPS.length > 0 && APPS.indexOf(sApp) === -1) {
            return;
        }

        const sFile      = `${PATH}/config.${sApp}.json`;
        const oAppConfig = DeepMerge.all([oShared, oConfig[sApp]]);
        fs.writeFileSync(sFile, JSON.stringify(oAppConfig, null, '    '));
        console.log(sFile);
    });
});
