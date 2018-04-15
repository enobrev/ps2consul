    const consul         = require('consul')();
    const ParameterStore = require('aws-parameter-store').default;
    const {Logger}       = require('winston-rsyslog-cee');
    const {
        flattenObject,
        sortObject
    }                    = require('./tools/tools.js');

    const ENVIRONMENT    = process.env['ENVIRONMENT'];
    const AWS_REGION     = process.env['AWS_REGION'];

    if (!ENVIRONMENT) {
        throw new Error('ENVIRONMENT needs to be set')
    }

    if (!AWS_REGION) {
        throw new Error('AWS_REGION needs to be set')
    }

    const InstallLogger = new Logger({
        service: 'PS2ConsulInstall',
        console: false,
        syslog:  true
    });

    ParameterStore.setRegion(AWS_REGION);

    const prepare = () => {
        consul.status.leader(oError => {
            if (oError) {
                InstallLogger.w('consul.leader', {'available': false});
                setTimeout(prepare, 200);
            } else {
                InstallLogger.d('consul.leader', {'available': true});
                install();
            }
        });
    };

    const install = () => {
        InstallLogger.n('sync.start');

        // Download All App Configs and then Start the Server
        ParameterStore.objectFromPath(`/${ENVIRONMENT}`, (oError, oConfig) => {
            if (oError) {
                InstallLogger.e('sync.error', {error: oError});
                process.exit(1);
            }

            InstallLogger.n('sync.ready');

            const oFlattened = flattenObject(oConfig);
            const oSorted    = sortObject(oFlattened);

            Object.keys(oSorted).map(sKey => {
                consul.kv.set(sKey, oSorted[sKey], (oError, oResult) => {
                    if (oError) {
                        InstallLogger.e('sync.error', {error: oError});
                    }
                });
            });

            InstallLogger.n('sync.done');
            InstallLogger.summary();
            InstallLogger.removeSyslog(); // Ends the process
        });
    };

    prepare();
