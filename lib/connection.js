const EventEmitter = require('events').EventEmitter;
const net = require('net');
const message = require('./message');
const clientHandshake = require('./handshake');
const { getDbusAddressFromFs } = require('./address-x11');
const { Message } = require('./message-type');
const { messageToJsFmt, marshallMessage } = require('./marshall-compat');

function createStream (opts) {
  let { busAddress, negotiateUnixFd } = opts;

  if (negotiateUnixFd === undefined) {
    negotiateUnixFd = false;
  }

  // TODO according to the dbus spec, we should start a new server if the bus
  // address cannot be found.
  if (!busAddress) {
    busAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
  }
  if (!busAddress) {
    busAddress = getDbusAddressFromFs();
  }

  const addresses = busAddress.split(';');
  for (let i = 0; i < addresses.length; ++i) {
    const address = addresses[i];
    const familyParams = address.split(':');
    const family = familyParams[0];
    const params = {};
    familyParams[1].split(',').forEach(function (p) {
      const keyVal = p.split('=');
      params[keyVal[0]] = keyVal[1];
    });

    try {
      switch (family.toLowerCase()) {
        case 'tcp': {
          const host = params.host || 'localhost';
          const port = params.port;
          return net.createConnection(port, host);
        }
        case 'unix': {
          if (params.socket) {
            return net.createConnection(params.socket);
          }
          if (params.abstract) {
            const usocket = require('usocket');
            const sock = new usocket.USocket({ path: '\u0000' + params.abstract });
            sock.supportsUnixFd = negotiateUnixFd;
            return sock;
          }
          if (params.path) {
            try {
              const usocket = require('usocket');
              const sock = new usocket.USocket({ path: params.path });
              sock.supportsUnixFd = negotiateUnixFd;
              return sock;
            } catch (err) {
              // TODO: maybe emit warning?
              return net.createConnection(params.path);
            }
          }
          throw new Error(
            "not enough parameters for 'unix' connection - you need to specify 'socket' or 'abstract' or 'path' parameter"
          );
        }
        case 'unixexec': {
          const eventStream = require('event-stream');
          const spawn = require('child_process').spawn;
          const args = [];
          for (let n = 1; params['arg' + n]; n++) args.push(params['arg' + n]);
          const child = spawn(params.path, args);
          // duplex socket is auto connected so emit connect event next frame
          setTimeout(() => eventStream.emit('connected'), 0);

          return eventStream.duplex(child.stdin, child.stdout);
        }
        default: {
          throw new Error('unknown address type:' + family);
        }
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

function createConnection (opts) {
  const self = new EventEmitter();
  opts = opts || {};
  const stream = (self.stream = createStream(opts));
  stream.setNoDelay && stream.setNoDelay();

  stream.on('error', function (err) {
    // forward network and stream errors
    self.emit('error', err);
  });

  stream.on('end', function () {
    self.emit('end');
    self.message = function () {
      self.emit('error', new Error('Tried to write a message to a closed stream'));
    };
  });

  self.end = function () {
    stream.end();
    return self;
  };

  function afterHandshake (error, guid) {
    if (error) {
      return self.emit('error', error);
    }
    self.guid = guid;
    self.emit('connect');
    message.unmarshalMessages(
      stream,
      function (message) {
        try {
          message = new Message(messageToJsFmt(message));
        } catch (err) {
          self.emit('error', err, `There was an error receiving a message (this is probably a bug in dbus-next): ${message}`);
          return;
        }
        self.emit('message', message);
      },
      opts
    );
  }
  stream.once('connect', () => clientHandshake(stream, opts, afterHandshake));
  stream.once('connected', () => clientHandshake(stream, opts, afterHandshake));

  self._messages = [];

  // pre-connect version, buffers all messages. replaced after connect
  self.message = function (msg) {
    self._messages.push(msg);
  };

  self.once('connect', function () {
    self.state = 'connected';
    for (let i = 0; i < self._messages.length; ++i) {
      const [data, fds] = marshallMessage(self._messages[i]);
      if (stream.supportsUnixFd) {
        stream.write({ data, fds });
      } else {
        stream.write(data);
      }
    }
    self._messages.length = 0;

    // no need to buffer once connected
    self.message = function (msg) {
      if (!stream.writable) {
        throw new Error('Cannot send message, stream is closed');
      }
      const [data, fds] = marshallMessage(msg);
      if (stream.supportsUnixFd) {
        stream.write({ data, fds });
      } else {
        if (fds.length > 0) {
          console.warn('Sending file descriptors is not supported in current bus connection');
        }
        stream.write(data);
      }
    };
  });

  return self;
}

module.exports = createConnection;
