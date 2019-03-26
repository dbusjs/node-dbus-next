const variant = require('./variant');
const Variant = variant.Variant;
let {
  isObjectPathValid,
  isInterfaceNameValid,
  isMemberNameValid
} = require('../validators');

const {
  ACCESS_READ,
  ACCESS_WRITE,
  ACCESS_READWRITE
} = require('./interface');

const { DBusError } = require('../errors');

const INVALID_ARGS = 'org.freedesktop.DBus.Error.InvalidArgs';

function sendServiceError(bus, msg, errorMessage) {
  bus.sendError(msg, 'com.github.dbus_next.ServiceError', `Service error: ${errorMessage}`);
  return true;
}

function handleIntrospect(bus, msg, name, path) {
  bus.sendReply(msg, 's', [name.introspect(path)]);
}

function handleGetProperty(bus, msg, name, path) {
  let [ifaceName, prop] = msg.body;
  let obj = name.getObject(path);
  let iface = obj.interfaces[ifaceName];
  // TODO An empty string may be provided for the interface name; in this case,
  // if there are multiple properties on an object with the same name, the
  // results are undefined (picking one by according to an arbitrary
  // deterministic rule, or returning an error, are the reasonable
  // possibilities).
  if (!iface) {
    bus.sendError(msg, INVALID_ARGS, `No such interface: '${ifaceName}'`);
    return;
  }

  let properties = iface.$properties || {};

  let options = null;
  let propertyKey = null;
  for (const k of Object.keys(properties)) {
    if (properties[k].name === prop && !properties[k].disabled) {
      options = properties[k];
      propertyKey = k;
      break;
    }
  }
  if (options === null) {
    bus.sendError(msg, INVALID_ARGS, `No such property: '${prop}'`);
    return;
  }

  let propertyValue = null

  try {
    propertyValue = iface[propertyKey];
  } catch (e) {
    if (e.name === 'DBusError') {
      bus.sendError(msg, e.type, e.text);
    } else {
      sendServiceError(bus, msg, `The service threw an error.\n${e.stack}`);
    }
    return true;
  }

  if (propertyValue instanceof DBusError) {
    bus.sendError(msg, propertyValue.type, propertyValue.text);
    return true;
  } else if (propertyValue === undefined) {
    return sendServiceError(bus, msg, 'tried to get a property that is not set: ' + prop);
  }

  if (!(options.access === ACCESS_READWRITE ||
      options.access === ACCESS_READ)) {
    bus.sendError(msg, INVALID_ARGS, `Property does not have read access: '${prop}'`);
  }

  let body = variant.jsToMarshalFmt(options.signature, propertyValue);

  bus.sendReply(msg, 'v', [body]);
}

function handleGetAllProperties(bus, msg, name, path) {
  let ifaceName = msg.body[0];

  let obj = name.getObject(path);
  let iface = obj.interfaces[ifaceName];

  let result = {};
  if (iface) {
    let properties = iface.$properties || {};
    for (let k of Object.keys(properties)) {
      let p = properties[k];
      if (!(p.access === ACCESS_READ || p.access === ACCESS_READWRITE) || p.disabled) {
        continue;
      }

      let value = undefined;
      try {
        value = iface[k];
      } catch (e) {
        if (e.name === 'DBusError') {
          bus.sendError(msg, e.type, e.text);
        } else {
          sendServiceError(bus, msg, `The service threw an error.\n${e.stack}`);
        }
        return true;
      }
      if (value instanceof DBusError) {
        bus.sendError(msg, value.type, value.text);
        return true;
      } else if (value === undefined) {
        return sendServiceError(bus, msg, 'tried to get a property that is not set: ' + p);
      }

      result[p.name] = new Variant(p.signature, value);
    }
  }

  let body = variant.jsToMarshalFmt('a{sv}', result)[1];
  bus.sendReply(msg, 'a{sv}', [body]);
}

function handleSetProperty(bus, msg, name, path) {
  let [ifaceName, prop, value] = msg.body;

  let obj = name.getObject(path);
  let iface = obj.interfaces[ifaceName];

  if (!iface) {
    bus.sendError(msg, INVALID_ARGS, `Interface not found: '${ifaceName}'`);
    return;
  }

  let properties = iface.$properties || {};
  let options = null;
  let propertyKey = null;
  for (const k of Object.keys(properties)) {
    if (properties[k].name === prop && !properties[k].disabled) {
      options = properties[k];
      propertyKey = k;
      break;
    }
  }

  if (options === null) {
    bus.sendError(msg, INVALID_ARGS, `No such property: '${prop}'`);
    return;
  }

  if (!(options.access === ACCESS_WRITE || options.access === ACCESS_READWRITE)) {
    bus.sendError(msg, INVALID_ARGS, `Property does not have write access: '${prop}'`);
  }

  let valueSignature = variant.collapseSignature(value[0][0])
  if (valueSignature !== options.signature) {
    bus.sendError(msg, INVALID_ARGS, `Cannot set property '${prop}' with signature '${valueSignature}' (expected '${options.signature}')`);
    return;
  }

  try {
    iface[propertyKey] = variant.parse(value);
  } catch (e) {
    if (e.name === 'DBusError') {
      bus.sendError(msg, e.type, e.text);
    } else {
      sendServiceError(bus, msg, `The service threw an error.\n${e.stack}`);
    }
    return true;
  }

  bus.sendReply(msg, '', []);
}

