const Buffer = require('safe-buffer').Buffer;
const marshall = require('./marshall');
const constants = require('./constants');
const DBusBuffer = require('./dbus-buffer');

const headerSignature = require('./header-signature.json');

module.exports.unmarshalMessages = function messageParser (
  stream,
  onMessage,
  opts
) {
  let state = 0; // 0: header, 1: fields + body
  let header, fieldsAndBody;
  let fieldsLength, fieldsLengthPadded;
  let fieldsAndBodyLength = 0;
  let bodyLength = 0;
  let endian = 0;
  const LE = constants.endianness.le;
  stream.on('readable', function () {
    while (1) {
      if (state === 0) {
        header = stream.read(16);
        if (!header) {
          break;
        }
        state = 1;

        endian = header.readUInt8(0);

        fieldsLength = (endian === LE ? header.readUInt32LE(12) : header.readUInt32BE(12));
        fieldsLengthPadded = ((fieldsLength + 7) >> 3) << 3;
        bodyLength = (endian === LE ? header.readUInt32LE(4) : header.readUInt32BE(4));
        fieldsAndBodyLength = fieldsLengthPadded + bodyLength;
      } else {
        const readBuf = stream.read(fieldsAndBodyLength, null);
        // usockets return object with { data, fds }
        fieldsAndBody = readBuf ? readBuf.data || readBuf : readBuf;
        if (!fieldsAndBody) {
          break;
        }
        state = 0;

        const messageBuffer = new DBusBuffer(fieldsAndBody, 0, endian, readBuf.fds, opts);
        const unmarshalledHeader = messageBuffer.readArray(
          headerSignature[0].child[0],
          fieldsLength
        );
        messageBuffer.align(3);
        let headerName;
        const message = {};
        message.serial = (endian === LE ? header.readUInt32LE(8) : header.readUInt32BE(8));

        for (let i = 0; i < unmarshalledHeader.length; ++i) {
          headerName = constants.headerTypeName[unmarshalledHeader[i][0]];
          message[headerName] = unmarshalledHeader[i][1][1][0];
        }

        message.type = header[1];
        message.flags = header[2];

        if (bodyLength > 0 && message.signature) {
          message.body = messageBuffer.read(message.signature);
        }
        onMessage(message);
      }
    }
  });
};

// given buffer which contains entire message deserialise it
// TODO: factor out common code
module.exports.unmarshall = function unmarshall (buff, opts) {
  const endian = buff.readUInt8();
  const msgBuf = new DBusBuffer(buff, 0, endian, null, opts);
  const headers = msgBuf.read('yyyyuua(yv)');
  const message = {};
  for (let i = 0; i < headers[6].length; ++i) {
    const headerName = constants.headerTypeName[headers[6][i][0]];
    message[headerName] = headers[6][i][1][1][0];
  }
  message.type = headers[1];
  message.flags = headers[2];
  message.serial = headers[5];
  msgBuf.align(3);
  message.body = msgBuf.read(message.signature);
  return message;
};

module.exports.marshall = function marshallMessage (message) {
  if (!message.serial) throw new Error('Missing or invalid serial');
  const flags = message.flags || 0;
  const type = message.type || constants.messageType.METHOD_CALL;
  let bodyLength = 0;
  let bodyBuff;
  const fds = [];
  if (message.signature && message.body) {
    bodyBuff = marshall(message.signature, message.body, 0, fds);
    bodyLength = bodyBuff.length;
    message.unixFd = fds.length;
  }
  const header = [
    constants.endianness.le,
    type,
    flags,
    constants.protocolVersion,
    bodyLength,
    message.serial
  ];
  const headerBuff = marshall('yyyyuu', header);
  const fields = [];
  constants.headerTypeName.forEach(function (fieldName) {
    const fieldVal = message[fieldName];
    if (fieldVal) {
      fields.push([
        constants.headerTypeId[fieldName],
        [constants.fieldSignature[fieldName], fieldVal]
      ]);
    }
  });
  const fieldsBuff = marshall('a(yv)', [fields], 12);
  const headerLenAligned =
    ((headerBuff.length + fieldsBuff.length + 7) >> 3) << 3;
  const messageLen = headerLenAligned + bodyLength;
  const messageBuff = Buffer.alloc(messageLen);
  headerBuff.copy(messageBuff);
  fieldsBuff.copy(messageBuff, headerBuff.length);
  if (bodyLength > 0) bodyBuff.copy(messageBuff, headerLenAligned);

  return [messageBuff, fds];
};
