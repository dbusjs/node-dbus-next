const EventEmitter = require('events').EventEmitter;
const net = require('net');

const constants = require('./lib/constants');
const message = require('./lib/message');
const clientHandshake = require('./lib/handshake');
const MessageBus = require('./lib/bus');
const {getDbusAddressFromFs} = require('./lib/address-x11');
const errors = require('./lib/errors');
const variant = require('./lib/service/variant');
const iface = require('./lib/service/interface');

function createStream(opts) {
  let { busAddress } = opts;

  // XXX according to the dbus spec, we should start a new server if the bus
  // address cannot be found.
  if (!busAddress) {
    busAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
  }
  if (!busAddress) {
    busAddress = getDbusAddressFromFs();
  }

  let addresses = busAddress.split(';');
  for (let i = 0; i < addresses.length; ++i) {
    let address = addresses[i];
    let familyParams = address.split(':');
    let family = familyParams[0];
    let params = {};
    familyParams[1].split(',').map(function(p) {
      let keyVal = p.split('=');
      params[keyVal[0]] = keyVal[1];
    });

    try {
      switch (family.toLowerCase()) {
        case 'tcp':
          throw new Error('tcp dbus connections are not supported');
        case 'unix':
          if (params.socket) {
            return net.createConnection(params.socket);
          }
          if (params.abstract) {
            let abs = require('abstract-socket');
            return abs.connect('\u0000' + params.abstract);
          }
          if (params.path) {
            return net.createConnection(params.path);
          }
          throw new Error(
            "not enough parameters for 'unix' connection - you need to specify 'socket' or 'abstract' or 'path' parameter"
          );
        case 'unixexec':
          let eventStream = require('event-stream');
          let spawn = require('child_process').spawn;
          let args = [];
          for (let n = 1; params['arg' + n]; n++) args.push(params['arg' + n]);
          let child = spawn(params.path, args);

          return eventStream.duplex(child.stdin, child.stdout);
        default:
          throw new Error('unknown address type:' + family);
      }
    } catch (e) {
      if (i < addresses.length - 1) {
        console.warn(e.message);
        continue;
      } else {
        throw e;
      }
    }
  }
}

function createConnection(opts) {
  let self = new EventEmitter();
  opts = opts || {};
  let stream = (self.stream = createStream(opts));
  stream.setNoDelay();

  stream.on('error', function(err) {
    // forward network and stream errors
    self.emit('error', err);
  });

  stream.on('end', function() {
    self.emit('end');
    self.message = function() {
      self.emit('error', new Error('Tried to write a message to a closed stream'));
    };
  });

  self.end = function() {
    stream.end();
    return self;
  };

  clientHandshake(stream, opts, function(error, guid) {
    if (error) {
      return self.emit('error', error);
    }
    self.guid = guid;
    self.emit('connect');
    message.unmarshalMessages(
      stream,
      function(message) {
        self.emit('message', message);
      },
      opts
    );
  });

  self._messages = [];

  // pre-connect version, buffers all messages. replaced after connect
  self.message = function(msg) {
    self._messages.push(msg);
  };

  self.once('connect', function() {
    self.state = 'connected';
    for (let i = 0; i < self._messages.length; ++i) {
      stream.write(message.marshall(self._messages[i]));
    }
    self._messages.length = 0;

    // no need to buffer once connected
    self.message = function(msg) {
      stream.write(message.marshall(msg));
    };
  });

  return self;
}

let createClient = function(params) {
  let connection = createConnection(params || {});
  return new MessageBus(connection);
};

/**
 * Create a new {@link MessageBus} client on the DBus system bus to connect to
 * interfaces or request service names. Connects to the socket specified by the
 * `DBUS_SYSTEM_BUS_ADDRESS` environment variable or
 * `unix:path=/var/run/dbus/system_bus_socket`.
 *
 */
module.exports.systemBus = function() {
  return createClient({
    busAddress:
      process.env.DBUS_SYSTEM_BUS_ADDRESS ||
      'unix:path=/var/run/dbus/system_bus_socket'
  });
};

/**
 * Create a new {@link MessageBus} client on the DBus session bus to connect to
 * interfaces or request service names.
 *
 * @param {object} [options] - Options for `MessageBus` creation.
 * @param {object} [options.busAddress] - The socket path for the session bus.
 * Defaults to finding the bus address in the manner specified in the DBus
 * specification. The bus address will first be read from the
 * `DBUS_SESSION_BUS_ADDRESS` environment variable and when that is not
 * available, found from the `$HOME/.dbus` directory.
 */
module.exports.sessionBus = function(opts) {
  return createClient(opts);
};

/**
 * A flag for {@link MessageBus#requestName} to indicate this name allows other
 * clients to replace it as the name owner on request.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
 * @constant DBUS_NAME_FLAG_ALLOW_REPLACEMENT
 */
module.exports.DBUS_NAME_FLAG_ALLOW_REPLACEMENT = constants.DBUS_NAME_FLAG_ALLOW_REPLACEMENT;

/**
 * A flag for {@link MessageBus#requestName} to indicate this request should
 * replace an existing name if that name allows replacement.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
 * @constant DBUS_NAME_FLAG_REPLACE_EXISTING
 */
module.exports.DBUS_NAME_FLAG_REPLACE_EXISTING = constants.DBUS_NAME_FLAG_REPLACE_EXISTING;

/**
 * A flag for {@link MessageBus#requestName} to indicate this request should
 * not enter the queue of clients requesting this name if it is taken. The
 * request may fail with {@link NameExistsError} in this case.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
 * @constant DBUS_NAME_FLAG_DO_NOT_QUEUE
 */
module.exports.DBUS_NAME_FLAG_DO_NOT_QUEUE = constants.DBUS_NAME_FLAG_DO_NOT_QUEUE;

/**
 * Use JSBI as a polyfill for long integer types ('x' and 't') in the client
 * and the service. This is required for Node verisons that do not support the
 * native `BigInt` class which is used by default for these types (version <
 * 10.8.0).
 *
 * @function
 * @param {boolean} compat - pass `true` to use JSBI.
 */
module.exports.setBigIntCompat = require('./lib/library-options').setBigIntCompat
module.exports.interface = iface;
module.exports.Variant = variant.Variant;
module.exports.validators = require('./lib/validators');
module.exports.DBusError = errors.DBusError;
module.exports.NameExistsError = errors.NameExistsError;
