/*
 * Some portions adapted from https://github.com/hoodiehq/hoodie-plugin-appconfig
 * Other remaining work Copyright 2013 Xiatron LLC
 */
 
$(function () {

    var getConfig = _.partial(couchr.get, '/_api/plugins/'+encodeURIComponent('plugin/hoodie-plugin-social'));
    var setConfig = _.partial(couchr.put, '/_api/plugins/'+encodeURIComponent('plugin/hoodie-plugin-social'));

    function updateConfig(obj, callback) {
        getConfig(function (err, doc) {
            if (err) {
                return callback(err);
            }
            doc.config = _.extend(doc.config, obj);
            setConfig(doc, callback);
        });
    }

    // set initial form values
    getConfig(function (err, doc) {
        if (err) {
            return alert(err);
        }
        
        //set Facebook values
        $('[name=facebookEnabledSelect]').val(doc.config.facebook_config.enabled+'');
        $('[name=facebookClientID]').val(doc.config.facebook_config.settings.clientID);
        $('[name=facebookClientSecret]').val(doc.config.facebook_config.settings.clientSecret);
        
        //set Twitter values
        $('[name=twitterEnabledSelect]').val(doc.config.twitter_config.enabled+'');
        $('[name=twitterConsumerKey]').val(doc.config.twitter_config.settings.consumerKey);
        $('[name=twitterConsumerSecret]').val(doc.config.twitter_config.settings.consumerSecret);
        
        //set Google Values
        $('[name=googleEnabledSelect]').val(doc.config.google_config.enabled+'');
        $('[name=googleClientID]').val(doc.config.google_config.settings.clientID);
        $('[name=googleClientSecret]').val(doc.config.google_config.settings.clientSecret);
        
    });
  
    //listen for submit button
    $('#submitBtn').on('click', function() {
        $('form').first().submit();
    });

    // save config on submit
    $('.form-horizontal').submit(function (ev) {
        ev.preventDefault();
        var cfg = {
           facebook_config: {
               enabled: ($('[name=facebookEnabledSelect]').val() == 'true'),
               settings: {
                   clientID: $('[name=facebookClientID]').val(),
                   clientSecret: $('[name=facebookClientSecret]').val()
               }
           },
           twitter_config: {
               enabled: ($('[name=twitterEnabledSelect]').val() == 'true'),
               settings: {
                   consumerKey: $('[name=twitterConsumerKey]').val(),
                   consumerSecret: $('[name=twitterConsumerSecret]').val()
               }
           },
           google_config: {
               enabled: ($('[name=googleEnabledSelect]').val() == 'true'),
               settings: {
                   clientID: $('[name=googleClientID]').val(),
                   clientSecret: $('[name=googleClientSecret]').val()
               }
           }
        };
        updateConfig(cfg, function (err) {
            if (err) {
                return alert(err);
            }
            else {
                alert('Config saved');
            }
        });
        return false;
    });

});
