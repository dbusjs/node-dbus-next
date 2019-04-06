const EventEmitter = require('events').EventEmitter;
const net = require('net');
const message = require('./message');
const clientHandshake = require('./handshake');
const {getDbusAddressFromFs} = require('./address-x11');
const {parseSignature, collapseSignature} = require('./signature');
const {Variant} = require('./variant');

function valueIsMarshallVariant(value) {
  // used for the marshaller variant type
  return Array.isArray(value) && value.length === 2 && Array.isArray(value[0]) && value[0].length > 0 && value[0][0].type;
}

function marshallVariantToJs(variant) {
  // XXX The marshaller uses a different body format than what the connection
  // is expected to emit. These two formats should be unified.
  // parses a single complete variant in marshall format
  let type = variant[0][0];
  let value = variant[1][0];

  if (!type.child.length) {
    if (valueIsMarshallVariant(value)) {
      return new Variant(collapseSignature(value[0][0]), marshallVariantToJs(value));
    } else {
      return value;
    }
  }

  if (type.type === 'a') {
    if (type.child[0].type === '{') {
      // this is an array of dictionary entries
      let result = {};
      for (let i = 0; i < value.length; ++i) {
        // dictionary keys must have basic types
        result[value[i][0]] = marshallVariantToJs([[type.child[0].child[1]], [value[i][1]]]);
      }
      return result;
    } else {
      // other arrays only have one type
      let result = [];
      for (let i = 0; i < value.length; ++i) {
        result[i] = marshallVariantToJs([[type.child[0]], [value[i]]]);
      }
      return result;
    }
  } else if (type.type === '(') {
    // structs have types equal to the number of children
    let result = [];
    for (let i = 0; i < value.length; ++i) {
      result[i] = marshallVariantToJs([[type.child[i]], [value[i]]]);
    }
    return result;
  }
}

function messageToJsFmt(message) {
  // XXX The marshaller uses a different body format than what the connection
  // is expected to emit. These two formats should be unified.
  let {signature='', body=[]} = message;
  let bodyJs = [];
  let signatureTree = parseSignature(signature);
  for (let i = 0; i < signatureTree.length; ++i) {
    let tree = signatureTree[i];
    bodyJs.push(marshallVariantToJs([[tree], [body[i]]]));
  }

  message.body = bodyJs;
  message.signature = signature;
  return message;
}

function jsToMarshalFmt(signature, value) {
  // XXX The connection accepts a message body in plain js format and converts
  // it to the marshaller format for writing. These two formats should be
  // unified.
  if (value === undefined) {
    throw new Error(`expected value for signature: ${signature}`);
  }
  if (signature === undefined) {
    throw new Error(`expected signature for value: ${value}`);
  }

  let signatureStr = null;
  if (typeof signature === 'string') {
    signatureStr = signature;
    signature = parseSignature(signature)[0];
  } else {
    signatureStr = collapseSignature(signature);
  }

  if (signature.child.length === 0) {
    if (signature.type === 'v') {
      if (value.constructor !== Variant) {
        throw new Error(`expected a Variant for value (got ${typeof value})`);
      }
      return [ signature.type, jsToMarshalFmt(value.signature, value.value) ];
    } else {
      return [ signature.type, value ];
    }
  }

  if (signature.type === 'a') {
    let result = [];
    if (signature.child[0].type === '{') {
      // this is an array of dictionary elements
      if (value.constructor !== Object) {
        throw new Error(`expecting an object for signature '${signatureStr}' (got ${typeof value})`);
      }
      for (let k of Object.keys(value)) {
        let v = value[k];
        if (v.constructor === Variant) {
          result.push([k, jsToMarshalFmt(v.signature, v.value)]);
        } else {
          result.push([k, jsToMarshalFmt(signature.child[0].child[1], v)[1]]);
        }
      }
    } else {
      if (!Array.isArray(value)) {
        throw new Error(`expecting an array for signature '${signatureStr}' (got ${typeof value})`);
      }
      for (let v of value) {
        if (v.constructor === Variant) {
          result.push(jsToMarshalFmt(v.signature, v.value));
        } else {
          result.push(jsToMarshalFmt(signature.child[0], v)[1]);
        }
      }
    }
    return [ signatureStr, result ];
  } else if (signature.type === '(') {
    if (!Array.isArray(value)) {
      throw new Error(`expecting an array for signature '${signatureStr}' (got ${typeof value})`);
    }
    if (value.length !== signature.child.length) {
      throw new Error(`expecting struct to have ${signature.child.length} members (got ${value.length} members)`);
    }
    let result = [];
    for (let i = 0; i < value.length; ++i) {
      let v = value[i];
      if (signature.child[i] === 'v') {
        if (v.constructor !== Variant) {
          throw new Error(`expected a Variant for struct member ${i+1} (got ${v})`);
        }
        result.push(jsToMarshalFmt(v.signature, v.value));
      } else {
        result.push(jsToMarshalFmt(signature.child[i], v)[1]);;
      }
    }
    return [ signatureStr, result ];
  } else {
    throw new Error(`got unknown complex type: ${signature.type}`);
  }
}

function marshallMessage(msg) {
  // XXX The connection accepts a message body in plain js format and converts
  // it to the marshaller format for writing. These two formats should be
  // unified.
  let {signature='', body=[]} = msg;

  let signatureTree = parseSignature(signature);

  if (signatureTree.length !== body.length) {
    throw new Error(`Expected ${signatureTree.length} body elements for signature '${signature}' (got ${body.length})`);
  }

  let marshallerBody = [];
  for (let i = 0; i < body.length; ++i) {
    if (signatureTree[i].type === 'v') {
      if (body[i].constructor !== Variant) {
        throw new Error(`Expected a Variant() argument for position ${i+1} (value='${body[i]}')`);
      }
      marshallerBody.push(jsToMarshalFmt(body[i].signature, body[i].value));
    } else {
      marshallerBody.push(jsToMarshalFmt(signatureTree[i], body[i])[1]);
    }
  }

  msg.signature = signature;
  msg.body = marshallerBody;
  return message.marshall(msg);
}

function createStream(opts) {
  let { busAddress } = opts;

  // TODO according to the dbus spec, we should start a new server if the bus
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
        self.emit('message', messageToJsFmt(message));
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
      stream.write(marshallMessage(self._messages[i]));
    }
    self._messages.length = 0;

    // no need to buffer once connected
    self.message = function(msg) {
      stream.write(marshallMessage(msg));
    };
  });

  return self;
}

module.exports = createConnection;
