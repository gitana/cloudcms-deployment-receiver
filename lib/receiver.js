var fs = require("fs-extra");
var unzip = require("unzip2");
var async = require("async");
var jsonMerge = require("./jsonmerge").jsonMerge;

var engineFactory = require("cloudcms-server/middleware/stores/engines/fs");
var storeFactory = require("cloudcms-server/middleware/stores/store");
var multiStoreFactory = require("cloudcms-server/middleware/stores/multistore");

var createStore = function(engineId, basePath, callback)
{
    var engineType = "fs";
    var engineConfiguration = {
        "basePath": basePath
    };
    var host = "local";
    var offsetPath = "/";

    var engine = engineFactory();
    engine.init(function(err) {

        if (err) {
            return callback(err);
        }

        var store = storeFactory(engine, engineType, null, engineConfiguration, host, offsetPath);

        callback(null, store);
    });
};

// deployment package states
var PENDING = "PENDING";
var PROCESSING = "PROCESSING";
var SUCCESS = "SUCCESS";
var ERROR = "ERROR";

var pendingTaskIds = [];
var tasks = {};

var nextTaskId = function() {
    var count = 0;

    return function() {
        return "task" + (++count);
    }
}();

/*

    {
        "state": "",
        "records": [{
            "_doc": "",
            "state": "",            // NONE, DIRTY, PROCESSING, FINISHED, ERROR
            "operation": "",
            "ref": "",
            "success": "",
            "message": ""
        }],
        "operation": "",
        "retain": ""
    }
 */

