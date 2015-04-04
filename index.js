/*
 * Copyright 2013-2014 Xiatron LLC
 */

//set some vars
var util = require('util');
var passport = require('passport');
var appName = require('../../package.json').name;
//var appName = 'appback-social-example';
var ports = require('ports');
var port = ports.getPort(appName + '-hoodie-plugin-social');
var compareVersion = require('compare-version');
// var hoodieServerVer = require('../hoodie-server/package.json').version;
var hoodieServerVer = require(__dirname + '/../' + appName + '/node_modules/hoodie-server/package.json').version;

var socialApi = require('./social_api.js');
var moment = require('moment');
var socialTasks = []; //keeps track of social active tasks


//run the rest in the hoodie context
module.exports = function (hoodie, cb) {
    var authServer = require('./auth-server')(hoodie);

    //check for plugin config items and set if not there
    if (!hoodie.config.get('facebook_config')) hoodie.config.set('facebook_config', {"enabled":false,"settings":{"clientID":"","clientSecret":""}});
    if (!hoodie.config.get('twitter_config')) hoodie.config.set('twitter_config', {"enabled":false,"settings":{"consumerKey":"","consumerSecret":""}});
    if (!hoodie.config.get('google_config')) hoodie.config.set('google_config', {"enabled":false,"settings":{}});

    //get the CouchDB config then setup proxy
    hoodie.request('get', '_config', {}, function(err, data){
        if (!data.httpd_global_handlers._auth || (data.httpd_global_handlers._auth.indexOf(port) == -1)) {
            var value = '{couch_httpd_proxy, handle_proxy_req, <<"http://0.0.0.0:'+port+'">>}';
            hoodie.request('PUT', '_config/httpd_global_handlers/_auth/', {data:JSON.stringify(value)},function(err, data){
                if (err) console.log(err);
            });
        }
    });

    //listen for tasks to set status
    var social = new socialApi();
    hoodie.task.on('setstatus:add', function (db, doc) {
        if (socialTasks.indexOf(doc.id) > -1) return false;
        socialTasks.push(doc.id); //only try to process once (workaround for mutiple repeated calls)
                
        //process
        if (doc.provider && doc.userid && doc.status) {
            getSocialCreds(doc.userid, doc.provider, function(creds){
                var apiClient = new social[doc.provider](creds);
                apiClient.setStatus(doc.status, function(err, data){
                    var response = (err) ? err : data;
                    
                    //complete the task
                    completeSocialTask(db, doc, response);
                });
            });
        }
    });
    
    //listen for getprofile tasks
    hoodie.task.on('getprofile:add', function (db, doc) {
        if (socialTasks.indexOf(doc.id) > -1) return false;
        socialTasks.push(doc.id); //only try to process once (workaround for mutiple repeated calls)
            
        //process
        if (doc.provider && doc.userid) {
            getSocialCreds(doc.userid, doc.provider, function(creds){
                var apiClient = new social[doc.provider](creds);
                apiClient.getProfile(doc.options, function(err, data){
                    var response = (err) ? err : data;
                    
                    //complete the task
                    completeSocialTask(db, doc, response);
                });
            });
        }
    });
    
    //listen for getcontacts tasks
    hoodie.task.on('getcontacts:add', function (db, doc) {
        if (socialTasks.indexOf(doc.id) > -1) return false;
        socialTasks.push(doc.id); //only try to process once (workaround for mutiple repeated calls)
            
        //process
        if (doc.provider && doc.userid) {
            getSocialCreds(doc.userid, doc.provider, function(creds){
                var apiClient = new social[doc.provider](creds);
                apiClient.getContacts(doc.options, function(err, data){
                    var response = (err) ? err : data;
                    
                    //complete the task
                    completeSocialTask(db, doc, response);
                });
            });
        }
    });
    
    //listen for getfollowers tasks
    hoodie.task.on('getfollowers:add', function (db, doc) {
        if (socialTasks.indexOf(doc.id) > -1) return false;
        socialTasks.push(doc.id); //only try to process once (workaround for mutiple repeated calls)
            
        //process
        if (doc.provider && doc.userid) {
            getSocialCreds(doc.userid, doc.provider, function(creds){
                var apiClient = new social[doc.provider](creds);
                apiClient.getFollowers(doc.options, function(err, data){
                    var response = (err) ? err : data;
                    
                    //complete the task
                    completeSocialTask(db, doc, response);
                });
            });
        }
    });

    //function to get credentials
    function getSocialCreds(userid, provider, callback) {
        var creds = { accessToken: null };
        hoodie.account.find('user', userid, function(err, data){
            if (provider == 'twitter') {
                var providerConfig = hoodie.config.get('twitter_config');
                creds['consumerKey'] = providerConfig.settings.consumerKey;
                creds['consumerSecret'] = providerConfig.settings.consumerSecret;
                creds['accessSecret'] = data.connections[provider]['secret'];
                creds['id'] = data.connections[provider]['id'];
            }
            if (data.connections[provider] != undefined) creds['accessToken'] = data.connections[provider]['token'];
            callback(creds);
        });
    }
    
    //function to complete a social task and send back doneData
    function completeSocialTask(db, doc, doneData) {
        //clear the lock
        socialTasks.splice(socialTasks.indexOf(doc.id), 1);

        //mimic a 'hoodie.task.success(db, doc)' but add the doneData object
        doc['$processedAt'] = moment().format();
        doc['_deleted'] = true;
        doc['doneData'] = doneData;
        hoodie.database(db).update(doc.type, doc.id, doc, function(err, data){ if(err) console.log(err); });
    }
    
    //start the server on load    
    authServer.listen(port);
    console.log('Hoodie Social Plugin: Listening on port '+port);
    
    //Hoodie Callback
    cb();
}
