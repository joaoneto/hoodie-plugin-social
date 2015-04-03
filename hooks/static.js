var appName = 'appback-social-example';
var ports = require('ports');
var port = ports.getPort(appName + '-hoodie-plugin-social');

module.exports = {
  // 'server.pack.post': function (pack) {
  //    console.log('hook: server.pack.pre called');
  // },

  // 'server.pack.pre': function (pack) {
  //   console.log('hook: server.pack.pre called');
    
  //   pack.register({
  //     name: 'social',
  //     version: '0.10.10',
  //     register: function (plugin, options, next) {
  //       plugin.route({
  //         method: '*',
  //         path: '/_auth/{p*}',
  //         handler: {
  //             proxy: {
  //                 host: '127.0.0.1',
  //                 port: port,
  //                 protocol: 'http'
  //             }
  //         });
  //       next();
  //     },
  //     // options: { message: 'hello' }
  //   }, function (err) {
  //     if (err) {
  //       console.log('Failed loading plugin');
  //     }
  //   });
  // }
};
