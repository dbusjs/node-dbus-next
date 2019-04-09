const {
  assertBusNameValid,
  assertInterfaceNameValid,
  assertObjectPathValid,
  assertMemberNameValid
} = require('./validators');
const {
  ERROR,
  METHOD_CALL,
  METHOD_RETURN,
  SIGNAL
} = require('./constants').messageType;

// https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
class Message {
  constructor(msg) {
    this.type = (msg.type ? msg.type : METHOD_CALL);
    this._sent = false;
    this._serial = (isNaN(msg.serial) ? null : msg.serial);
    this.path = msg.path;
    this.interface = msg.interface;
    this.member = msg.member;
    this.errorName = msg.errorName;
    this.replySerial = msg.replySerial;
    this.destination = msg.destination;
    this.sender = msg.sender;
    this.signature = msg.signature || '';
    this.body = msg.body || [];
    this.flags = msg.flags || 0;

    if (this.destination) {
      assertBusNameValid(this.destination);
    }

    if (this.interface) {
      assertInterfaceNameValid(this.interface);
    }

    if (this.path) {
      assertObjectPathValid(this.path);
    }

    if (this.member) {
      assertMemberNameValid(this.member);
    }

    if (this.errorName) {
      assertInterfaceNameValid(this.errorName);
    }

    let requireFields = (...fields) => {
      for (let field of fields) {
        if (this[field] === undefined) {
          throw new Error(`Message is missing a required field: ${field}`);
        }
      }
    }

    // validate required fields
    switch (this.type) {
      case METHOD_CALL:
        requireFields('path', 'member');
        break;
      case SIGNAL:
        requireFields('path', 'member', 'interface');
        break;
      case ERROR:
        requireFields('errorName', 'replySerial');
        break;
      case METHOD_RETURN:
        requireFields('replySerial');
        break;
      default:
        throw new Error(`Got unknown message type: ${this.type}`);
        break;
    }
  }

  get serial() {
    return this._serial;
  }

  set serial(value) {
    this._sent = false;
    this._serial = value;
  }

  static newError(msg, errorName, errorText='An error occurred.') {
    assertInterfaceNameValid(errorName);
    return new Message({
      type: ERROR,
      replySerial: msg.serial,
      destination: msg.sender,
      errorName: errorName,
      signature: 's',
      body: [errorText]
    });
  }

  static newMethodReturn(msg, signature='', body=[]) {
    return new Message({
      type: METHOD_RETURN,
      replySerial: msg.serial,
      destination: msg.sender,
      signature: signature,
      body: body
    });
  }

  static newSignal(path, iface, name, signature='', body=[]) {
    return new Message({
      type: SIGNAL,
      interface: iface,
      path: path,
      member: name,
      signature: signature,
      body: body
    });
  }
}

module.exports = {
  Message: Message
};
