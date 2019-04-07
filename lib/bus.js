const EventEmitter = require('events').EventEmitter;
const constants = require('./constants');
const handleMethod = require('./service/handlers');
const { NameExistsError } = require('./errors');
const Name = require('./service/name');

let {
  assertBusNameValid,
  assertObjectPathValid,
  assertInterfaceNameValid,
} = require('./validators');

let ProxyObject = require('./client/proxy-object');
let { Interface } = require('./service/interface');

/**
 * @class
 * The `MessageBus` is a class for interacting with a DBus message bus capable
 * of requesting a service [`Name`]{@link module:interface~Name} to export an
 * [`Interface`]{@link module:interface~Interface}, or getting a proxy object
 * to interact with an existing name on the bus as a client. A `MessageBus` is
 * created with `dbus.sessionBus()` or `dbus.systemBus()` methods of the
 * dbus-next module.
 *
 * The `MessageBus` is an `EventEmitter` which may receive an `error` event
 * with the underlying connection error as the argument. After receiving an
 * `error` event, the `MessageBus` may be disconnected.
 *
 * @example
 * const dbus = require('dbus-next');
 * const bus = dbus.sessionBus();
 * // get a proxy object
 * let obj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
 * // request a service name
 * let name = await bus.requestName('org.test.name');
 */
class MessageBus extends EventEmitter {
  /**
   * Create a new `MessageBus`. This constructor is not to be called directly.
   * Use `dbus.sessionBus()` or `dbus.systemBus()` to set up the connection to
    * the bus.
   */
  constructor(conn) {
    super();
    this._connection = conn;
    this._serial = 1;
    this._methodReturnHandlers = {};
    this._signals = new EventEmitter();
    this._names = {};
    this._nameOwners = {};
    /**
     * The unique name of the bus connection. This will be `null` until the
     * `MessageBus` is connected.
     * @memberof MessageBus#
     * @member {string} name
     */
    this.name = null;

    let handleMessage = (msg) => {
      if (msg.type === constants.messageType.methodReturn ||
        msg.type === constants.messageType.error) {
        let handler = this._methodReturnHandlers[msg.replySerial];
        if (handler) {
          delete this._methodReturnHandlers[msg.replySerial];
          let props = {
            connection: this._connection,
            bus: this,
            message: msg,
            signature: msg.signature
          };
          let args = msg.body || [];
          if (msg.type === constants.messageType.methodReturn) {
            args = [null].concat(args); // first argument - no errors, null
            handler.apply(props, args); // body as array of arguments
          } else {
            handler.call(props, args); // body as first argument
          }
        }
      } else if (msg.type === constants.messageType.signal) {
        // if this is a name owner changed message, cache the new name owner
        let {sender, path, iface, member} = msg;
        if (sender === 'org.freedesktop.DBus' &&
          path === '/org/freedesktop/DBus' &&
          iface === 'org.freedesktop.DBus' &&
          member === 'NameOwnerChanged') {
          let [name, oldOwner, newOwner] = msg.body;
          if (!name.startsWith(':')) {
            this._nameOwners[name] = newOwner;
          }
        }

        let mangled = JSON.stringify({
          path: msg.path,
          'interface': msg['interface'],
          member: msg.member
        });
        this._signals.emit(mangled, msg);
      } else {
        // methodCall
        if (!handleMethod(msg, this)) {
          this._sendError(msg,
            'org.freedesktop.DBus.Error.UnknownMethod',
            `Method '${msg.member}' on interface '${msg.interface}' does not exist`);
        }
      }
    };

    conn.on('message', (msg) => {
      try {
        handleMessage(msg);
      } catch (e) {
        this._sendError(msg, 'com.github.dbus_next.Error', `The DBus library encountered an error.\n${e.stack}`);
      }
    });

    conn.on('error', (err) => {
      // forward network and stream errors
      this.emit('error', err);
    });

    let helloMessage = {
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'Hello'
    };
    this._sendMethodCall(helloMessage, (err, name) => {
      if (err) {
        this.emit('error', err);
        throw new Error(err);
      }
      this.name = name;
    });
  }

