var sys = require("sys"),
    url = require("url"),
    http = require("http"),
    qs = require("querystring"),
    crypto = require("./lib/crypto"),
    template = require("./lib/template");

function Hub() {
    this.topics = {}
}

Hub.prototype = {
    userAgent: "hub.js (+http://github.com/greut/hub.js/)",
    verifyModes: ["sync","async"],
    constructor: Hub,
    call: function(req, res) {
        var uri = url.parse(req.url),
            path = uri.pathname.substring(1);
        
        if(path == "") {
            path = "index";
        } else if(!(path in this)) {
            path = "404";
        } else if(!isNaN(parseInt(path, 10)) ||
                  path.indexOf("do_") == 0) { // do_ are kinda private
            path = "404";
        }
        
        req.setBodyEncoding("utf-8");
        this[path](req, res);
    },
    index: function(req, res) {
        switch(req.method) {
            case "GET":
                var uri = url.parse(req.url, true),
                    params = uri.query;
                
                if("hub.mode" in params) {
                    if(~["status"].indexOf(params["hub.mode"])) {
                        this["do_"+params["hub.mode"]](req, res, params);
                    } else {
                        this["405"](req, res);
                    }
                } else {
                    template.create("templates/index.html", function(tpl) {
                        res.sendHeader(200, {"Content-type": "text/html; charset=utf-8"});
                        res.write(tpl());
                        res.close();
                    });
                }
                break;
            case "POST":
                var data = "", hub = this;
                req.addListener("data", function(chunk) {
                    data += chunk;
                });
                req.addListener("end", function() {
                    var params = qs.parse(data);
                    if("hub.mode" in params &&
                       ~["publish",
                         "subscribe",
                         "unsubscribe"].indexOf(params["hub.mode"])) {
                        hub["do_"+params["hub.mode"]](req, res, params);
                    } else {
                        hub["400"](req, res, "Unknown hub.mode parameter");
                    }
                });
                break;
            default:
                this["204"](req, res);
        }
    },
    do_response: function(req, res, code, body) {
        body = body || "";
        res.sendHeader(code,
                      {"Content-Type": "text/plain",
                       "Content-Length": body.length});
        res.write(body);
        res.close()
    },
    200: function(req, res, body) {
        this.do_response(req, res, 200, body)
    },
    202: function(req, res) {
        this.do_response(req, res, 202)
    },
    204: function(req, res) {
        this.do_response(req, res, 204)
    },
    400: function(req, res, reason) {
        this.do_response(req, res, 400, reason || "Bad Request")
    },
    404: function(req, res, reason) {
        this.do_response(req, res, 404, reason || "Page not found")
    },
    405: function(req, res, reason) {
        this.do_response(req, res, 405, reason || "Method not allowed")
    },
    subscribe: function(req, res) {
        switch(req.method) {
            case "GET":
                this["404"](req, res);
                break;
            case "POST":
                this["204"](req, res);
                break;
            default:
                this["405"](req, res);
        }
    },
    publish: function(req, res) {
        switch(req.method) {
            case "GET":
                this["404"](req, res);
                break;
            case "POST":
                this["204"](req, res);
                break;
            default:
                this["405"](req, res);
        }

    },
    "subscription-details": function(req, res) {
        this["405"](req, res);
    },
    "topic-details": function(req, res) {
        this["405"](req, res);
    },
    do_publish: function(req, res, params) {
        var uri = params["hub.url"];
        if(!uri) {
            this["400"](req, res, "Empty or missing 'hub.url' parameter");
        } else {
            // there is new content at the given url

            if(uri in this.topics) {
                this.topics[uri].updated = new Date()
            } else {
                this.topics[uri] = {
                    url: uri,
                    created: new Date(),
                    updated: new Date(),
                    subscribers: 0,
                    subscriptions: {}
                }
            }

            var u = url.parse(uri),
                client = http.createClient(u.port || 80, u.hostname),
                request = client.request("GET",
                                         u.pathname + (u.search || ""),
                                         {"host": u.hostname,
                                          "X-Hub-Subscribers": this.topics[uri].subscribers});
            
            request.addListener("response", function(response) {
                var body = "";
                response.addListener("data", function(chunk) {
                    body += chunk;
                });
                response.addListener("end", function() {
                    hub.do_postman(uri, body);
                    hub["204"](req, res);
                })
            });
            
            request.close()
        }
    },
    do_status: function(req, res, params) {
        var topic = params["hub.topic"], // req
            callback = params["hub.callback"], // req
            status = topic in this.topics &&
                     callback in this.topics[topic].subscriptions ?
                        this.topics[topic].subscriptions[callback].status : "none";

        this["200"](req, res, status);
    },
    do_sub_unsub: function(req, res, params) {
        var mode = params["hub.mode"], // req
            callback = params["hub.callback"], // req
            topic = params["hub.topic"], // req
            verify = params["hub.verify"], // req sync, async or a combination
            verify_token = params["hub.verify_token"], // opt
            lease_seconds = params["hub.lease_seconds"] || 0, // opt
            secret = params["hub.secret"] || "", // opt
            debug = {
                retry_after: parseInt(params["hub.debug.retry_after"], 10) * 1000 // in seconds
            },
            cb = url.parse(callback);
        
        if(!callback || !topic || !verify) {
            return this["400"](req, res, "Expected hub.callback, hub.topic and hub.verify");
        }

        if(~callback.indexOf("#") || cb.pathname === callback ||
           ~topic.indexOf("#")) {
            return this["400"](req, res, "Invalid URL");
        }

        if(!(topic in this.topics)) {
            //return this["404"](req, res);
            // Apparently this is how it should behave?
            this.topics[topic] = {
                url: topic,
                created: new Date(),
                updated: new Date(),
                subscribers: 0,
                subscriptions: {}
            };
        }

        if(typeof verify === "string") {
            if(~verify.indexOf(",")) {
                verify = verify.split(/,\s*/)
            } else {
                verify = [verify]
            }
        }

        // Drop non-supported verify modes
        verify = verify.filter(function(v){
            return ~this.verifyModes.indexOf(v)
        }, this);

        if(verify.length) {
            verify = verify[0]
        } else {
            return this["404"](req, res)
        }
        
        if(callback in this.topics[topic].subscriptions &&
            secret !== this.topics[topic].subscriptions[callback].secret) {
            this["404"](req, res)
        } else {            
            if(verify == "async") {
                if(topic in this.topics &&
                   callback in this.topics[topic].subscriptions &&
                   this.topics[topic].subscriptions[callback].status != "none") {
                    this["202"](req, res)
                } else {
                    this["204"](req, res)
                }
            }

            var query = {
                    "hub.mode": mode,
                    "hub.topic": topic,
                    "hub.lease_seconds": lease_seconds,
                    "hub.challenge": 42 // FIXME: generate a proper challenge
                },
                subscription = {
                    topic: topic,
                    callback: callback,
                    mode: mode,
                    verify_token: verify_token,
                    verify_mode: verify,
                    secret: secret,
                    challenge: "foo",
                    lease_seconds: lease_seconds,
                    status: verify == "async" ? "accepted" : "none"
                };

            this.topics[topic].subscriptions[callback] = subscription

            if(verify_token) {
                query["hub.verify_token"] = verify_token;
            }

            this.do_verify(req, res, mode, query, subscription, debug);
        }
    },
    do_subscribe: function(req, res, params) {
        this.do_sub_unsub(req, res, params);
    },
    do_unsubscribe: function(req, res, params) {
        this.do_sub_unsub(req, res, params);
    },
    do_verify: function(req, res, mode, query, subscription, debug, retry) {
        debug = debug || {retry_after: 0};

        var hub = this,
            topic = subscription.topic,
            callback = subscription.callback,
            verify = subscription.verify_mode,
            cb = url.parse(callback),
            client = http.createClient(cb.port || 80, cb.hostname),
            request = client.request("GET",
                                     cb.pathname +
                                     (cb.search ? cb.search + "&" : "?") +
                                     qs.stringify(query),
                                     {"host": cb.hostname});
        
        // Do a maximum of 3 retries
        retry = typeof retry === "undefined" ? 3 : retry;
        if(--retry < 0) {
            this.topics[topic].subscriptions[callback].status = "none";
            delete this.topics[topic].subscriptions[callback];
            return
        }


        request.addListener("response", function(response) {
            var body = "";
            response.addListener("data", function(chunk) {
                body += chunk;
            });
            response.addListener("end", function() {
                if(response.statusCode == 200) {
                    if(mode == "subscribe") {
                        hub.topics[topic].subscribers += 1;
                        hub.topics[topic].subscriptions[callback].status = "subscribed";
                    } else if(callback in hub.topics[topic].subscriptions) {
                        hub.topics[topic].subscribers -= 1;
                        hub.topics[topic].subscriptions[callback].status = "none";
                        delete hub.topics[topic].subscriptions[callback]
                    }

                    if(verify == "sync") {
                        if(body == query["hub.challenge"]) {
                            hub["204"](req, res)
                        } else {
                            hub["405"](req, res)
                        }
                    }
                } else {
                    if(response.statusCode != 404) {
                        if(verify == "sync") {
                            hub["405"](req, res)
                        } else {
                            setTimeout(function(){
                                hub.do_verify(req, res, mode, query, subscription, debug, retry)
                            }, debug.retry_after)
                        }
                    } else {
                        if(verify == "sync") {
                            hub["405"](req, res, "The callback verification failed.")
                        }
                    }
                }
            })
        });

        request.close();
    },
    do_postman: function(topic, msg) {
        for(var callback in this.topics[topic].subscriptions) {
            var sub = this.topics[topic].subscriptions[callback],
                signature = (new crypto.Hmac).init("sha1", sub.secret)
                                             .update(msg)
                                             .digest("hex"),
                cb = url.parse(callback),
                headers = {"host": cb.hostname,
                           "Content-Type": "application/atom+xml",
                           "Content-Length": msg.length,
                           "X-Hub-Signature": "sha1="+signature},
                client = http.createClient(cb.port||80, cb.hostname),
                request = client.request("POST",
                                         cb.pathname + (cb.search || ""),
                                         headers);
            // no listeners
            request.write(msg);
            request.close()
        }
    }
};

var hub = new Hub();

http.createServer(function(req, res) {
    hub.call(req, res);
}).listen(8000);