module.exports = function(executeHandlers, entryHandlers, beforeHandlers, afterHandlers)
{
    if (!executeHandlers) {
        executeHandlers = [];
    }

    if (!entryHandlers) {
        entryHandlers = [];
    }

    var processPendingTasks = function()
    {
        setTimeout(function() {

            if (pendingTaskIds.length === 0)
            {
                return processPendingTasks();
            }

            var taskId = pendingTaskIds.splice(0, 1);
            var task = tasks[taskId];

            processTask(taskId, task, function(err) {

                if (err) {
                    task.state = task.deploymentPackage.state = ERROR;
                } else {
                    task.state = task.deploymentPackage.state = SUCCESS;
                }

                processPendingTasks();
            });
        }, 250);
    };
    processPendingTasks();

    var processTask = function(taskId, task, callback)
    {
        // deployment package
        var deploymentPackage = task.deploymentPackage;

        // update all records to FINISHED
        var records = deploymentPackage.records || [];
        for (var i = 0; i < records.length; i++)
        {
            records[i].state = "FINISHED";
            records[i].success = true;
        }

        // unzip all of the zip files
        var tempPath = "/tmp/http-deployment-receiver/" + taskId;
        fs.mkdirsSync(tempPath);

        // unzip everything we need to disk
        var storeList = [];
        var stores = {};
        var targetPaths = {};
        var fns = [];
        for (var i = 0; i < task.zipFilePaths.length; i++)
        {
            var targetPath = tempPath + "/" + i;
            targetPaths[task.zipFilePaths[i]] = targetPath;

            var engineId = "engine" + i;

            var fn = function(engineId, zipFilePath, targetPath) {
                return function(done) {

                    fs.createReadStream(zipFilePath)
                        .pipe(unzip.Extract({
                            "path": targetPath
                        }))
                        .on("error", function(err) {
                            done(err);
                        })
                        .on("finish", function() {

                            // mount store
                            createStore(engineId, targetPath, function(err, store) {
                                stores[zipFilePath] = store;
                                storeList.push(store);

                                done();
                            });
                        });

                };
            }(engineId, task.zipFilePaths[i], targetPath);
            fns.push(fn);
        }
        async.series(fns, function(err) {

            // merge the manifests together into a single one
            var manifestHolder = {
                "manifest": {}
            };

            // walk stores in reverse and merge manifests
            var fns = [];
            for (var i = storeList.length - 1; i >= 0; i--)
            {
                var fn = function(store, manifestHolder) {
                    return function(done) {
                        store.readFile("./manifest.json", function(err, data) {
                            if (err) {
                                return done(err);
                            }

                            manifestHolder.manifest = jsonMerge(JSON.parse("" + data), manifestHolder.manifest);
                            done();
                        })
                    }
                }(storeList[i], manifestHolder);
                fns.push(fn);
            }

            async.series(fns, function(err) {

                // resulting manifest
                var manifest = manifestHolder.manifest;

                // mount all stores into a single layered multistore
                var multistore = multiStoreFactory(storeList);

                // collect custom functions that we'll call
                var fns = [];

                // bind in before handlers
                for (var i = 0; i < beforeHandlers.length; i++) {
                    var beforeHandler = beforeHandlers[i];

                    var fn = function(deploymentPackage, beforeHandler) {
                        return function(done) {
                            beforeHandler(deploymentPackage, function(err) {
                                done(err);
                            });
                        };
                    }(deploymentPackage, beforeHandler);
                    fns.push(fn);
                }

                // bind in execute handlers
                for (var i = 0; i < executeHandlers.length; i++) {
                    var executeHandler = executeHandlers[i];

                    var fn = function(deploymentPackage, executeHandler, manifest, multistore) {
                        return function(done) {
                            executeHandler(deploymentPackage, manifest, multistore, function(err) {
                                done(err);
                            });
                        };
                    }(deploymentPackage, executeHandler, manifest, multistore);
                    fns.push(fn);
                }

                // bind in entry handlers
                for (var i = 0; i < entryHandlers.length; i++) {
                    var entryHandler = entryHandlers[i];

                    var fn = function(deploymentPackage, entryHandler, manifest, multistore) {
                        return function(done) {

                            // walk over everything in the multistore
                            multistore.matchFiles("/", "^.*$", function(err, matches) {

                                var _fns = [];
                                for (var i = 0; i < matches.length; i++)
                                {
                                    var _fn = function(deploymentPackage, entryHandler, manifest, multistore, match) {
                                        return function(_done) {
                                            entryHandler(deploymentPackage, manifest, multistore, match, function(err) {
                                                _done(err);
                                            });
                                        }
                                    }(deploymentPackage, entryHandler, manifest, multistore, matches[i]);
                                    _fns.push(_fn);
                                }
                                async.series(_fns, function(err) {
                                    done(err);
                                })
                            });
                        }
                    }(deploymentPackage, entryHandler, manifest, multistore);
                    fns.push(fn);
                }

                // bind in after handlers
                for (var i = 0; i < afterHandlers.length; i++) {
                    var afterHandler = afterHandlers[i];

                    var fn = function(deploymentPackage, afterHandler, manifest, multistore) {
                        return function(done) {
                            afterHandler(deploymentPackage, manifest, multistore, function(err) {
                                done(err);
                            });
                        };
                    }(deploymentPackage, afterHandler, manifest, multistore);
                    fns.push(fn);
                }

                // execute all the handlers
                async.series(fns, function(err) {
                    callback(err);
                });
            });
        });
    };

    var r = {};

    r.push = function(req, res)
    {
        // get deployment package and archive zip files on disk
        var deploymentPackage = null;
        var zipFilePaths = [];

        // anything that starts with "archive-" is an archive
        for (var name in req.files)
        {
            if (name.indexOf("archive-") === 0)
            {
                zipFilePaths.push(req.files[name].path);
            }
        }

        // we must have at least one zip file path
        if (zipFilePaths.length === 0)
        {
            return res.status(500).json({
                "message": "The multipart POST must include at least one 'archive-ID' part"
            });
        }

        if (req.body && req.body.package) {
            deploymentPackage = JSON.parse("" + req.body.package);
        }

        if (!deploymentPackage) {
            return res.status(500).json({
                "message": "The multipart POST must include an 'object' part containing the deployment package JSON"
            });
        }

        var taskId = nextTaskId();

        // remove from queue if its already there
        var existingIndex = pendingTaskIds.indexOf(taskId);
        if (existingIndex > -1) {
            pendingTaskIds.splice(existingIndex, 1);
        }

        // add to queue
        tasks[taskId] = {
            "id": taskId,
            "deploymentPackage": deploymentPackage,
            "zipFilePaths": zipFilePaths
        };
        pendingTaskIds.push(taskId);

        console.log("Pushed task: " + taskId + " for deployment package: " + deploymentPackage._doc);

        // send back a 200
        res.status(200).json({
            "_doc": taskId
        });
    };

    r.status = function(req, res, id)
    {
        var task = tasks[id];
        if (!task)
        {
            return res.status(404).end();
        }

        res.status(200).json(task.deploymentPackage);
    };

    return r;
};