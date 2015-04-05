/*
 * Copyright 2013-2014 Xiatron LLC
 */

//set some vars
var express = require('express');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('cookie-session');
var methodOverride = require('method-override');

var passport = require('passport');
var util = require('util');

// var appName = require('../../package.json').name;
var appName = require('./package.json').name
            || require('../../package.json').name;

var ports = require('ports');
var port = ports.getPort(appName + '-hoodie-plugin-social');
var compareVersion = require('compare-version');

// var hoodieServerVer = require('../hoodie-server/package.json').version;
var hoodieServerVer = require('hoodie-server/package.json').version
                    || require('../hoodie-server/package.json').version;

var facebookStrategy = require('passport-facebook').Strategy;
var twitterStrategy = require('passport-twitter').Strategy;
var googleStrategy = require('passport-google-oauth').OAuth2Strategy; //from git://github.com/z0mt3c/passport-google-oauth.git
var authServer = express();
var auths = {};
var host = null;
var socialApi = require('./social_api.js');
var moment = require('moment');
var socialTasks = []; //keeps track of social active tasks

//config express and passport
passport.serializeUser(function(user, done) { done(null, user); });
passport.deserializeUser(function(obj, done) { done(null, obj); });

// New express way
authServer.use(cookieParser())
authServer.use(session({ key: 'MYKEY', signed: false, path: '/', secret: 'SECRET' }));
authServer.use(passport.initialize());
authServer.use(bodyParser.urlencoded({ extended: true }));
authServer.use(bodyParser.json());

// Add headers to support CORS
authServer.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', req.header('origin'));
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Headers', 'Authorization');
    next(); //pass to next layer of middleware
});

authServer.use(methodOverride());


