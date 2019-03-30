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

class Bus {
  constructor(conn) {
    this.connection = conn;
    this.serial = 1;
    this.cookies = {}; // TODO: rename to methodReturnHandlers
    this.signals = new EventEmitter();
    this.exportedObjects = {};
    this._names = {};
    this.nameOwners = {};

    let handleMessage = (msg) => {
      if (msg.type === constants.messageType.methodReturn ||
        msg.type === constants.messageType.error) {
        let handler = this.cookies[msg.replySerial];
        if (handler) {
          delete this.cookies[msg.replySerial];
          let props = {
            connection: this.connection,
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
            this.nameOwners[name] = newOwner;
          }
        }

        this.signals.emit(this.mangle(msg), msg);
      } else {
        // methodCall
        if (!handleMethod(msg, this)) {
          this.sendError(msg,
            'org.freedesktop.DBus.Error.UnknownMethod',
            `Method '${msg.member}' on interface '${msg.interface}' does not exist`);
        }
      }
    };

    conn.on('message', (msg) => {
      try {
        handleMessage(msg);
      } catch (e) {
        this.sendError(msg, 'com.github.dbus_next.Error', `The DBus library encountered an error.\n${e.stack}`);
      }
    });

    this.invokeDbus({ member: 'Hello' }, (err, name) => {
      if (err) {
        throw new Error(err);
      }
      this.name = name;
    });
  }

  invoke(msg, callback) {
    if (!msg.type) {
      msg.type = constants.messageType.methodCall;
    }
    msg.serial = this.serial++;
    this.cookies[msg.serial] = callback;
    this.connection.message(msg);
  };

  invokeDbus(msg, callback) {
    if (!msg.path) {
      msg.path = '/org/freedesktop/DBus';
    }
    if (!msg.destination) {
      msg.destination = 'org.freedesktop.DBus';
    }
    if (!msg['interface']) {
      msg['interface'] = 'org.freedesktop.DBus';
    }
    this.invoke(msg, callback);
  };

  mangle(msg) {
    return JSON.stringify({
      path: msg.path,
      'interface': msg['interface'],
      member: msg.member
    });
  };

  sendSignal(path, iface, name, signature, args) {
    let msg = {
      type: constants.messageType.signal,
      serial: this.serial++,
      interface: iface,
      path: path,
      member: name
    };
    if (signature) {
      msg.signature = signature;
      msg.body = args;
    }
    this.connection.message(msg);
  };

  // Warning: errorName must respect the same rules as interface names (must contain a dot)
  sendError(msg, errorName, errorText) {
    this.connection.message({
      type: constants.messageType.error,
      serial: this.serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      errorName: errorName,
      signature: 's',
      body: [errorText]
    });
  };

  sendReply(msg, signature, body) {
    this.connection.message({
      type: constants.messageType.methodReturn,
      serial: this.serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      signature: signature,
      body: body
    });
  };

  getProxyObject(name, path) {
    let obj = new ProxyObject(this, name, path);
    return obj._init();
  };

  addMatch(match, callback) {
    this.invokeDbus(
      { member: 'AddMatch', signature: 's', body: [match] },
      callback
    );
  };

  requestName(name, flags) {
    flags = flags || 0;
    return new Promise((resolve, reject) => {
      assertBusNameValid(name);
      let dbusRequest = {
        member: 'RequestName',
        signature: 'su',
        body: [name, flags]
      };
      this.invokeDbus(dbusRequest, (err, result) => {
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

  getNameOwner(name) {
    return new Promise((resolve, reject) => {
      let msg = {
        member: 'GetNameOwner',
        signature: 's',
        body: [name]
      };
      this.invokeDbus(msg, (err, owner) => {
        if (err) {
          return reject(err);
        }
        this.nameOwners[name] = owner;
        return resolve(owner);
      });
    });
  }
};

module.exports = Bus;
