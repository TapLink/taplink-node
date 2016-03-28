// TapLink Blind Hashing - NodeJS Client Library
// Version: NodeJS v1.0.1
// Contact: support@taplink.co
//
// Copyright © 2016 TapLink, Inc
// MIT License

var https  = require('https'),
    Agent  = require('agentkeepalive').HttpsAgent,
    crypto = require('crypto');

var keepaliveAgent = new Agent({
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 60000,
    keepAliveTimeout: 30000 // free socket keepalive for 30 seconds
});

function TapLink(appId) {
    this.appId = appId;
    this.userAgent = "TapLink/1.0 nodejs/" + process.version.node;
}

TapLink.prototype = {
    init: function(callback) {
        var configRequest = {
            host: 'api.taplink.co',
            path: '/' + this.appId,
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'application/json'
            },
            agent: keepaliveAgent
        }

        https.get(configRequest, function(res) {
            res.body = "";
            res.on('data', function(chunk) { res.body += chunk });
            res.on('end', function() {
                if (res.statusCode != 200) return callback(res);
                try {
                    this.options = JSON.parse(res.body)
                } catch (err) {
                    return callback(err);
                }

                // agentStatus();
                callback(null);
            });
        }).on('error', function(err) {
            return callback(err);
        });
    },

    // Verify a password for an existing user which was stored using blind hashing.
    // If a new 'versionId' and 'hash2' value are returned, they can either be ignored, or both must be updated in the data store together which
    // will cause the latest data pool settings to be used when blind hashing for this user in the future.
    // Inputs:
    //   'hash1Hex'         - hash of the user's password, as a hex string
    //   'hash2ExpectedHex' - hex string of expected value of hash2
    //   'versionId'        - version identifier for data pool settings to use
    //   'callback'         - function(err, matched, newVersionId, newHash2Hex)
    //      o err          : 'err' from request, or null if request succeeded
    //      o matched      : 'true' if password was correct
    //      o newVersionId : a new version id, if newer data pool settings are available, otherwise undefined
    //      o newHash2Hex  : a new value for 'hash2' corresponding with new version id, otherwise undefined
    verifyPassword: function(hash1Hex, hash2ExpectedHex, versionId, callback) {
        var hash1 = new Buffer(hash1Hex, 'hex')
        this.getSalt(hash1Hex, versionId, function(err, salt2Hex, oldVersionId, newVersionId, newSalt2Hex) {
            if (err) return callback(err);

            var salt2 = new Buffer(salt2Hex, 'hex');
            var hash2Hex = crypto.createHmac('sha512', salt2).update(hash1).digest('hex');
            var matched = (hash2Hex === hash2ExpectedHex);

            if (matched && newVersionId !== undefined && newSalt2Hex !== undefined) {
                var newSalt2 = new Buffer(newSalt2Hex, 'hex');
                var newHash2Hex = crypto.createHmac('sha512', newSalt2).update(hash1).digest('hex');
                return callback(null, matched, newVersionId, newHash2Hex);
            }
            return callback(null, matched);
        });
    },

    // Calculate 'salt1' and 'hash2' for a new password, using the latest data pool settings.
    // Also returns 'versionId' for the current settings, in case data pool settings are updated in the future
    // Inputs:
    //   'hash1Hex' - hash of the user's password, as a hex string
    //   'callback' - function(err, hash2Hex, versionId)
    //       o err       : 'err' from request, or null if request succeeded
    //       o hash2Hex  : value of 'hash2' as a hex string
    //       o versionId : version id of the current data pool settings used for this request
    newPassword: function(hash1Hex, callback) {
        var hash1 = new Buffer(hash1Hex, 'hex');
        this.getSalt(hash1Hex, undefined, function(err, salt2Hex, versionId) {
            if (err) return callback(err);

            var salt2 = new Buffer(salt2Hex, 'hex');
            var hash2Hex = crypto.createHmac('sha512', salt2).update(hash1Hex).digest('hex');
            callback(null, hash2Hex, versionId)
        });
    },

    // Retrieve a salt value from the data pool, given a 'hash1' value and optionally, a version id
    // If requested versionId is undefined or the latest, then only a single 'salt2' value is returned with the same version id as requested
    // If the requested versionId is not the latest, also returns an additional 'salt2' value along with the latest version id
    // Inputs:
    //    'hash1Hex'  - hex string containing value of hash1
    //    'versionId' - version identifier for data pool settings to use, or 0/null/undefined to use latest settings
    //    'callback'  - function(salt2Hex, versionId, newSalt2Hex, newVersionId)
    //       o salt2Hex     : hex string containing value of 'salt2'
    //       o versionId    : version id corresponding to the provided 'salt2Hex' value (will always match requested version, if one was specified)
    //       o newSalt2Hex  : hex string containing a new value of 'salt2' if newer data pool settings are available, otherwise undefined
    //       o newVersionId : a new version id, if newer data pool settings are available, otherwise undefined
    getSalt: function(hash1Hex, versionId, callback) {
        if (!versionId)
            versionId = ''

        var saltRequest = {
            host: 'api.taplink.co',
            path: '/' + this.appId + '/' + hash1Hex + '/' + versionId,
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'application/json'
            },
            agent: keepaliveAgent
        }

        https.get(saltRequest, function(res) {
            res.body = '';
            res.on('data', function(chunk) { res.body += chunk; });
            res.on('end', function() {
                if (res.statusCode != 200) return callback(res);

                try {
                    var response = JSON.parse(res.body);
                } catch (err) {
                    return callback(res);
                }

                // If 'versionId' specified in URL, then response may include upgrade info (new_vid, and new_s2)
                // Otherwise, response will simply include 'vid' of the response
                if (versionId != '')
                    callback(null, response.s2, response.vid);
                else
                    callback(null, response.s2, versionId, response.new_s2, response.new_vid);
            });
        }).on('error', function(err) {
            return callback(err);
        });
    }
}

function agentStatus() {
    console.log(keepaliveAgent.getCurrentStatus());
    setTimeout(agentStatus, 10000);
}

module.exports = TapLink;