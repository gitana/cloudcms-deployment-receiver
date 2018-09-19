module.exports = function(config) {

    if (!config) {
        config = {};
    }

    var server = require("cloudcms-server/server");
    var receiver = require("./lib/receiver")(config);

    // register some routes
    server.routes(function(app, callback) {

        app.post("/push", function(req, res) {
            receiver.push(req, res)
        });

        app.post("/status/:id", function(req, res) {
            receiver.status(req, res, req.params["id"]);
        });

        callback();
    });

    // start the server
    server.start(config);

};