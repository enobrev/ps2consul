"use strict";

// Uploads full configuration file

const OVERWRITE      = false;
const ParameterStore = require('aws-parameter-store').default;
const AWS_REGION     = process.env['AWS_REGION'];

let ARGS = process.argv.slice(2);

const PATH      = (process.argv.length > 2 && ARGS.shift().replace(/^\/|\/$/g, ''));
const ENV_FROM  = (process.argv.length > 3 && ARGS.shift());
const ENV_TO    = (process.argv.length > 4 && ARGS.shift());

ParameterStore.setRegion(AWS_REGION);

const sFrom = ['', ENV_FROM, PATH].join('/');

const copyParams = aCollection => {
    aCollection.forEach(oParameter => {
        const sNewName =  oParameter.Name.replace(new RegExp(`^/${ENV_FROM}/`), `/${ENV_TO}/`);
        ParameterStore.put(sNewName, oParameter.Value, oParameter.Type, OVERWRITE, (oError, oResponse) => {
            if (oError) {
                console.error('Write Error!', oError.message, sNewName);
            } else {
                console.log('Copied', sNewName, oResponse);
            }
        })
    });
};

ParameterStore._collectByPath(sFrom, (oError, aCollection) => {
    if (oError) {
        console.error('Get Path ERROR!', sFrom, oError);
    } else if (!aCollection || aCollection.length === 0) {
        ParameterStore.get(sFrom, (oError, oResult) => {
            if (oError) {
                console.error('Get Parameter ERROR!', sFrom, oError);
            } else {
                copyParams([oResult.Parameter]);
            }
        });
    } else {
        copyParams(aCollection);
    }
});