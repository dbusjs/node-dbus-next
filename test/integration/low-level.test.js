let dbus = require('../../');
let {Message} = require('../../lib/message-type');
let {
  METHOD_CALL,
  METHOD_RETURN,
  SIGNAL,
  ERROR
} = require('../../lib/constants').messageType;

let bus1 = dbus.sessionBus();
let bus2 = dbus.sessionBus();

bus1.on('error', (err) => {
  console.log(`bus1 got unexpected connection error:\n${err.stack}`);
});
bus2.on('error', (err) => {
  console.log(`bus2 got unexpected connection error:\n${err.stack}`);
});

beforeAll(async () => {
  let connect = [bus1, bus2].map((bus) => {
    return new Promise((resolve) => {
      bus.on('connect', resolve);
    });
  });

  await Promise.all(connect);
});

afterAll(() => {
  bus1.disconnect();
  bus2.disconnect();
});

test('send a method call between buses', async () => {
  let msg = new Message({
    destination: bus1.name,
    path: '/org/test/path',
    interface: 'org.test.iface',
    member: 'SomeMember'
  });

  let methodReturnHandler = function(sent) {
    if (sent.serial === msg.serial) {
      expect(sent.path).toEqual(msg.path);
      expect(sent.serial).toEqual(msg.serial);
      expect(sent.interface).toEqual(msg.interface);
      expect(sent.member).toEqual(msg.member);

      bus1._send(Message.newMethodReturn(sent, 's', ['got it']));
      bus1._removeMethodHandler(methodReturnHandler);
      return true;
    }
    return false;
  }
  bus1._addMethodHandler(methodReturnHandler);
  expect(bus1._methodHandlers.length).toEqual(1);

  const reply = await bus2._call(msg);

  expect(bus1._methodHandlers.length).toEqual(0);
  expect(reply.type).toEqual(METHOD_RETURN);
  expect(reply.sender).toEqual(bus1.name);
  expect(reply.signature).toEqual('s');
  expect(reply.body).toEqual(['got it']);
  expect(reply.replySerial).toEqual(msg.serial);

  let errorReturnHandler = function(sent) {
    if (sent.serial === msg.serial) {
      expect(sent.type).toEqual(METHOD_CALL);
      expect(sent.path).toEqual(msg.path);
      expect(sent.serial).toEqual(msg.serial);
      expect(sent.interface).toEqual(msg.interface);
      expect(sent.member).toEqual(msg.member);

      bus1._send(Message.newError(sent, 'org.test.Error', 'throwing an error'));
      bus1._removeMethodHandler(errorReturnHandler);
      return true;
    }
    return false;
  }

  bus1._addMethodHandler(errorReturnHandler);
  let error = null;
  try {
    // sending the same message twice should reset the serial
    await bus2._call(msg);
  } catch(e) {
    error = e;
  }

  expect(error).not.toBeNull();
  expect(error.reply).toBeInstanceOf(Message);
  expect(error.reply.type).toEqual(ERROR);
  expect(error.reply.sender).toEqual(bus1.name);
  expect(error.reply.errorName).toEqual('org.test.Error');
  expect(error.reply.signature).toEqual('s');
  expect(error.reply.replySerial).toEqual(msg.serial);
  expect(error.reply.body).toEqual(['throwing an error']);

  expect(error.type).toEqual('org.test.Error');
  expect(error.message).toEqual('throwing an error');
});

test('send a signal between buses', async () => {
  let addMatchMessage = new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus',
    member: 'AddMatch',
    signature: 's',
    body: [`sender='${bus2.name}'`]
  });
  await bus1._call(addMatchMessage)

  let waitForMessage = new Promise((resolve) => {
    bus1.on('message', (msg) => {
      if (msg.sender === bus2.name) {
        resolve(msg);
      }
    });
  });

  bus2._send(Message.newSignal('/org/test/path', 'org.test.interface', 'SomeSignal', 's', ['a signal']));
  let signal = await waitForMessage;

  expect(signal.type).toEqual(SIGNAL);
  expect(signal.path).toEqual('/org/test/path');
  expect(signal.interface).toEqual('org.test.interface');
  expect(signal.member).toEqual('SomeSignal');
  expect(signal.signature).toEqual('s');
  expect(signal.body).toEqual(['a signal']);
});
