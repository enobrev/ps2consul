    const fs             = require('fs');
    const os             = require('os');
    const {URL}          = require('url');
    const http           = require('http');
    const https          = require('https');
    const async          = require('async');
    const consul         = require('consul')();
    const DeepMerge      = require('deepmerge');
    const ParameterStore = require('aws-parameter-store').default;
    const {Logger}       = require('enobrev-node-tools');
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

    // https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.html#SendMessageToHttp.prepare
    const handleSubscriptionConfirmation = sSubscribeUrl => {
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
                    ConfigServerLogger.d({action: 'ps2consul.confirm', arn: sSubscriptionArn, request_id: sRequestId});
                    //console.log(sSubscriptionArn);
                }
            });
        });

        oRequest.on('error', oError => {
            ConfigServerLogger.e({action: 'ps2consul.request.error', error: oError});
        });

        oRequest.end();
    };

    const handleNotification = (sMessage, fCallback) => {
        if (!sMessage) {
            fCallback();
        }


        let oMessage;
        try {
            oMessage = JSON.parse(sMessage);
        } catch (oError) {
            ConfigServerLogger.e({
                action:     'ps2consul.request.Notification.json_parse.error',
                error:      {
                    name:    oError.name,
                    message: oError.message
                }
            });

            fCallback(oError);
            return;
        }

        ConfigServerLogger.d({
            action:     'ps2consul.request.Notification.change',
            parameter:  oMessage.detail.name,
            type:       oMessage.detail.operation
        });

        const sKey = oMessage.detail.name;
        const aKey = sKey.split('/');
        aKey.shift(); // remove empty item
        const sEnvironment = aKey.shift();

        if (sEnvironment !== ENVIRONMENT) {
            ConfigServerLogger.d({action: 'ps2consul.request.Notification.ignore'});
            return fCallback();
        }

        ParameterStore.getValue(sKey, (oError, mValue) => {
            if (oError) {
                ConfigServerLogger.e({action: 'ps2consul.request.parameter_store.get', key: sKey, error: oError});
                return fCallback(oError);
            }

            if (aKey[0] === 'shared') {
                async.each(APPS, (sApp, fAsyncCallback) => {
                    let aAppKey = aKey.slice();
                    aAppKey.splice(0, 1, sApp);
                    const sAppKey = aAppKey.join('/');
                    consul.kv.set(sAppKey, mValue, (oError, oResult) => {
                        if (oError) {
                            ConfigServerLogger.e({action: 'ps2consul.request.consul', key: sKey, error: oError});
                        } else {
                            ConfigServerLogger.d({action: 'ps2consul.request.consul', key: sKey, result: oResult });
                        }

                        fAsyncCallback(oError);
                    });
                }, fCallback)
            } else {
                const sLocalKey = aKey.join('/');
                consul.kv.set(sLocalKey, mValue, (oError, oResult) => {
                    if (oError) {
                        ConfigServerLogger.e({action: 'ps2consul.request.consul', key: sKey, error: oError});
                    } else {
                        ConfigServerLogger.d({action: 'ps2consul.request.consul', key: sKey, result: oResult });
                    }

                    fCallback(oError);
                });
            }
        })
    };

    const parseRequestBody = (oRequest, fCallback) => {
        let aBody    = [];

        oRequest.on('error', oError => {
            ConfigServerLogger.e({action: 'ps2consul.request.parse.error', error: {
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
                ConfigServerLogger.e({
                    action:     'ps2consul.request.json_parse.error',
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

        let oHeaders = oRequest.headers;
        let sMethod  = oRequest.method;
        let sUrl     = oRequest.url;

        if (oHeaders && oHeaders['x-amz-sns-message-type'] === 'SubscriptionConfirmation') {
            ConfigServerLogger.d({
                action: 'ps2consul.request.SubscriptionConfirmation',
                method: sMethod,
                url:    sUrl,
                id:     oHeaders['x-amz-sns-message-id'],
                topic:  oHeaders['x-amz-sns-topic-arn']
            });

            parseRequestBody(oRequest, (oError, oBody) => {
                if (oBody) {
                    handleSubscriptionConfirmation(oBody.SubscribeURL);

                    oResponse.writeHead(202, {'Content-Type': 'text/plain'});
                    oResponse.end();
                } else {
                    oResponse.writeHead(500, {'Content-Type': 'text/plain'});
                    oResponse.end();
                }
            });

            return;
        } else if (oHeaders && oHeaders['x-amz-sns-message-type'] === 'Notification') {
            ConfigServerLogger.d({
                action:         'ps2consul.request.Notification',
                method:         sMethod,
                url:            sUrl,
                id:             oHeaders['x-amz-sns-message-id'],
                topic:          oHeaders['x-amz-sns-topic-arn'],
                subscription:   oHeaders['x-amz-sns-subscription-arn']
            });

            parseRequestBody(oRequest, (oError, oBody) => {
                if (oBody) {
                    handleNotification(oBody.Message, oError => {
                        oResponse.writeHead(202, {'Content-Type': 'text/plain'});
                        oResponse.end();
                    });
                } else {
                    oResponse.writeHead(500, {'Content-Type': 'text/plain'});
                    oResponse.end();
                }
            });

            return;
        } else if (sUrl === '/') {
            oResponse.writeHead(204, {'Content-Type': 'text/plain', 'x-marks': 'Spot'});
            oResponse.end();
            return;
        } else {
            ConfigServerLogger.w({action: 'ps2consul.request.weird', method: sMethod, url: sUrl});
        }

        oResponse.writeHead(202, {'Content-Type': 'text/plain'});
        oResponse.end();
    };


    ConfigServerLogger.n({action: 'ps2consul.pre-sync', environment: ENVIRONMENT});

    // Download All App Configs and then Start the Server
    ParameterStore.objectFromPath(`/${ENVIRONMENT}`, (oError, oConfig) => {
        if (oError) {
            ConfigServerLogger.e({action: 'ps2consul.sync.error', error: oError});
            process.exit(1);
        }

        ConfigServerLogger.n({action: 'ps2consul.sync', environment: ENVIRONMENT});

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
                    ConfigServerLogger.e({action: 'ps2consul.sync.error', error: oError});
                }
            });
        });

        ConfigServerLogger.n({action: 'ps2consul.synced', environment: ENVIRONMENT, apps: APPS});

        http.createServer(handleHTTPRequest).listen(oConfig.ps2consul.server.port);

        let ping = () => {
            ConfigServerLogger.i({
                action:    'ps2consul.ping',
                hostname:   os.hostname(),
                pid:        process.pid,
                port:       oConfig.ps2consul.server.port
            });
        };

        ping();
        setInterval(ping, oConfig.ps2consul.server.ping);

        ConfigServerLogger.n({action: 'ps2consul.init', environment: ENVIRONMENT, apps: APPS});
    });

