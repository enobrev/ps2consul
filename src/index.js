    const {URL}          = require('url');
    const http           = require('http');
    const https          = require('https');
    const async          = require('async');
    const consul         = require('consul')();
    const DeepMerge      = require('deepmerge');
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

    const ConfigServerLogger = new Logger({
        service: 'PS2ConsulServer',
        console: false,
        syslog:  true
    });

    ParameterStore.setRegion(AWS_REGION);

    let APPS    = [];
    let SHARED  = {};

    const preInit = () => {
        consul.status.leader(oError => {
            if (oError) {
                ConfigServerLogger.w('consul.leader_not_available');
                setTimeout(preInit, 1000);
            } else {
                ConfigServerLogger.d('consul.leader_available');
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
                    oLogger.d({action: 'confirm', arn: sSubscriptionArn, request_id: sRequestId});
                    //console.log(sSubscriptionArn);
                }
            });
        });

        oRequest.on('error', oError => {
            oLogger.e({action: 'request.error', error: oError});
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
            oLogger.e({
                action:     'request.Notification.json_parse.error',
                error:      {
                    name:    oError.name,
                    message: oError.message
                }
            });

            fCallback(oError);
            return;
        }

        oLogger.d({
            action:     'request.Notification.change',
            parameter:  oMessage.detail.name,
            type:       oMessage.detail.operation
        });

        const sKey = oMessage.detail.name;
        const aKey = sKey.split('/');
        aKey.shift(); // remove empty item
        const sEnvironment = aKey.shift();

        if (sEnvironment !== ENVIRONMENT) {
            oLogger.d({action: 'request.Notification.ignore'});
            return fCallback();
        }

        switch(oMessage.detail.operation) {
            case 'Create':
            case 'Update':
                ParameterStore.getValue(sKey, (oError, mValue) => {
                    if (oError) {
                        oLogger.e({action: 'request.parameter_store.get', key: sKey, error: oError});
                        return fCallback(oError);
                    }

                    if (aKey[0] === 'shared') {
                        async.each(APPS, (sApp, fAsyncCallback) => {
                            let aAppKey = aKey.slice();
                            aAppKey.splice(0, 1, sApp);
                            const sAppKey = aAppKey.join('/');
                            consul.kv.set(sAppKey, mValue, (oError, oResult) => {
                                if (oError) {
                                    oLogger.e({action: 'request.consul.set', key: sKey, error: oError});
                                } else {
                                    oLogger.d({action: 'request.consul.set', key: sKey, result: oResult });
                                }

                                fAsyncCallback(oError);
                            });
                        }, fCallback)
                    } else {
                        const sLocalKey = aKey.join('/');
                        consul.kv.set(sLocalKey, mValue, (oError, oResult) => {
                            if (oError) {
                                oLogger.e({action: 'request.consul.set', key: sKey, error: oError});
                            } else {
                                oLogger.d({action: 'request.consul.set', key: sKey, result: oResult });
                            }

                            fCallback(oError);
                        });
                    }
                });
                break;

            case 'Delete':
                if (aKey[0] === 'shared') {
                    async.each(APPS, (sApp, fAsyncCallback) => {
                        let aAppKey = aKey.slice();
                        aAppKey.splice(0, 1, sApp);
                        const sAppKey = aAppKey.join('/');
                        consul.kv.del(sAppKey, oError => {
                            if (oError) {
                                oLogger.e({action: 'request.consul.del', key: sKey, error: oError});
                            } else {
                                oLogger.d({action: 'request.consul.del', key: sKey });
                            }

                            fAsyncCallback(oError);
                        });
                    }, fCallback)
                } else {
                    const sLocalKey = aKey.join('/');
                    consul.kv.del(sLocalKey, oError => {
                        if (oError) {
                            oLogger.e({action: 'request.consul.del', key: sKey, error: oError});
                        } else {
                            oLogger.d({action: 'request.consul.del', key: sKey });
                        }

                        fCallback(oError);
                    });
                }
                break;

            default:
                oLogger.e({action: 'request.consul.unknown_operation', key: sKey, type: oMessage.detail.operation});
                fCallback();
                break;
        }

    };

    const parseRequestBody = (oLogger, oRequest, fCallback) => {
        let aBody    = [];

        oRequest.on('error', oError => {
            oLogger.e({action: 'request.parse.error', error: {
                name:    oError.name,
                message: oError.message
            }});

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
                oLogger.e({
                    action:     'request.json_parse.error',
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
            oLogger.d({
                action: 'request.SubscriptionConfirmation',
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
            oLogger.d({
                action:         'request.Notification',
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
            oLogger.w({action: 'request.weird', method: sMethod, url: sUrl});
        }

        oResponse.writeHead(202, {'Content-Type': 'text/plain'});
        oResponse.end();

        oLogger.summary();
    };

    const init = () => {
        ConfigServerLogger.n({action: 'pre-sync', environment: ENVIRONMENT});

        // Download All App Configs and then Start the Server
        ParameterStore.objectFromPath(`/${ENVIRONMENT}`, (oError, oConfig) => {
            if (oError) {
                ConfigServerLogger.e({action: 'sync.error', error: oError});
                process.exit(1);
            }

            ConfigServerLogger.n({action: 'sync', environment: ENVIRONMENT});

            APPS   = Object.keys(oConfig).filter(sApp => sApp !== 'shared');
            SHARED = oConfig.shared;

            let oMergedConfig = {};
            APPS.forEach(sApp => {
                oMergedConfig[sApp] = DeepMerge.all([SHARED, oConfig[sApp]]);
            });

            const oFlattened = flattenObject(oMergedConfig);
            const oSorted    = sortObject(oFlattened);

            Object.keys(oSorted).map(sKey => {
                consul.kv.set(sKey, oSorted[sKey], (oError, oResult) => {
                    if (oError) {
                        ConfigServerLogger.e({action: 'sync.error', error: oError});
                    }
                });
            });

            http.createServer(handleHTTPRequest).listen(oConfig.ps2consul.server.port);

            ConfigServerLogger.n({action: 'init', environment: ENVIRONMENT, apps: APPS});
            ConfigServerLogger.summary();
        });
    };
