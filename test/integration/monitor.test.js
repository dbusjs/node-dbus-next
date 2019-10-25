let dbus = require('../../');
let Message = dbus.Message;
let {
  SIGNAL
} = dbus.MessageType;

let monitor = dbus.sessionBus();
let bus1 = dbus.sessionBus();
let bus2 = dbus.sessionBus();

bus1.on('error', (err) => {
  console.log(`bus1 got unexpected connection error:\n${err.stack}`);
});
bus2.on('error', (err) => {
  console.log(`bus2 got unexpected connection error:\n${err.stack}`);
});
monitor.on('error', (err) => {
  console.log(`monitor bus got unexpected connection error:\n${err.stack}`);
});

beforeAll(async () => {
  let connect = [bus1, bus2, monitor].map((bus) => {
    return new Promise((resolve) => {
      bus.on('connect', resolve);
    });
  });

  await Promise.all(connect);

  await monitor.call(new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus.Monitoring',
    member: 'BecomeMonitor',
    signature: 'asu',
    body: [[`sender=${bus1.name}`, `sender=${bus2.name}`], 0]
  }));
});

afterAll(() => {
  bus1.disconnect();
  bus2.disconnect();
  monitor.disconnect();
});

async function waitForMessage(bus) {
  return new Promise((resolve) => {
    bus.once('message', (msg) => {
      resolve(msg);
    });
  });
}

test('monitor a signal', async () => {
  let signal = Message.newSignal('/org/test/path', 'org.test.interface', 'SomeSignal', 's', ['a signal']);
  bus1.send(signal);
  let msg = await waitForMessage(monitor);
  expect(msg.type).toEqual(SIGNAL);
  expect(msg.sender).toEqual(bus1.name);
  expect(msg.serial).toEqual(signal.serial)
});

test('monitor a method call', async () => {
  let messages = [];
  let monitorHandler = function(message) {
    messages.push(message);
  };
  monitor.on('message', monitorHandler);

  let messageHandler = function(sent) {
    bus1.send(Message.newMethodReturn(sent, 's', ['got it']));
    return true;
  };

  bus1.addMethodHandler(messageHandler);

  await bus2.call(new Message({
    destination: bus1.name,
    path: '/org/test/path',
    interface: 'org.test.interface',
    member: 'TestMethod',
    signature: 's',
    body: ['hello']
  }));

  expect(messages.length).toEqual(2);
  expect(messages[0].sender).toEqual(bus2.name);
  expect(messages[1].sender).toEqual(bus1.name);
  monitor.removeListener('message', monitorHandler);
});
