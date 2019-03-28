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

module.exports = function bus(conn) {
  if (!(this instanceof bus)) {
    return new bus(conn);
  }

  let self = this;
  this.connection = conn;
  this.serial = 1;
  this.cookies = {}; // TODO: rename to methodReturnHandlers
  this.signals = new EventEmitter();
  this.exportedObjects = {};
  this._names = {};
  this.nameOwners = {};

  this._handleNameOwnerChanged = function(msg) {
    let {sender, path, iface, member} = msg;
    if (sender !== 'org.freedesktop.DBus' ||
          path !== '/org/freedesktop/DBus' ||
          iface !== 'org.freedesktop.DBus' ||
          member !== 'NameOwnerChanged') {
      return;
    }
    let [name, oldOwner, newOwner] = msg.body;
    if (name.startsWith(':')) {
      return;
    }
    this.nameOwners[name] = newOwner;
  };

  this.invoke = function(msg, callback) {
    if (!msg.type) {
      msg.type = constants.messageType.methodCall;
    }
    msg.serial = self.serial++;
    this.cookies[msg.serial] = callback;
    self.connection.message(msg);
  };

  this.invokeDbus = function(msg, callback) {
    if (!msg.path) {
      msg.path = '/org/freedesktop/DBus';
    }
    if (!msg.destination) {
      msg.destination = 'org.freedesktop.DBus';
    }
    if (!msg['interface']) {
      msg['interface'] = 'org.freedesktop.DBus';
    }
    self.invoke(msg, callback);
  };

  this.mangle = function(msg) {
    return JSON.stringify({
      path: msg.path,
      'interface': msg['interface'],
      member: msg.member
    });
  };

  this.sendSignal = function(path, iface, name, signature, args) {
    let signalMsg = {
      type: constants.messageType.signal,
      serial: self.serial++,
      interface: iface,
      path: path,
      member: name
    };
    if (signature) {
      signalMsg.signature = signature;
      signalMsg.body = args;
    }
    self.connection.message(signalMsg);
  };

  // Warning: errorName must respect the same rules as interface names (must contain a dot)
  this.sendError = function(msg, errorName, errorText) {
    let reply = {
      type: constants.messageType.error,
      serial: self.serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      errorName: errorName,
      signature: 's',
      body: [errorText]
    };
    this.connection.message(reply);
  };

  this.sendReply = function(msg, signature, body) {
    let reply = {
      type: constants.messageType.methodReturn,
      serial: self.serial++,
      replySerial: msg.serial,
      destination: msg.sender,
      signature: signature,
      body: body
    };
    this.connection.message(reply);
  };

  // route reply/error
  this.connection.on('message', function(msg) {
    if (msg.type === constants.messageType.methodReturn ||
        msg.type === constants.messageType.error) {
      let handler = self.cookies[msg.replySerial];
      if (handler) {
        delete self.cookies[msg.replySerial];
        let props = {
          connection: self.connection,
          bus: self,
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
      self._handleNameOwnerChanged(msg);
      self.signals.emit(self.mangle(msg), msg);
    } else {
      // methodCall
      if (!handleMethod(msg, self)) {
        self.sendError(msg,
          'org.freedesktop.DBus.Error.UnknownMethod',
          `Method '${msg.member}' on interface '${msg.interface}' does not exist`);
      }
    }
  });

  this.getProxyObject = function(name, path) {
    let obj = new ProxyObject(this, name, path);
    return obj._init();
  };

  this.invokeDbus({ member: 'Hello' }, function(err, name) {
    if (err) {
      throw new Error(err);
    }
    self.name = name;
  });

  this.addMatch = function(match, callback) {
    this.invokeDbus(
      { member: 'AddMatch', signature: 's', body: [match] },
      callback
    );
  };

  this.requestName = function(name, flags) {
    let that = this;
    flags = flags || 0;
    return new Promise((resolve, reject) => {
      assertBusNameValid(name);
      let dbusRequest = {
        member: 'RequestName',
        signature: 'su',
        body: [name, flags]
      };
      that.invokeDbus(dbusRequest, function(err, result) {
        if (err) {
          return reject(err);
        }
        if (result === constants.DBUS_REQUEST_NAME_REPLY_EXISTS) {
          return reject(new NameExistsError(`the name already exists: ${name}`));
        }
        if (that._names[name]) {
          let nameObj = that._names[name];
          nameObj.flags = flags;
          return resolve(nameObj);
        }
        let nameObj = new Name(that, name, flags);
        that._names[name] = nameObj;
        return resolve(nameObj);
      }
      );
    });
  };

  this.getNameOwner = function(name, callback) {
    this.invokeDbus(
      { member: 'GetNameOwner', signature: 's', body: [name] },
      callback
    );
  };

  this.cacheNameOwner = function(name) {
    let that = this;
    return new Promise((resolve, reject) => {
      this.getNameOwner(name, function(err, owner) {
        if (err) {
          return reject(err);
        }
        that.nameOwners[name] = owner;
        return resolve(owner);
      });
    });
  }
};