//run the rest in the hoodie context
module.exports = function (hoodie, cb) {    
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
        
    //setup base route for front end status calls
    authServer.get('/', function(req, res) {
        //set the host directly from front end query parameter
        //work around until https://github.com/hoodiehq/hoodie-server/issues/183 is resolved
        if (req.query.uri) host = req.query.uri;
        
        //check if we intend to destroy the current auth object
        if (req.query.destroy == 'true' && req.session.ref) {
            delete auths[req.session.ref];
            req.session = null;
            res.redirect(host+req.url.replace('destroy=true','destroy=false'));
            return false;
        }
        
        //either send the current auth object or create one
        if ((req.session.ref != undefined) && (auths[req.session.ref] != undefined)) {
            res.send(scrubAuthObj(auths[req.session.ref]));
            delete auths[req.session.ref]['temp_pass']; //only give it once!
        } else {
            setAuthObj({method: req.query.method, id: req.query.userid}, function(ref) {
                req.session.ref = ref;
                res.send(scrubAuthObj(auths[req.session.ref]));
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
            
    //setup generic authenticate route (redirect destination from specific provider routes)
    authServer.get('/auth', function(req, res, next) {
        if (passport._strategies[req.query.provider] == undefined) {
            invokeStrategy(req.query.provider, res);
        } else {
            if (req.query.provider == 'facebook') {
                passport.authenticate(req.query.provider, { display: 'touch', scope: ['read_friendlists', 'read_stream', 'publish_actions'] })(req, res);
            } else if (req.query.provider == 'google') {
                passport.authenticate(req.query.provider, {
                    accessType: 'offline',
                    requestVisibleActions: ['https://schemas.google.com/AddActivity','https://schemas.google.com/BuyActivity','https://schemas.google.com/CheckInActivity','http://schemas.google.com/CommentActivity','https://schemas.google.com/CreateActivity','https://schemas.google.com/DiscoverActivity','https://schemas.google.com/ListenActivity','https://schemas.google.com/ReserveActivity','https://schemas.google.com/ReviewActivity','https://schemas.google.com/WantActivity'].join(' ')
                } )(req, res, next);
            } else {
                passport.authenticate(req.query.provider)(req, res, next);
            }
        }
    });
    
    //setup facebook specific authenicate and callback routes
    authServer.get('/auth/facebook', function(req, res, next) { res.redirect(host+'/auth?provider=facebook'); });
    authServer.get('/facebook/callback', passport.authenticate('facebook'), function(req, res, next) {res.redirect(host+'/callback?provider=facebook');});

    //setup twitter specific authenicate and callback routes
    authServer.get('/auth/twitter', function(req, res, next) { res.redirect(host+'/auth?provider=twitter'); });
    authServer.get('/twitter/callback', passport.authenticate('twitter'), function(req, res, next) {res.redirect(host+'/callback?provider=twitter');});
    
    //setup google specific authenicate and callback routes
    authServer.get('/auth/google', function(req, res, next) { res.redirect(host+'/auth?provider=google'); });
    authServer.get('/google/callback', passport.authenticate('google'), function(req, res, next) {res.redirect(host+'/callback?provider=google');});

    //setup generic callback route (redirect destination from specific provider routes)
    authServer.get('/callback', function(req, res, next) {
        if (auths[req.session.ref]['id'] == undefined) {
            //if there's no email provided by the provider (like twitter), we will create our own id
            var id = (req.user.emails == undefined) ? req.user.displayName.replace(' ','_').toLowerCase()+'_'+req.user.id : req.user.emails[0].value;
        } else {
            var id = auths[req.session.ref]['id'];
        }
        
        //check if we have a couch user and act accordingly
        hoodie.account.find('user', id, function(err, data){
            var updateVals = {};
            
            if (!err) {
                if (auths[req.session.ref]['method'] == 'login' && !auths[req.session.ref]['authenticated']) {
                    auths[req.session.ref]['provider'] = req.query.provider;
                    auths[req.session.ref]['id'] = id;
                    auths[req.session.ref]['full_profile'] = req.user;
                
                    auths[req.session.ref]['authenticated'] = true;
                
                    //set the auth time value (used for cleanup)
                    auths[req.session.ref]['auth_time'] = new Date().getTime();
                    
                    //temporarily change the users password - this is where the magic happens!
                    auths[req.session.ref]['temp_pass'] = Math.random().toString(36).slice(2,11);
                    
                    //update password
                    updateVals['password'] = auths[req.session.ref]['temp_pass'];
                }
                
                //always update connections
                var connections = (data.connections) ? data.connections : {};
                connections[req.query.provider] = auths[req.session.ref]['connections'][req.query.provider]; //first update from the stored connections
                auths[req.session.ref]['connections'] = connections; //then feed the complete obeject back to the authObject
                updateVals['connections'] = connections; //and make sure we store the latest
                                
                //update values
                hoodie.account.update('user', id, updateVals, function(err, data){ console.log(data); });
                
                //mark as complete
                auths[req.session.ref]['complete'] = true;
                
                //give the user some visual feedback
                res.send('<html><head><script src="http://fgnass.github.io/spin.js/dist/spin.min.js"></script></head><body onload="/*self.close();*/" style="margin:0; padding:0; width:100%; height: 100%; display: table;"><div style="display:table-cell; text-align:center; vertical-align: middle;"><div id="spin" style="display:inline-block;"></div></div><script>var spinner=new Spinner().spin(); document.getElementById("spin").appendChild(spinner.el);</script></body></html>');
            } else {
                //assume the error is because the couch user is not there and just create one
                var uuid = Math.random().toString(36).slice(2,9);
                var timeStamp = new Date();
                var userdoc = {
                    id: id,
                    password: Math.random().toString(36).slice(2,11),
                    createdAt: timeStamp,
                    updatedAt: timeStamp,
                    signedUpAt: timeStamp,
                    database: 'user/'+uuid,
                    name: 'user/'+id
                };
                
                //set ownerHash/hoodieId
                if (compareVersion(hoodieServerVer, '0.8.15') >= 0) {
                    userdoc['hoodieId'] = uuid;
                } else {
                    userdoc['ownerHash'] = uuid;
                }
                
                hoodie.account.add('user', userdoc, function(err, data){
                    //cycle back through so we can catch the fully created user
                    if (!err) res.redirect(host+'/'+req.query.provider+'/callback');
                });
            }
        });
    });
    
    //No need to keep this stuff around, so lets clean up after ourselves
    var cleanupInterval = setInterval(function() {cleanupAuths();},15000);
    function cleanupAuths() {
        var now = new Date().getTime();
        for(var i in auths) {
            if (now - auths[i].auth_time >= 30000) {
                delete auths[i];
            }
        }
    }
    
    //function to invoke a strategy
    function invokeStrategy(provider, res) {
        var config = hoodie.config.get(provider+'_config');
        if (config.enabled) {
            var settings = config.settings;
            settings['passReqToCallback'] = true;
            settings['failureRedirect'] = '/fail'; //todo - set this route up
            
            if (provider == 'facebook') {
                settings['callbackURL'] = host+'/facebook/callback';
                var providerStrategy = facebookStrategy;
                var verify = function(req, accessToken,refreshToken,profile,done){
                    auths[req.session.ref]['connections'][provider] = {token: accessToken};
                    process.nextTick(function(){ return done(null,profile); });
                }
            } else if (provider == 'twitter') {
                settings['callbackURL'] = host+'/twitter/callback';
                var providerStrategy = twitterStrategy;
                var verify = function(req, accessToken,tokenSecret,profile,done){
                    auths[req.session.ref]['connections'][provider] = {token: accessToken, secret: tokenSecret, id: profile.id};
                    process.nextTick(function(){ return done(null,profile); });
                }
            } else if (provider == 'google') {
                settings['callbackURL'] = host+'/google/callback';
                settings['scope'] = [
                    'https://www.googleapis.com/auth/userinfo.profile',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'https://www.googleapis.com/auth/plus.me',
                    'https://www.googleapis.com/auth/plus.media.upload',
                    'https://www.googleapis.com/auth/plus.profiles.read',
                    'https://www.googleapis.com/auth/plus.stream.read',
                    'https://www.googleapis.com/auth/plus.stream.write',
                    'https://www.googleapis.com/auth/plus.circles.read',
                    'https://www.googleapis.com/auth/plus.circles.write',
                    'https://www.googleapis.com/auth/plus.login'
                ];
                var providerStrategy = googleStrategy;
                var verify = function(req, accessToken,tokenSecret,profile,done){
                    auths[req.session.ref]['connections'][provider] = {token: accessToken, secret: tokenSecret};
                    process.nextTick(function(){ return done(null,profile); });
                }
            }
            passport.use(new providerStrategy(settings,verify));
            res.redirect(host+'/auth/'+provider);
        } else {
            res.send('Provider not configured');
            return false;
        }
    }
        
    //function to assign a an auth object
    function setAuthObj(options, callback) {
        //generate random reference ID
        var ref = Math.random().toString(36).slice(2);
        
        //set a new request object for tracking progress
        auths[ref] = {
            "method": options.method,
            "requested": new Date().getTime(),
            "authenticated":false, /*depreciated*/
            "complete": false,
            "auth_urls": {
                "facebook":host+"/auth/facebook",
                "twitter":host+"/auth/twitter",
                "google":host+"/auth/google"
            },
            "connections": {}
        };
        
        //set the id if we have it
        if (options.id) auths[ref]['id'] = options.id;
        
        callback(ref);
    }
    
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
    
    //function to filter out any data we don't want to pass back to the front end
    function scrubAuthObj(authObj) {
        authObjCleaned = authObj;
        
        //remove token data
        if (authObjCleaned.connections.facebook) authObj.connections.facebook = true;
        if (authObjCleaned.connections.twitter) authObj.connections.twitter = true;
        if (authObjCleaned.connections.google) authObj.connections.google = true;
        
        //remove other unecessary object data
        if (authObjCleaned.method == 'connect') delete authObj.authenticated;
        if (authObjCleaned.complete) delete authObj.auth_urls;
        
        return authObjCleaned;
    }
    
    //start the server on load
    authServer.listen(port);
    console.log('Hoodie Social Plugin: Listening on port '+port);
    
    //Hoodie Callback
    cb();
}