  /**
   * Get a `ProxyObject` on the bus for the given name and path for interacting
   * with a service as a client. The proxy object contains a list of the
   * `ProxyInterface`s exported at the name and object path as well as a list
   * of `node`s.
   *
   * @param name {string} - the well-known name on the bus.
   * @param path {string} - the object path exported on the name.
   * @returns {Promise} - a Promise that resolves with the `ProxyObject`.
   */
  getProxyObject(name, path) {
    let obj = new ProxyObject(this, name, path);
    return obj._init();
  };

  /**
   * Request a well-known [`Name`]{@link module:interface~Name} on the bus. The
   * `Name` can be used to export an [`Interface`]{@link
   * module:interface~Interface} at an object path on the name. If the name is
   * already taken and {@link DBUS_NAME_FLAG_DO_NOT_QUEUE} is given, the method
   * may throw a {@link NameExistsError}. See {@link
   * DBUS_NAME_FLAG_ALLOW_REPLACEMENT} and {@link
   * DBUS_NAME_FLAG_REPLACE_EXISTING} for more information on the other name
   * flags.
   * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
   *
   * @param name {string} - the well-known name on the bus to request.
   * @param flags {NameFlags} - DBus name flags which affect the behavior of taking the name.
   * @returns {Promise} - a Promise that resolves with the [`Name`]{@link
   * module:interface~Name}.
   */
  requestName(name, flags) {
    flags = flags || 0;
    return new Promise((resolve, reject) => {
      assertBusNameValid(name);
      let msg = {
        path: '/org/freedesktop/DBus',
        destination: 'org.freedesktop.DBus',
        interface: 'org.freedesktop.DBus',
        member: 'RequestName',
        signature: 'su',
        body: [name, flags]
      };
      this._sendMethodCall(msg, (err, result) => {
        if (err) {
          return reject(err);
        }
        if (result === constants.DBUS_REQUEST_NAME_REPLY_EXISTS) {
          return reject(new NameExistsError(`the name already exists: ${name}`));
        }
        if (this._names[name]) {
          let nameObj = this._names[name];
          nameObj.flags = flags;
          return resolve(nameObj);
        }
        let nameObj = new Name(this, name, flags);
        this._names[name] = nameObj;
        return resolve(nameObj);
      }
      );
    });
  };

  /**
   * Disconnect this `MessageBus` from the bus.
   */
  disconnect() {
    this._connection.stream.end();
  }

  _sendMethodCall(msg, callback) {
    if (!msg.type) {
      msg.type = constants.messageType.methodCall;
    }
    msg.serial = this._serial++;
    this._methodReturnHandlers[msg.serial] = callback;
    this._connection.message(msg);
  };

  _sendSignal(path, iface, name, signature, args) {
    let msg = {
      type: constants.messageType.signal,
      serial: this._serial++,
      interface: iface,
      path: path,
      member: name
    };
    if (signature) {
      msg.signature = signature;
      msg.body = args;
    }
    this._connection.message(msg);
  };

  // Warning: errorName must respect the same rules as interface names (must contain a dot)
  _sendError(msg, errorName, errorText) {
    this._connection.message({
      type: constants.messageType.error,
      serial: this._serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      errorName: errorName,
      signature: 's',
      body: [errorText]
    });
  };

  _sendReply(msg, signature, body) {
    this._connection.message({
      type: constants.messageType.methodReturn,
      serial: this._serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      signature: signature,
      body: body
    });
  };

  _addMatch(match, callback) {
    let msg = {
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'AddMatch',
      signature: 's',
      body: [match]
    };
    this._sendMethodCall(msg, callback);
  };

  _getNameOwner(name) {
    return new Promise((resolve, reject) => {
      let msg = {
        path: '/org/freedesktop/DBus',
        destination: 'org.freedesktop.DBus',
        interface: 'org.freedesktop.DBus',
        member: 'GetNameOwner',
        signature: 's',
        body: [name]
      };
      this._sendMethodCall(msg, (err, owner) => {
        if (err) {
          return reject(err);
        }
        this._nameOwners[name] = owner;
        return resolve(owner);
      });
    });
  }
};

module.exports = MessageBus;
