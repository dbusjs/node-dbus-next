const Buffer = require('safe-buffer').Buffer;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const constants = require('./constants');
const readLine = require('./readline');

function sha1 (input) {
  const shasum = crypto.createHash('sha1');
  shasum.update(input);
  return shasum.digest('hex');
}

function getUserHome () {
  return process.env[process.platform.match(/$win/) ? 'USERPROFILE' : 'HOME'];
}

function getCookie (context, id, cb) {
  // http://dbus.freedesktop.org/doc/dbus-specification.html#auth-mechanisms-sha
  const dirname = path.join(getUserHome(), '.dbus-keyrings');
  // > There is a default context, "org_freedesktop_general" that's used by servers that do not specify otherwise.
  if (context.length === 0) context = 'org_freedesktop_general';

  const filename = path.join(dirname, context);
  // check it's not writable by others and readable by user
  fs.stat(dirname, function (err, stat) {
    if (err) return cb(err);
    if (stat.mode & 0o22) {
      return cb(
        new Error(
          'User keyrings directory is writeable by other users. Aborting authentication'
        )
      );
    }
    if ('getuid' in process && stat.uid !== process.getuid()) {
      return cb(
        new Error(
          'Keyrings directory is not owned by the current user. Aborting authentication!'
        )
      );
    }
    fs.readFile(filename, 'ascii', function (err, keyrings) {
      if (err) return cb(err);
      const lines = keyrings.split('\n');
      for (let l = 0; l < lines.length; ++l) {
        const data = lines[l].split(' ');
        if (id === data[0]) return cb(null, data[2]);
      }
      return cb(new Error('cookie not found'));
    });
  });
}

function hexlify (input) {
  return Buffer.from(input.toString(), 'ascii').toString('hex');
}

module.exports = function auth (stream, opts, cb) {
  // filter used to make a copy so we don't accidently change opts data
  let authMethods;
  if (opts.authMethods) {
    authMethods = opts.authMethods;
  } else {
    authMethods = constants.defaultAuthMethods;
  }
  stream.write('\0');
  tryAuth(stream, authMethods.slice(), cb);
};

function tryAuth (stream, methods, cb) {
  if (methods.length === 0) {
    return cb(new Error('No authentication methods left to try'));
  }

  const authMethod = methods.shift();
  const uid = 'getuid' in process ? process.getuid() : 0;
  const id = hexlify(uid);

  let guid = '';
  function beginOrNextAuth () {
    readLine(stream, function (line) {
      const ok = line.toString('ascii').match(/^([A-Za-z]+) (.*)/);
      if (ok && ok[1] === 'OK') {
        guid = ok[2]; // ok[2] = guid. Do we need it?
        if (stream.supportsUnixFd) {
          negotiateUnixFd();
        } else {
          stream.write('BEGIN\r\n');
          return cb(null, guid);
        }
      } else {
        // TODO: parse error!
        if (!methods.empty) {
          tryAuth(stream, methods, cb);
        } else {
          return cb(line);
        }
      }
    });
  }
  function negotiateUnixFd () {
    stream.write('NEGOTIATE_UNIX_FD\r\n');
    readLine(stream, function (line) {
      const res = line.toString('ascii').trim();
      if (res === 'AGREE_UNIX_FD') {
        // ok
      } else if (res === 'ERROR') {
        stream.supportsUnixFd = false;
      } else {
        return cb(line);
      }
      stream.write('BEGIN\r\n');
      return cb(null, guid);
    });
  }

  switch (authMethod) {
    case 'EXTERNAL':
      stream.write(`AUTH ${authMethod} ${id}\r\n`);
      beginOrNextAuth();
      break;
    case 'DBUS_COOKIE_SHA1':
      stream.write(`AUTH ${authMethod} ${id}\r\n`);
      readLine(stream, function (line) {
        const data = Buffer.from(
          line
            .toString()
            .split(' ')[1]
            .trim(),
          'hex'
        )
          .toString()
          .split(' ');
        const cookieContext = data[0];
        const cookieId = data[1];
        const serverChallenge = data[2];
        // any random 16 bytes should work, sha1(rnd) to make it simplier
        const clientChallenge = crypto.randomBytes(16).toString('hex');
        getCookie(cookieContext, cookieId, function (err, cookie) {
          if (err) return cb(err);
          const response = sha1(
            [serverChallenge, clientChallenge, cookie].join(':')
          );
          const reply = hexlify(clientChallenge + response);
          stream.write(`DATA ${reply}\r\n`);
          beginOrNextAuth();
        });
      });
      break;
    case 'ANONYMOUS':
      stream.write('AUTH ANONYMOUS \r\n');
      beginOrNextAuth();
      break;
    default:
      console.error(`Unsupported auth method: ${authMethod}`);
      beginOrNextAuth();
      break;
  }
}
