// TapLink Blind Hashing - NodeJS Client Library
// Version: NodeJS v1.0.1
// Contact: support@taplink.co
//
// Copyright © 2016-2017 TapLink, Inc
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

function getSaltInternal(self, versionId, callback, saltRequest, hostList, requestNum) {
    // Select the 'host' round-robin from the list of servers, based on the 'requestNum'
    saltRequest.host = self.options.servers[requestNum % self.options.servers.length];

    var startTime = Date.now();
    var request = https.get(saltRequest, function(res) {
        res.body = '';
        res.on('data', function(chunk) { res.body += chunk; });
        res.on('end', function() {
            var latency = Date.now() - startTime;
            startTime = null;

            if (res.statusCode != 200) {
                if (requestNum < self.options.retries) {
                    statsError(self, saltRequest.host);
                    return getSaltInternal(self, versionId, callback, saltRequest, hostList, ++requestNum);
                } else {
                    return callback(res);
                }
            }

            try {
                var response = JSON.parse(res.body);
            } catch (err) {
                if (requestNum < self.options.retries) {
                    statsError(self, saltRequest.host);
                    return getSaltInternal(self, versionId, callback, saltRequest, hostList, ++requestNum);
                } else {
                    return callback(res);
                }
            }

            statsSuccess(self, saltRequest.host, latency);

            // If 'versionId' specified in URL, then response may include upgrade info (new_vid, and new_s2)
            // Otherwise, response will simply include 'vid' of the response
            if (versionId == '')
                return callback(null, response.s2, response.vid);
            else
                return callback(null, response.s2, versionId, response.new_s2, response.new_vid);
        });
    }).on('error', function(err) {
        startTime = null;
        if (requestNum < self.options.retries) {
            statsError(self, saltRequest.host);
            return getSaltInternal(self, versionId, callback, saltRequest, hostList, ++requestNum);
        } else {
            return callback(err);
        }
    });

    request.setTimeout( self.options.timeout, function() {
        // Some reports online that 'setTimeout' can fire even if 'end' has fired
        // Check for 'startTime' to be defined to ensure that 'end' has not fired
        if (startTime) {
            if (requestNum < self.options.retries) {
                statsTimeout(self, saltRequest.host);
                getSaltInternal(self, versionId, callback, saltRequest, hostList, ++requestNum);
            } else {
                return callback('timeout');
            }
        }
    });
}

function statsSuccess(self, host, latency) {
    if (!self.options.stats) return;
    if (!self.stats) statsInit(self);

    var bucket = Math.round(latency / 20, 10);
    bucket = bucket > 100 ? 101 : bucket;

    self.stats.totalRequests[host]++;
    self.stats.latency[host][bucket]++;

    self.statsInt.oneMinuteRequests[host].push(Date.now());
    self.statsInt.oneMinuteLatency[host].push([ Date.now(), latency ]);
}

function statsError(self, host) {
    if (!self.options.stats) return;
    if (!self.stats) statsInit(self);

    self.stats.totalRequests[host]++;
    self.stats.totalErrors[host]++;

    self.statsInt.oneMinuteRequests[host].push(Date.now());
    self.statsInt.oneMinuteErrors[host].push(Date.now());
}

function statsTimeout(self, host) {
    if (!self.options.stats) return;
    if (!self.stats) statsInit(self);

    self.stats.totalRequests[host]++;
    self.stats.totalTimeouts[host]++;

    self.statsInt.oneMinuteRequests[host].push(Date.now());
    self.statsInt.oneMinuteTimeouts[host].push(Date.now());
}

function statsInit(self) {
    self.stats = {};
    self.statsInt = {};

    self.stats.latency = {};
    self.stats.totalErrors = {};
    self.stats.totalTimeouts = {};
    self.stats.totalRequests = {};

    self.statsInt.oneMinuteLatency = {};
    self.statsInt.oneMinuteErrors = {};
    self.statsInt.oneMinuteTimeouts = {};
    self.statsInt.oneMinuteRequests = {};

    self.stats.currentLatency = {};
    self.stats.currentTimeouts = {};
    self.stats.currentErrors = {};
    self.stats.currentRequests = {};

    self.options.servers.forEach(function (host) {
        self.stats.latency[host] = new Array(102);
        for (var i = 0; i < 102; ++i) self.stats.latency[host][i] = 0;

        self.stats.totalErrors[host] = 0;
        self.stats.totalTimeouts[host] = 0;
        self.stats.totalRequests[host] = 0;

        self.statsInt.oneMinuteRequests[host] = new Array(0);
        self.statsInt.oneMinuteLatency[host] = new Array(0);
        self.statsInt.oneMinuteErrors[host] = new Array(0);
        self.statsInt.oneMinuteTimeouts[host] = new Array(0);
    });
}

function agentStatus() {
    console.log(keepaliveAgent.getCurrentStatus());
    setTimeout(agentStatus, 10000);
}

