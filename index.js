module.exports = function() {

    var server = require("cloudcms-server/server");

    var executeHandlers = [];
    var entryHandlers = [];
    var beforeHandlers = [];
    var afterHandlers = [];

    var r = {};

    r.execute = function(executeHandler) {
        executeHandlers.push(executeHandler);
    };

    r.entry = function(entryHandler) {
        entryHandlers.push(entryHandler);
    };

    r.before = function(beforeHandler) {
        beforeHandlers.push(beforeHandler);
    };

    r.after = function(afterHandler) {
        afterHandlers.push(afterHandler);
    };

    r.start = function(config, callback) {

        if (typeof(config) === "function") {
            callback = config;
            config = {};
        }

        var receiver = require("./lib/receiver")(executeHandlers, entryHandlers, beforeHandlers, afterHandlers);

        // register some routes
        server.routes(function(app, callback) {

            app.post("/push", function(req, res) {
                receiver.push(req, res)
            });

            app.get("/status/:id", function(req, res) {
                receiver.status(req, res, req.params["id"]);
            });

            callback();
        });

        // start the server
        server.start(config, callback);
    };

    return r;

}();
