// TapLink Blind Hashing - NodeJS Stress Test
//
// Queues 128 ongoing blind hashing requests which will be processed by
// the client library by spreading requests across multiple persistent
// sockets with keepalive.
//
// Version: v0.0.1
// Contact: support@taplink.co
//
// Copyright © 2016 TapLink, Inc
// MIT License

var TapLink = require('./taplink.js'),
    crypto  = require('crypto');

var tapLinkAppID = process.env['TAPLINK_APPID'];
var tapLinkClient = new TapLink(tapLinkAppID);

function getTimestamp() {
        var ts = new Date();
        return ("0" + ts.getHours()).slice(-2) + ':' +
                   ("0" + ts.getMinutes()).slice(-2) + ':' +
           ("0" + ts.getSeconds()).slice(-2) + '.' +
           ("00" + ts.getMilliseconds()).slice(-3);
}

function tapLinkInit(err) {
        if (err) {
                console.log(err);
                setTimeout(tapLinkClient.init(tapLinkInit), 1000);
                return;
        }

        tapLinkClient.options.stats = 1;

        for (var i = 0; i < 128; i++) {
                setTimeout(beginTest(), 10);
        }
}

var counter = 0;
var count = {};

function beginTest() {
        var hash = crypto.createHash('sha512').update(counter.toString()).digest('hex');
        tapLinkClient.getSalt(hash, null, function(err, salt2Hex, versionId) {
                if (counter % 10000 == 0) {
                        console.log(getTimestamp(), counter);
                        Object.keys(count).forEach(function(key) {
                                console.log("            ", count[key], ":", key)
                        });

                        console.log(JSON.stringify(tapLinkClient.stats));
                }
                if (err) {
                        if (err.statusCode && err.body) {
                                var key = err.statusCode + '-' + err.body.trim();
                                if (!count[key]) count[key] = 1; else count[key]++;
                        } else if (err.code = 'ECONNRESET') {
                                if (!count[err.code]) count[err.code] = 1; else count[err.code]++;
                        } else {
                                console.log(getTimestamp(), counter, err);
                        }
                }

                counter++;
                beginTest();
        });
}

tapLinkClient.init(tapLinkInit)
