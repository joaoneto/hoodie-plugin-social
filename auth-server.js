var express = require('express');
var authServer  = express();

var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('cookie-session');
var methodOverride = require('method-override');

var passport = require('passport');
var facebookStrategy = require('passport-facebook').Strategy;
var twitterStrategy = require('passport-twitter').Strategy;
var googleStrategy = require('passport-google').OAuth2Strategy;

module.exports = function (hoodie) {
    //config express and passport
    passport.serializeUser(function(user, done) { done(null, user); });
    passport.deserializeUser(function(obj, done) { done(null, obj); });
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

    //
    // Middlewares
    //

    // middleware to `auths`
    authServer.use(function (req, res, next) {
        // No need to keep this stuff around, so lets clean up after ourselves
        var cleanupInterval = setInterval(function() {cleanupAuths();},15000);

        req.auths = {};
        req.cleanupAuths = cleanupAuths;
        
        function cleanupAuths() {
            var now = new Date().getTime();
            for(var i in req.auths) {
                if (now - req.auths[i].auth_time >= 30000) {
                    delete req.auths[i];
                }
            }
        };

        next();
    });

    // middleware to get `appHost`
    authServer.use(function (req, res, next) {
        // set the host directly from front end query parameter
        // work around until https://github.com/hoodiehq/hoodie-server/issues/183 is resolved
        req.appHost = req.query.uri || '';
        // console.log(req.query.uri, req.appHost);

        next();
    });

    // middleware to assign a an auth object
    authServer.use(function (req, res, next) {
        req.setAuthObj = function (options, callback) {
            // generate random reference ID
            var ref = Math.random().toString(36).slice(2);

            // set a new request object for tracking progress
            req.auths[ref] = {
                "method": options.method,
                "requested": new Date().getTime(),
                "authenticated":false, /*depreciated*/
                "complete": false,
                "auth_urls": {
                    "facebook": req.appHost + "/auth/facebook",
                    "twitter": req.appHost + "/auth/twitter",
                    "google": req.appHost + "/auth/google"
                },
                "connections": {}
            };
            
            //set the id if we have it
            if (options.id) req.auths[ref]['id'] = options.id;
            
            callback(ref);
        };

        next();
    });

    authServer.use(function (req, res, next) {
        // function to invoke a strategy
        req.invokeStrategy = function (provider, res) {
            var config = hoodie.config.get(provider+'_config');
            
            console.log(provider, config);

            if (config.enabled) {
                var settings = config.settings;
                settings['passReqToCallback'] = true;
                settings['failureRedirect'] = '/fail'; //todo - set this route up
                
                if (provider == 'facebook') {
                    settings['callbackURL'] = req.appHost+'/facebook/callback';
                    var providerStrategy = facebookStrategy;
                    var verify = function(req, accessToken,refreshToken,profile,done){
                        req.auths[req.session.ref]['connections'][provider] = {token: accessToken};
                        process.nextTick(function(){ return done(null,profile); });
                    }
                } else if (provider == 'twitter') {
                    settings['callbackURL'] = req.appHost+'/twitter/callback';
                    var providerStrategy = twitterStrategy;
                    var verify = function(req, accessToken,tokenSecret,profile,done){
                        req.auths[req.session.ref]['connections'][provider] = {token: accessToken, secret: tokenSecret, id: profile.id};
                        process.nextTick(function(){ return done(null,profile); });
                    }
                } else if (provider == 'google') {
                    settings['callbackURL'] = req.appHost+'/google/callback';
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
                        req.auths[req.session.ref]['connections'][provider] = {token: accessToken, secret: tokenSecret};
                        process.nextTick(function(){ return done(null,profile); });
                    }
                }
                passport.use(new providerStrategy(settings, verify));
                res.redirect(req.appHost+'/auth/'+provider);
            } else {
                res.send('Provider not configured');
                return false;
            }
        };

        next();
    });


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

    //setup base route for front end status calls
    authServer.get('/', function(req, res) {
        //check if we intend to destroy the current auth object
        if (req.query.destroy == 'true' && req.session.ref) {
            delete req.auths[req.session.ref];
            req.session = null;
            res.redirect(req.appHost+req.url.replace('destroy=true','destroy=false'));
            return false;
        }
        
        //either send the current auth object or create one
        if ((req.session.ref != undefined) && (req.auths[req.session.ref] != undefined)) {
            res.send(scrubAuthObj(req.auths[req.session.ref]));
            delete req.auths[req.session.ref]['temp_pass']; //only give it once!
        } else {
            req.setAuthObj({method: req.query.method, id: req.query.userid}, function (ref) {
                req.session.ref = ref;
                res.send(scrubAuthObj(req.auths[req.session.ref]));
            });
        }
    });


    //setup generic authenticate route (redirect destination from specific provider routes)
    authServer.get('/auth', function(req, res, next) {
        if (passport._strategies[req.query.provider] == undefined) {
            req.invokeStrategy(req.query.provider, res);
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
    authServer.get('/auth/facebook', function(req, res, next) { res.redirect(req.appHost+'/auth?provider=facebook'); });
    authServer.get('/facebook/callback', passport.authenticate('facebook'), function(req, res, next) {res.redirect(req.appHost+'/callback?provider=facebook');});

    //setup twitter specific authenicate and callback routes
    authServer.get('/auth/twitter', function(req, res, next) { res.redirect(req.appHost+'/auth?provider=twitter'); });
    authServer.get('/twitter/callback', passport.authenticate('twitter'), function(req, res, next) {res.redirect(req.appHost+'/callback?provider=twitter');});

    //setup google specific authenicate and callback routes
    authServer.get('/auth/google', function(req, res, next) { res.redirect(req.appHost+'/auth?provider=google'); });
    authServer.get('/google/callback', passport.authenticate('google'), function(req, res, next) {res.redirect(req.appHost+'/callback?provider=google');});


    //setup generic callback route (redirect destination from specific provider routes)
    authServer.get('/callback', function (req, res, next) {
        console.log('callback');
        if (req.auths[req.session.ref]['id'] == undefined) {
            //if there's no email provided by the provider (like twitter), we will create our own id
            var id = (req.user.emails == undefined) ? req.user.displayName.replace(' ','_').toLowerCase()+'_'+req.user.id : req.user.emails[0].value;
        } else {
            var id = req.auths[req.session.ref]['id'];
        }
        
        //check if we have a couch user and act accordingly
        hoodie.account.find('user', id, function(err, data){
            var updateVals = {};
            
            if (!err) {
                if (req.auths[req.session.ref]['method'] == 'login' && !req.auths[req.session.ref]['authenticated']) {
                    req.auths[req.session.ref]['provider'] = req.query.provider;
                    req.auths[req.session.ref]['id'] = id;
                    req.auths[req.session.ref]['full_profile'] = req.user;
                
                    req.auths[req.session.ref]['authenticated'] = true;
                
                    //set the auth time value (used for cleanup)
                    req.auths[req.session.ref]['auth_time'] = new Date().getTime();
                    
                    //temporarily change the users password - this is where the magic happens!
                    req.auths[req.session.ref]['temp_pass'] = Math.random().toString(36).slice(2,11);
                    
                    //update password
                    updateVals['password'] = req.auths[req.session.ref]['temp_pass'];
                }
                
                //always update connections
                var connections = (data.connections) ? data.connections : {};
                connections[req.query.provider] = req.auths[req.session.ref]['connections'][req.query.provider]; //first update from the stored connections
                req.auths[req.session.ref]['connections'] = connections; //then feed the complete obeject back to the authObject
                updateVals['connections'] = connections; //and make sure we store the latest
                                
                //update values
                hoodie.account.update('user', id, updateVals, function(err, data){ console.log(data); });
                
                //mark as complete
                req.auths[req.session.ref]['complete'] = true;
                
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
                    if (!err) res.redirect(req.appHost+'/'+req.query.provider+'/callback');
                });
            }
        });
    });
    
    return authServer;
};