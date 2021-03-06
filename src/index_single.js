    const {URL}          = require('url');
    const http           = require('http');
    const https          = require('https');
    const consul         = require('consul')();
    const ParameterStore = require('aws-parameter-store').default;
    const {Logger}       = require('rsyslog-cee');
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

    const ConfigServerLogger = new Logger({
        service: 'PS2ConsulServer',
        console: false,
        syslog:  true
    });

    ParameterStore.setRegion(AWS_REGION);

    const preInit = () => {
        consul.status.leader(oError => {
            if (oError) {
                ConfigServerLogger.w('consul.leader', {'available': false});
                setTimeout(preInit, 1000);
            } else {
                ConfigServerLogger.w('consul.leader', {'available': true});
                init();
            }
        });
    };

    preInit();

    // https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.html#SendMessageToHttp.prepare
    const handleSubscriptionConfirmation = (oLogger, sSubscribeUrl) => {
        const oSubscribeUrl = new URL(sSubscribeUrl);

        const oRequest = https.get(oSubscribeUrl, oResponse => {
            let sResponse = '';

            oResponse.setEncoding('utf8');
            oResponse.on('data', function(sChunk) {
                sResponse += sChunk;
            });

            oResponse.on('end', function() {
                let sRequestId;
                const aRequestMatches = sResponse.match(/<RequestId>([^<]+)<\/RequestId>/);
                if (aRequestMatches && aRequestMatches.length > 1) {
                    sRequestId = aRequestMatches[1];
                    //console.log(sRequestId);
                }

                const aArnMatches = sResponse.match(/<SubscriptionArn>([^<]+)<\/SubscriptionArn>/);
                if (aArnMatches && aArnMatches.length > 1) {
                    const sSubscriptionArn = aArnMatches[1];
                    oLogger.d('response', {status: 'confirmed', arn: sSubscriptionArn, request_id: sRequestId});
                    //console.log(sSubscriptionArn);
                }
            });
        });

        oRequest.on('error', oError => {
            oLogger.e('request', {status: 'error', error: oError});
        });

        oRequest.end();
    };

    const handleNotification = (oLogger, sMessage, fCallback) => {
        if (!sMessage) {
            fCallback();
        }


        let oMessage;
        try {
            oMessage = JSON.parse(sMessage);
        } catch (oError) {
            oLogger.e('request.Notification', {
                handler: 'json_parse',
                status: 'error',
                error:      {
                    name:    oError.name,
                    message: oError.message
                }
            });

            fCallback(oError);
            return;
        }

        oLogger.d('request.Notification', {
            parameter:  oMessage.detail.name,
            type:       oMessage.detail.operation
        });

        const sKey = oMessage.detail.name;
        const aKey = sKey.split('/');
        aKey.shift(); // remove empty item
        const sEnvironment = aKey.shift();

        if (sEnvironment !== ENVIRONMENT) {
            oLogger.d('request.Notification', {status: 'ignore', why: 'Environment Mismatch'});
            return fCallback();
        }

        switch(oMessage.detail.operation) {
            case 'Create':
            case 'Update':
                ParameterStore.getValue(sKey, (oError, mValue) => {
                    if (oError) {
                        oLogger.e('parameter_store', {command: 'getValue', status: 'error', key: sKey, error: oError});
                        return fCallback(oError);
                    }

                    const sLocalKey = aKey.join('/');
                    consul.kv.set(sLocalKey, mValue, (oError, oResult) => {
                        if (oError) {
                            oLogger.e('consul.kv', {command: 'set', key: sKey, error: oError});
                        } else {
                            oLogger.d('consul.kv', {command: 'set', key: sKey, result: oResult });
                        }

                        fCallback(oError);
                    });
                });
                break;

            case 'Delete':
                const sLocalKey = aKey.join('/');
                consul.kv.del(sLocalKey, oError => {
                    if (oError) {
                        oLogger.e('consul.kv', {command: 'del', key: sKey, error: oError});
                    } else {
                        oLogger.d('consul.kv', {command: 'del', key: sKey });
                    }

                    fCallback(oError);
                });
                break;

            default:
                oLogger.e('request.Notification', {handler: 'unknown', key: sKey, type: oMessage.detail.operation});
                fCallback();
                break;
        }

    };

    const parseRequestBody = (oLogger, oRequest, fCallback) => {
        let aBody    = [];

        oRequest.on('error', oError => {
            oLogger.e('request.parse', {
                status: 'error',
                error: {
                    name:    oError.name,
                    message: oError.message
                }
            });

            fCallback(oError);
        });

        oRequest.on('data', sChunk => {
            aBody.push(sChunk);
        });

        oRequest.on('end', () => {
            let oBody;
            try {
                oBody = JSON.parse(Buffer.concat(aBody).toString());
            } catch (oError) {
                oLogger.e('request.json_parse', {
                    status: 'error',
                    error:      {
                        name:    oError.name,
                        message: oError.message
                    }
                });

                fCallback(oError);
                return;
            }

            fCallback(null, oBody);
        });
    };
    
    const handleHTTPRequest = (oRequest, oResponse) => {
        if (oRequest.url === '/health') {
            oResponse.writeHead(200);
            oResponse.end();
            return;
        }

        const oLogger  = new Logger({
            service: 'PS2Consul',
            console: false,
            syslog:  true
        });

        let oHeaders = oRequest.headers;
        let sMethod  = oRequest.method;
        let sUrl     = oRequest.url;

        if (oHeaders && oHeaders['x-amz-sns-message-type'] === 'SubscriptionConfirmation') {
            oLogger.d('request.SubscriptionConfirmation', {
                method: sMethod,
                url:    sUrl,
                id:     oHeaders['x-amz-sns-message-id'],
                topic:  oHeaders['x-amz-sns-topic-arn']
            });

            parseRequestBody(oLogger, oRequest, (oError, oBody) => {
                if (oBody) {
                    handleSubscriptionConfirmation(oLogger, oBody.SubscribeURL);

                    oResponse.writeHead(202, {'Content-Type': 'text/plain'});
                    oResponse.end();
                } else {
                    oResponse.writeHead(500, {'Content-Type': 'text/plain'});
                    oResponse.end();
                }

                oLogger.summary();
            });

            return;
        } else if (oHeaders && oHeaders['x-amz-sns-message-type'] === 'Notification') {
            oLogger.d('request.Notification', {
                method:         sMethod,
                url:            sUrl,
                id:             oHeaders['x-amz-sns-message-id'],
                topic:          oHeaders['x-amz-sns-topic-arn'],
                subscription:   oHeaders['x-amz-sns-subscription-arn']
            });

            parseRequestBody(oLogger, oRequest, (oError, oBody) => {
                if (oBody) {
                    handleNotification(oLogger, oBody.Message, oError => {
                        if (oError) {
                            oResponse.writeHead(500, {'Content-Type': 'text/plain'});
                            oResponse.end();
                        } else {
                            oResponse.writeHead(202, {'Content-Type': 'text/plain'});
                            oResponse.end();
                        }

                        oLogger.summary();
                    });
                } else {
                    oResponse.writeHead(500, {'Content-Type': 'text/plain'});
                    oResponse.end();

                    oLogger.summary();
                }
            });

            return;
        } else if (sUrl === '/') {
            oResponse.writeHead(204, {'Content-Type': 'text/plain', 'x-marks': 'Spot'});
            oResponse.end();

            oLogger.summary();
            return;
        } else {
            oLogger.w('request.weird', {method: sMethod, url: sUrl});
        }

        oResponse.writeHead(202, {'Content-Type': 'text/plain'});
        oResponse.end();

        oLogger.summary();
    };

    const init = () => {
        ConfigServerLogger.n('sync.start');

        // Download All App Configs and then Start the Server
        ParameterStore.objectFromPath(`/${ENVIRONMENT}`, (oError, oConfig) => {
            if (oError) {
                ConfigServerLogger.e('sync.error', {error: oError});
                process.exit(1);
            }

            ConfigServerLogger.n('sync.ready');

            const oFlattened = flattenObject(oConfig);
            const oSorted    = sortObject(oFlattened);

            Object.keys(oSorted).map(sKey => {
                consul.kv.set(sKey, oSorted[sKey], (oError, oResult) => {
                    if (oError) {
                        ConfigServerLogger.e('sync.consul.kv.set', {error: oError});
                    }
                });
            });

            http.createServer(handleHTTPRequest).listen(oConfig.ports.ps2consul);

            ConfigServerLogger.n('sync.done');
            ConfigServerLogger.summary();
        });
    };
