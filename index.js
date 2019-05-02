const constants = require('./lib/constants');
const MessageBus = require('./lib/bus');
const errors = require('./lib/errors');
const {Variant} = require('./lib//variant');
const {Message} = require('./lib/message-type.js');
const iface = require('./lib/service/interface');
const createConnection = require('./lib/connection.js');

let createClient = function(params) {
  let connection = createConnection(params || {});
  return new MessageBus(connection);
};

/**
 * Create a new {@link MessageBus} client on a manually defined bus to connect to
 * interfaces or request service names. Connects to the socket specified by the
 * properties assigned.
 */
module.exports.createClient = createClient;
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
 * An enum value for the {@link Message} `type` member to indicate the message
 * is a method call.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_TYPE_METHOD_CALL
 */
module.exports.MESSAGE_TYPE_METHOD_CALL = constants.messageType.METHOD_CALL;

/**
 * An enum value for the {@link Message} `type` member to indicate the message
 * is a method return.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_TYPE_METHOD_RETURN
 */
module.exports.MESSAGE_TYPE_METHOD_RETURN = constants.messageType.METHOD_RETURN;

/**
 * An enum value for the {@link Message} `type` member to indicate the message
 * is a signal.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_TYPE_SIGNAL
 */
module.exports.MESSAGE_TYPE_SIGNAL = constants.messageType.SIGNAL;

/**
 * An enum value for the {@link Message} `type` member to indicate the message
 * is an error reply.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_TYPE_ERROR
 */
module.exports.MESSAGE_TYPE_ERROR = constants.messageType.ERROR;

/**
 * A flag for the {@link Message} `flags` member to indicate no reply is
 * expected from this message.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_FLAG_NO_REPLY_EXPECTED
 */
module.exports.MESSAGE_FLAG_NO_REPLY_EXPECTED = constants.flags.noReplyExpected;

/**
 * A flag for the {@link Message} `flags` member to indicate this message
 * should not autostart a service.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 * @constant MESSAGE_FLAG_NO_AUTO_START
 */
module.exports.MESSAGE_FLAG_NO_AUTO_START = constants.flags.noAutoStart;

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
module.exports.Variant = Variant;
module.exports.Message = Message;
module.exports.validators = require('./lib/validators');
module.exports.DBusError = errors.DBusError;
module.exports.NameExistsError = errors.NameExistsError;