function statsTracking(self) {
    if (self.options.stats) {
        // Update one minute running totals and averages
        var now = Date.now();

        self.options.servers.forEach(function (host) {
            // LATENCY
            // The latency list for each host is an array of [ Date.now, latency ]
            // For each host, we need to remove entries older than one minute, and then avaerage the rest
            var hostStats = self.statsInt.oneMinuteLatency[host];

            // Remove entries older than one minute (from the front of the array)
            while (hostStats.length > 0 && (now - hostStats[0][0]) > 60000) {
                hostStats.shift();
            }

            // Average the remaining entries
            if (hostStats.length > 0) {
                // Reduce takes each element in array and accumulates it into 'a'
                // Note each 'b' is [ Date.now, latency ] so we want b[1]
                // and we set 'a' to start at 0
                var sum = hostStats.reduce(function(a, b) { return a + b[1]; }, 0);
                var avg = sum / hostStats.length;
                self.stats.currentLatency[host] = avg;
            } else {
                self.stats.currentLatency[host] = null;
            }

            // REQUESTS
            // The request list for each host is a list of timestamps of when the request occurred
            hostStats = self.statsInt.oneMinuteRequests[host];
            while (hostStats.length > 0 && (now - hostStats[0]) > 60000) {
                hostStats.shift();
            }
            self.stats.currentRequests[host] = hostStats.length;

            // ERRORS
            // The error list for each host is a list of timestamps of when the error occurred
            hostStats = self.statsInt.oneMinuteErrors[host];
            while (hostStats.length > 0 && (now - hostStats[0]) > 60000) {
                hostStats.shift();
            }
            self.stats.currentErrors[host] = hostStats.length;

            // TIMEOUTS
            // The timeout list for each host is a list of timestamps of when the timeout occurred
            hostStats = self.statsInt.oneMinuteTimeouts[host];
            while (hostStats.length > 0 && (now - hostStats[0]) > 60000) {
                hostStats.shift();
            }
            self.stats.currentTimeouts[host] = hostStats.length;
        });

        // Last Step: Re-order the server list in order of reliability & performance
        //   1) Calculate failure rate and order by failure rate
        //   2) For equal error rates (e.g. zero errors) order by latency

        // Push into a sortable array the host, (error + tiemout) rate, and the latency
        // Note, treat a null latency (unused server) as a high latency to keep the server un-preferred
        var hostFailRate = [];
        for (var host in self.stats.currentErrors) {
            hostFailRate.push([
                host,
                (self.stats.currentTimeouts[host] + self.stats.currentErrors[host]) / self.stats.currentRequests[host],
                self.stats.currentLatency[host] || 9999,
            ]);
        }

        // Sort the array first on the failure rate, but if failure rate is zero, then sort on latency
        // Note a server which is not used at all in the last minute should not be preferred
        hostFailRate.sort(function(a, b) { return a[1] - b[1] || a[2] - b[2]; });

        // Apply the new host list
        var newHostList = [];
        for (var i = 0, len = hostFailRate.length; i < len; ++i) {
            newHostList.push(hostFailRate[i][0]);
        }
        self.options.servers = newHostList;
    } else {
        self.stats = null;
        self.statsInt = null;
    }

    setTimeout(function() { statsTracking(self) }, 10000);
}

TapLink.prototype = {
    init: function(callback) {
        var self = this;
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
                    self.options = JSON.parse(res.body);

                    // Default options, if not provided by server
                    self.options.timeout = self.options.timeout || 500;
                    self.options.retries = self.options.retries || 3;
                    self.options.stats   = self.options.stats   || 0
                } catch (err) {
                    return callback(err);
                }

                // agentStatus();
                callback(null);
            });
        }).on('error', function(err) {
            return callback(err);
        });

        setTimeout(function() { statsTracking(self) }, 1000);
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
        this.getSalt(hash1Hex, versionId, function(err, salt2Hex, oldVersionId, newSalt2Hex, newVersionId) {
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
            var hash1 = new Buffer(hash1Hex, 'hex');
            var hash2Hex = crypto.createHmac('sha512', salt2).update(hash1).digest('hex');
            callback(null, hash2Hex, versionId)
        });
    },

    // Retrieve a salt value from the data pool, given a 'hash1' value and optionally, a version id
    // If requested versionId is undefined or the latest, then only a single 'salt2' value is returned with the same version id as requested
    // If the requested versionId is not the latest, also returns an additional 'salt2' value along with the latest version id
    // Inputs:
    //    'hash1Hex'  - hex string containing value of hash1
    //    'versionId' - version identifier for data pool settings to use, or 0/null/undefined to use latest settings
    //    'callback'  - function(err, salt2Hex, versionId, newSalt2Hex, newVersionId)
    //       o err          : error value, or null if request succeeded
    //       o salt2Hex     : hex string containing value of 'salt2'
    //       o versionId    : version id corresponding to the provided 'salt2Hex' value (will always match requested version, if one was specified)
    //       o newSalt2Hex  : hex string containing a new value of 'salt2' if newer data pool settings are available, otherwise undefined
    //       o newVersionId : a new version id, if newer data pool settings are available, otherwise undefined
    getSalt: function(hash1Hex, versionId, callback) {
        if (!versionId)
            versionId = ''

        var saltRequest = {
            path: '/' + this.appId + '/' + hash1Hex + '/' + versionId,
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'application/json'
            },
            agent: keepaliveAgent
        }

        var hostList = this.options.servers.slice(0, this.options.servers.length);
        getSaltInternal(this, versionId, callback, saltRequest, hostList, 0);
    }
}

module.exports = TapLink;
