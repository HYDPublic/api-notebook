/* global App */
var _               = App._;
var ramlParser      = require('raml-parser');
var authenticate    = require('./authenticate');
var clientGenerator = require('./client-generator');
var fromPath        = require('../../lib/from-path');

/**
 * Implementation helpers.
 */
require('./inject-api-keys');
require('./insert-api-client');

/**
 * Provided a special documentation property for functionsw with another plugin.
 *
 * @type {String}
 */
var DESCRIPTION_PROPERTY = '!description';

/**
 * Custom file reader for RAML specs.
 *
 * @param  {String}  url
 * @return {Q.defer}
 */
var createReader = function (config) {
  return new ramlParser.FileReader(function (url) {
    var deferred = this.q.defer();

    App.middleware.trigger('ajax', {
      url: url,
      proxy: config.proxy,
      headers: {
        'Accept': 'application/raml+yaml, */*'
      }
    }, function (err, xhr) {
      if (err) {
        return deferred.reject(err);
      }

      if (Math.floor(xhr.status / 100) !== 2) {
        return deferred.reject(
          new Error('Received status code ' + xhr.status + ' loading ' + url)
        );
      }

      return deferred.resolve(xhr.responseText);
    });

    return deferred.promise;
  });
};

/**
 * The Api object is used in the execution context.
 *
 * @type {Object}
 */
var API = {};

/**
 * Responsible for loading RAML documents and return API clients.
 *
 * @param {String}   name
 * @param {String}   [url]
 * @param {Function} done
 */
API.createClient = function (name, url, config, done) {
  if (!_.isString(name)) {
    throw new Error('Provide a name for the generated client');
  }

  if (!_.isString(url)) {
    throw new Error('Provide a URL for the ' + name + ' RAML document');
  }

  // Allow the config object to be skipped.
  if (typeof config === 'function') {
    done   = arguments[2];
    config = {};
  }

  App._executeContext.timeout(Infinity);
  done   = done   || App._executeContext.async();
  config = config || {};

  // Pass our url to the RAML parser for processing and transform the promise
  // back into a callback format.
  ramlParser.loadFile(url, {
    reader: createReader(config)
  }).then(function (data) {
    var client;

    try {
      client = clientGenerator(data, config);
      fromPath(App._executeWindow, name.split('.'), client);
    } catch (e) {
      return done(e);
    }

    return done(
      null,
      'Create a new code cell and type \'' + name + '.\' ' +
      'to explore this API.'
    );
  }, done);
};

/**
 * Description of the create client function.
 */
API.createClient[DESCRIPTION_PROPERTY] = {
  '!type': 'fn(' + [
    'alias: string',
    'url: string',
    'config?: { proxy: string }',
    'cb?: fn(error, client)'
  ].join(', ') + ')',
  '!doc': [
    'Generate an API client from a RAML document and alias it on the window.'
  ].join(' ')
};

/**
 * Set a configuration value on a client.
 *
 * @param {Function} client
 * @param {String}   key
 * @param {*}        value
 */
API.set = function (client, key, value) {
  // If we don't have enough arguments for a key and value, assume we have
  // a fresh configuration object.
  if (arguments.length < 3) {
    return _.extend(client['!config'], key);
  }

  return client['!config'][key] = value;
};

/**
 * Set the description of the API client configuration setter.
 */
API.set[DESCRIPTION_PROPERTY] = {
  '!type': 'fn(client: function, key: string, value)',
  '!doc': 'Set a configuration option of a RAML API client.'
};

/**
 * Retrieve a value from the client config object.
 *
 * @param  {Function} client
 * @param  {String}   key
 * @return {*}
 */
API.get = function (client, key) {
  if (arguments.length < 2) {
    return client['!config'];
  }

  return client['!config'][key];
};

/**
 * Set the description of the API client configuration getter.
 */
API.get[DESCRIPTION_PROPERTY] = {
  '!type': 'fn(client: function, key: string)',
  '!doc': 'Get a configuration option from a RAML API client.'
};

/**
 * Unset a key from the client configuration.
 *
 * @param  {Function} client
 * @param  {String}   key
 * @return {Boolean}
 */
API.unset = function (client, key) {
  if (arguments.length < 2) {
    _.each(client['!config'], function (value, key, obj) {
      delete obj[key];
    });

    return true;
  }

  return delete client['!config'][key];
};

/**
 * Set the description of the API client configuration unsetter.
 */
API.unset[DESCRIPTION_PROPERTY] = {
  '!type': 'fn(client: function, key: string)',
  '!doc': 'Unset a configuration option from a RAML API client.'
};

/**
 * Authenticate a RAML API client passing an optional method and accompanying
 * options object.
 *
 * @param {Function} client
 * @param {String}   method
 * @param {Object}   options
 * @param {Function} done
 */
API.authenticate = function (client, method, options, done) {
  App._executeContext.timeout(10 * 60 * 1000);
  done = done || App._executeContext.async();

  var clientOption    = client['!client'];
  var securedBy       = clientOption.securedBy;
  var securitySchemes = clientOption.securitySchemes;

  /**
   * The callback is used to handle the persistence of data to the client.
   *
   * @param  {Error}    err
   * @param  {Object}   scheme
   * @param  {Object}   options
   * @param  {Object}   tokens
   * @return {Function}
   */
  var cb = function (err, scheme, options, tokens) {
    if (err) {
      return done(err);
    }

    clientOption.authentication[scheme.type] = _.extend(options, tokens);
    return done(null, tokens);
  };

  return authenticate(securedBy, securitySchemes, method, options, cb);
};

/**
 * Set the description of the API client authenticator.
 */
API.authenticate[DESCRIPTION_PROPERTY] = {
  '!type': [
    'fn(client: function, method?: string, options?: object, cb?: function)'
  ].join(''),
  '!doc': [
    'Authentication parameters are optional. For popular APIs, we provide',
    'keys. If we need your keys we will prompt you via a modal. Never enter',
    'keys directly into a notebook unless you explicitly intend to share',
    'them. If you would like to know more about authenticating',
    'with this API, see \'securityScheme.settings\' in the RAML file.'
  ].join(' ')
};

/**
 * Alter the context to include the RAML client generator.
 *
 * @param {Object}   data
 * @param {Function} next
 */
var contextPlugin = function (context, next) {
  // This is extremely janky, but is required for Safari 7.0 which seems to
  // be ignoring direct property assignments under certain conditions.
  Object.defineProperty(context, 'API', { value: API });
  return next();
};

/**
 * A { key: function } map of all middleware used in the plugin.
 *
 * @type {Object}
 */
module.exports = {
  'sandbox:context': contextPlugin
};
