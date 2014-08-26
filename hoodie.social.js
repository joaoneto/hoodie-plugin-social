/*
 * Copyright 2013-2014 Xiatron LLC
 */

Hoodie.extend(function(hoodie) {
    /*
    *   Social Login method
    */
    hoodie.account.socialLogin = function(providerName, /*optional*/options) {
        var defer = window.jQuery.Deferred();

        // open popup immediately to prevent it from being blocked
        var popup;
        var popupOptions = (options && options.popupOptions != undefined) ? options.popupOptions : {};
        popup = new Popup(popupOptions);
        popup.setText('connecting to ' + providerName );

        return new awaitNewAuth($.extend({defer: defer, popup: popup, provider: providerName, method: 'login'}, options));
    };
    
    /*
    *   Social Connect method
    */
    hoodie.account.socialConnect = function(providerName, /*optional*/options) {
        var defer = window.jQuery.Deferred();
        
        if (!hoodie.account.hasAccount()) {
            return defer.reject(new Error('Must be logged in!'));
        } else {
            // open popup immediately to prevent it from being blocked
            var popup;
            var popupOptions = (options && options.popupOptions != undefined) ? options.popupOptions : {};
            popup = new Popup(popupOptions);
            popup.setText('connecting to ' + providerName );

            return new awaitNewAuth($.extend({defer: defer, popup: popup, provider: providerName, method: 'connect', userid: hoodie.account.username}, options));
        }
    };
    
    /*
    *   Social Set Status method
    */
    hoodie.account.socialSetStatus = function(options) {
        var defer = window.jQuery.Deferred();
        
        if (!hoodie.account.hasAccount()) {
            return defer.reject(new Error('Must be logged in!'));
        } else {
            var attrs = {
                userid: hoodie.account.username,
                provider: options.provider,
                status: options.status
            };
            var promise = hoodie.task.start('setstatus', attrs);
            promise.then(function(data){ defer.resolve(data.doneData); });
            promise.fail(function(data){ defer.reject(); });
            return defer.promise();
        }
    }
    
    /*
    *   Social Get Profile method
    */
    hoodie.account.socialGetProfile = function(provider, /*optional*/options) {
        var defer = window.jQuery.Deferred();
        
        if (!hoodie.account.hasAccount()) {
            return defer.reject(new Error('Must be logged in!'));
        } else {
            var attrs = {
                userid: hoodie.account.username,
                provider: provider
            };
            if (options) attrs['options'] = options;
            var promise = hoodie.task.start('getprofile', attrs);
            promise.then(function(data){ defer.resolve(data.doneData); });
            promise.fail(function(data){ defer.reject(); });
            return defer.promise();
        }
    }
    
    /*
    *   Social Get Contacts method
    */
    hoodie.account.socialGetContacts = function(provider, /*optional*/options) {
        var defer = window.jQuery.Deferred();
        
        if (!hoodie.account.hasAccount()) {
            return defer.reject(new Error('Must be logged in!'));
        } else {
            var attrs = {
                userid: hoodie.account.username,
                provider: provider
            };
            if (options) attrs['options'] = options;
            var promise = hoodie.task.start('getcontacts', attrs);
            promise.then(function(data){ defer.resolve(data.doneData); });
            promise.fail(function(data){ defer.reject(); });
            return defer.promise();
        }
    }
    
    /*
    *   Social Get Followers method
    */
    hoodie.account.socialGetFollowers = function(provider, /*optional*/options) {
        var defer = window.jQuery.Deferred();
        
        if (!hoodie.account.hasAccount()) {
            return defer.reject(new Error('Must be logged in!'));
        } else {
            var attrs = {
                userid: hoodie.account.username,
                provider: provider
            };
            if (options) attrs['options'] = options;
            var promise = hoodie.task.start('getfollowers', attrs);
            promise.then(function(data){ defer.resolve(data.doneData); });
            promise.fail(function(data){ defer.reject(); });
            return defer.promise();
        }
    }
    
    /*
    *   Internal methods
    */
    function awaitNewAuth(options) {
        var settings = $.extend({
                attemptLimit:     20,
                interval:         3000,
                authServerUri:    hoodie.baseUrl+'/_api/_auth',
                destroy:          true
            }, options);
            
        var authUrlOpened = false;
        var pollForAuth = function () {
                //build the parameters
                var appendUri = '/?destroy='+settings.destroy+'&uri='+settings.authServerUri+'&method='+settings.method;
                if (settings.userid) appendUri += '&userid='+settings.userid;
              
                //reset the destroy setting
                settings.destroy = false;

                //decrement attemptLimit
                settings.attemptLimit--;
              
                //loop every x seconds until we either reach the limit or get auth data
                var authTimer = setTimeout(function(){
                    $.ajax({
                        url: settings.authServerUri+appendUri,
                        dataType: 'json',
                        xhrFields: { withCredentials: true }, /* for cross domain support*/
                        success: function(data){
                            //Check if authenticated or connected and return data or keep polling
                            if (data.method == 'login' && data.authenticated && data.temp_pass) {
                                //clear the timer
                                clearTimeout(authTimer);
                           
                                //try to sign in now
                                hoodie.account.signIn(data.id, data.temp_pass)
                                .done(function(doneData){
                                    delete data.temp_pass; //lets not do anything stupid!
                                    settings.popup.close();
                                    settings.defer.resolve(data);
                                })
                                .fail( function(failData){
                                    settings.defer.reject(new Error('signin'));
                                    console.log(failData);
                                });
                            } else if (data.method == 'connect' && data.complete && data.connections[settings.provider]) {
                                settings.popup.close();
                                settings.defer.resolve(data);
                            } else {
                                console.log(data);
                                //open the auth Url if it has not been opened
                                if (!authUrlOpened) {
                                    settings.popup.open(data.auth_urls[settings.provider]);
                                    authUrlOpened = true;
                                }
                           
                                //Setup the next poll recursively
                                if (settings.attemptLimit > 0) pollForAuth();
                            }
                        },
                        error: function(data) {
                            settings.defer.reject(new Error('ajax'));
                        }
                    });
                }, settings.interval);
            };
            
        //start polling
        pollForAuth();
            
        //return the promise of defer
        return settings.defer.promise();
    };
    
    function isPhoneGap() {
        return (window.cordova || window.PhoneGap || window.phonegap)
        && /^file:\/{3}[^\/]/i.test(window.location.href) 
        && /ios|iphone|ipod|ipad|android/i.test(navigator.userAgent);
    }
    
    // little popup helper class
    var Popup = function(popupOptions) {
        this.settings = $.extend({
                showPGLocation:     false,
            }, popupOptions);
    
        this.win = (isPhoneGap()) ? null : window.open('', 'Title', 'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, width=600, height=600, top='+Number((screen.height/2)-300)+',left='+Number((screen.width/2)-300));
    
        this.setText = function() {
          if (!isPhoneGap()) this.win.document.body.innerHTML = 'loading...';
        };
        
        this.open = function(url) {
            if (isPhoneGap()) {
                var location = (this.settings.showPGLocation) ? 'yes' : 'no';
                this.win = window.open(encodeURI(url), '_blank', 'location='+location);
            } else {
                this.win.location.href = url;
            }
        };
        
        this.resizeTo = function(width, height) {
          this.win.window.resizeTo(width, height);
        };
        
        this.moveTo = function(x, y) {
          this.win.window.moveTo(x, y);
        };
        
        this.close = function() {
          this.win.close();
        };    
    }

});