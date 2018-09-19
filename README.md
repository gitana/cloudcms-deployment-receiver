# Cloud CMS Http Deployment Receiver

This repository provides a framework that you can use to build your own Cloud CMS custom HTTP deployment receivers.  Deployment Receivers are endpoints for the Cloud CMS deployment process.  They receive Deployment Packages which contain content (JSON and binaries) that are to be either deployed or undeployed against the endpoint.

## Getting Started

To use this in a Node project, you will first need to:

    npm install --save cloudcms-http-deployment-receiver
    
And then in your code, you'd do:

    var receiver = require("cloudcms-http-deployment-receiver");
    
    receiver.start(function() {
        console.log("Deployment Receiver is online");
    });

This will start an HTTP server (using Express).  The HTTP server exposes two controller methods:

    POST /push``
    
    GET /status/:id 
    
When Cloud CMS deploys its deployment packages, those should be targeted to the `/push` endpoint.  If you want asynchronous deployment, you should configure the Status URL for your deployment target to point to `/status/{{id}}`.  This will allow Cloud CMS to poll this deployment receiver to check when the asset has been successfully deployed.

## Event Handlers

When a Deployment Package arrives, a series of event callbacks are triggered which allow you to plug in custom handling code.
You insert your custom code by registering functions.  Each function will receive information about the current step and will
also receive a `callback` argument.  You must invoke this `callback` when you are all finished.

The reason for the `callback` is because functions run asynchronous and in parallel for performance.  You may also need to do things
like insert content into a database or do other operations which inherently take time.  Fire the `callback` once you're finished.

The `deploymentPackage` is a JSON object that describes what was deployed.  It has an `operation` property that will either be
`DEPLOY` or `UNDEPLOY`.  You can use this information, if you choose, to add or remove the content.

### before

This runs once the deployment package has arrived but before any execution has occurred.

    receiver.before(function(deploymentPackage, callback) {
        callback();
    });
    
### execute

This runs when the deployment has been completely unpacked and is ready to deploy.  The `store` variable gives you access to the all the files.  And the `manifest` is a JSON object containing an inventory of everything that is in the package including dependnecy information.

    receiver.before(function(deploymentPackage, manifest, store, callback) {
        callback();
    });
    
### entry

This runs per entry in the deployment.  It serves as an alternative (or a companion) to the `execute` method, allowing you to focus on entries one at a time.

    receiver.entry(function(deploymentPackage, manifest, store, entryPath, callback) {    
        callback();
    });
    
### after

This runs when the deployment package has completed its deployment.

    receiver.after(function(deploymentPackage, manifest, store, callback) {
        callback();
    });
    
## Example

To see a full-fledged example of this in action, check out:
[https://github.com/gitana/sdk/tree/master/http-deployment-receiver](https://github.com/gitana/sdk/tree/master/http-deployment-receiver)