function handleStdIfaces(bus, msg, name) {
  let {
    member,
    path,
    signature
  } = msg;

  let ifaceName = msg.interface;

  if (!isInterfaceNameValid(ifaceName)) {
    bus.sendError(msg, INVALID_ARGS, `Invalid interface name: '${ifaceName}'`);
    return true;
  }

  if (!isMemberNameValid(member)) {
    bus.sendError(msg, INVALID_ARGS, `Invalid member name: '${member}'`);
    return true;
  }

  if (!isObjectPathValid(path)) {
    bus.sendError(msg, INVALID_ARGS, `Invalid path name: '${path}'`);
    return true;
  }

  if (ifaceName === 'org.freedesktop.DBus.Introspectable' &&
        member === 'Introspect' &&
        !signature) {
    handleIntrospect(bus, msg, name, path);
    return true;
  } else if (ifaceName === 'org.freedesktop.DBus.Properties') {
    if (member === 'Get' && signature === 'ss') {
      handleGetProperty(bus, msg, name, path);
      return true;
    } else if (member === 'Set' && signature === 'ssv') {
      handleSetProperty(bus, msg, name, path);
      return true;
    } else if (member === 'GetAll') {
      handleGetAllProperties(bus, msg, name, path);
      return true;
    }
  }

  return false;
}

function handleMessage(msg, bus) {
  let {
    path,
    member,
    destination,
    signature
  } = msg;

  let ifaceName = msg.interface;

  signature = signature || '';

  if (Object.keys(bus._names) === 0) {
    // no names registered
    return false;
  }

  let name = bus._names[destination];

  if (!name) {
    if (destination[0] === ':') {
      // TODO: they didn't include a name as the destination, but the
      // address of the server (d-feet does this). not sure how to handle
      // this with multiple names. Just pick the first one until we figure it
      // out.
      name = bus._names[Object.keys(bus._names)[0]];

      if (!name) {
        return false;
      }
    }
  }

  if (handleStdIfaces(bus, msg, name)) {
    return true;
  }

  let obj = name.getObject(path);
  let iface = obj.interfaces[ifaceName];

  if (!iface) {
    return false;
  }

  let methods = iface.$methods || {};
  for (let m of Object.keys(methods)) {
    let method = methods[m];
    if (method.name === member && method.inSignature === signature) {
      let args = [];
      for (let i = 0; i < method.inSignatureTree.length; ++i) {
        let bodyArg = msg.body[i];
        let bodyArgSignature = method.inSignatureTree[i];
        args.push(variant.parse([[bodyArgSignature], [bodyArg]]));
      }
      let result = null;
      try {
        result = method.fn.apply(iface, args);
      } catch (e) {
        if (e.name === 'DBusError') {
          bus.sendError(msg, e.type, e.text);
        } else {
          sendServiceError(bus, msg, `The service threw an error.\n${e.stack}`);
        }
        return true;
      }
      if (result === undefined) {
        result = [];
      } else if (method.outSignatureTree.length === 1) {
        result = [result];
      } else if (method.outSignatureTree.length === 0) {
        return sendServiceError(bus, msg, `method ${iface.$name}.${method.name} was not expected to return a result.`);
      } else if (!Array.isArray(result)) {
        return sendServiceError(bus, msg, `method ${iface.$name}.${method.name} expected to return multiple arguments in an array (signature: '${method.outSignature}')`);
      }

      if (method.outSignatureTree.length !== result.length) {
        return sendServiceError(bus, msg, `method ${iface.$name}.${m} returned the wrong number of arguments (got ${result.length} expected ${method.outSignatureTree.length}) for signature '${method.outSignature}'`);
      }

      let body = [];

      for (let i = 0; i < result.length; ++i) {
        if (method.outSignatureTree[i].type === 'v') {
          if (result[i].constructor !== Variant) {
            return sendServiceError(bus, msg, `signal ${iface.$name} expected a Variant() argument for arg ${i+1}`);
          }
          body.push(variant.jsToMarshalFmt(result[i].signature, result[i].value));
        } else {
          body.push(variant.jsToMarshalFmt(method.outSignatureTree[i], result[i])[1]);
        }
      }
      bus.sendReply(msg, method.outSignature, body);
      return true;
    }
  }

  return false;
};

module.exports = function(msg, bus) {
  try {
    return handleMessage(msg, bus);
  } catch (e) {
    bus.sendError(msg, 'com.github.dbus_next.Error', `The DBus library encountered an error.\n${e.stack}`);
    return true;
  }
};
