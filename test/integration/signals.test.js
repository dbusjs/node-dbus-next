// Test that signals emit correctly

const dbus = require('../../');
const { waitForMessage } = require('../util');

const Variant = dbus.Variant;

const {
  Interface, method, signal
} = dbus.interface;

const TEST_NAME = 'org.test.signals';
const TEST_NAME2 = 'org.test.signals_name2';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const TEST_XML = `
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect">
      <arg name="data" direction="out" type="s"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.Peer">
    <method name="GetMachineId">
      <arg direction="out" name="machine_uuid" type="s"/>
    </method>
    <method name="Ping"/>
  </interface>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get">
      <arg direction="in" type="s"/>
      <arg direction="in" type="s"/>
      <arg direction="out" type="v"/>
    </method>
    <method name="Set">
      <arg direction="in" type="s"/>
      <arg direction="in" type="s"/>
      <arg direction="in" type="v"/>
    </method>
    <method name="GetAll">
      <arg direction="in" type="s"/>
      <arg direction="out" type="a{sv}"/>
    </method>
    <signal name="PropertiesChanged">
      <arg type="s"/>
      <arg type="a{sv}"/>
      <arg type="as"/>
    </signal>
  </interface>
  <interface name="org.test.iface">
    <method name="EmitSignals"/>
    <signal name="HelloWorld">
      <arg type="s"/>
    </signal>
    <signal name="SignalMultiple">
      <arg type="s"/>
      <arg type="s"/>
    </signal>
    <signal name="SignalComplicated">
      <arg type="v"/>
    </signal>
  </interface>
</node>
`;

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});
const bus2 = dbus.sessionBus();
bus2.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

class SignalsInterface extends Interface {
  @signal({ signature: 's' })
  HelloWorld (value) {
    return value;
  }

  @signal({ signature: 'ss' })
  SignalMultiple () {
    return [
      'hello',
      'world'
    ];
  }

  // a really complicated variant
  complicated = new Variant('a{sv}', {
    foo: new Variant('s', 'bar'),
    bar: new Variant('d', 53),
    bat: new Variant('v', new Variant('as', ['foo', 'bar', 'bat'])),
    baz: new Variant('(doodoo)', [1, '/', '/', 1, '/', '/']),
    fiz: new Variant('(as(s(v)))', [
      ['one', 'two'],
      ['three', [
        new Variant('as', ['four', 'five'])]
      ]
    ]),
    buz: new Variant('av', [
      new Variant('as', ['foo']),
      new Variant('a{ss}', { foo: 'bar' }),
      new Variant('v', new Variant('(asas)', [['bar'], ['foo']])),
      new Variant('v', new Variant('v', new Variant('as', ['one', 'two']))),
      new Variant('a{ss}', { foo: 'bar' })
    ])
  });

  @signal({ signature: 'v' })
  SignalComplicated () {
    return this.complicated;
  }

  @method({ inSignature: '', outSignature: '' })
  EmitSignals () {
    this.HelloWorld('hello');
    this.SignalMultiple();
    this.SignalComplicated();
  }
}

const testIface = new SignalsInterface(TEST_IFACE);
const testIface2 = new SignalsInterface(TEST_IFACE);

async function createTestService(name) {
  const testBus = dbus.sessionBus();
  const testIface = new SignalsInterface(TEST_IFACE);

  await testBus.requestName(name);
  testBus.export(TEST_PATH, testIface);

  return [testBus, testIface];
}

beforeAll(async () => {
  await Promise.all([
    bus.requestName(TEST_NAME),
    bus2.requestName(TEST_NAME2)
  ]);
  bus.export(TEST_PATH, testIface);
  bus2.export(TEST_PATH, testIface2);
});

afterAll(() => {
  bus.disconnect();
  bus2.disconnect();
});

test('test that signals work correctly', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const test = object.getInterface(TEST_IFACE);

  const onHelloWorld = jest.fn();
  const onSignalMultiple = jest.fn();
  const onSignalMultiple2 = jest.fn();
  const onSignalComplicated = jest.fn();

  test.once('HelloWorld', onHelloWorld);
  test.on('SignalMultiple', onSignalMultiple);
  test.on('SignalMultiple', onSignalMultiple2);
  test.on('SignalComplicated', onSignalComplicated);

  await test.EmitSignals();

  expect(onHelloWorld).toHaveBeenCalledWith('hello');
  expect(onSignalMultiple).toHaveBeenCalledWith('hello', 'world');
  expect(onSignalMultiple2).toHaveBeenCalledWith('hello', 'world');
  expect(onSignalComplicated).toHaveBeenCalledWith(testIface.complicated);

  // removing the event listener on the interface should remove the event
  // listener on the bus as well
  expect(bus._signals.eventNames().length).toEqual(2);
  test.removeListener('SignalMultiple', onSignalMultiple);
  expect(bus._signals.eventNames().length).toEqual(2);

  // removing the listener on a signal should not remove them all
  onSignalMultiple2.mockClear();
  await test.EmitSignals();
  expect(onSignalMultiple2).toHaveBeenCalledWith('hello', 'world');

  test.removeListener('SignalMultiple', onSignalMultiple2);
  expect(bus._signals.eventNames().length).toEqual(1);
  test.removeListener('SignalComplicated', onSignalComplicated);
  expect(bus._signals.eventNames().length).toEqual(0);
});

test('signals dont get mixed up between names that define objects on the same path and interface', async () => {
  // Note that there is a really bad case where a single connection takes two
  // names and exports the same interfaces and paths on them. Then there is no
  // way to tell the signals apart from the names because the messages look
  // identical to us. All we get is the unique name of the sender and not the
  // well known name, and the well known name is what will be different. For
  // this reason, I am going to recommend that people only use one name per bus
  // connection until we can figure that out.
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const object2 = await bus.getProxyObject(TEST_NAME2, TEST_PATH);

  const test = object.getInterface(TEST_IFACE);
  const test2 = object2.getInterface(TEST_IFACE);

  const cb = jest.fn();
  const cb2 = jest.fn();

  test.on('HelloWorld', cb);
  test.on('SignalMultiple', cb);
  test.on('SignalComplicated', cb);

  test2.on('HelloWorld', cb2);
  test2.on('SignalMultiple', cb2);
  test2.on('SignalComplicated', cb2);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(3);
  expect(cb2).toHaveBeenCalledTimes(0);
});

test('regression #64: adding multiple listeners to a signal', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const test = object.getInterface(TEST_IFACE);

  const cb = jest.fn();
  const cb2 = jest.fn();
  const cb3 = jest.fn();

  test.on('HelloWorld', cb);
  test.on('HelloWorld', cb2);
  test.on('HelloWorld', cb3);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(1);

  test.removeListener('HelloWorld', cb);
  test.removeListener('HelloWorld', cb2);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(2);

  test.removeListener('HelloWorld', cb3);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(2);
});

test('bug #86: signals dont get lost when no previous method calls have been made', async () => {
  // clear the name owners cache from previous tests
  bus._nameOwners = {};

  // when providing XML data, no introspection call is made
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH, TEST_XML);
  const test = object.getInterface(TEST_IFACE);
  const cb = jest.fn();

  test.on('HelloWorld', cb);
  test.on('SignalMultiple', cb);
  test.on('SignalComplicated', cb);

  // don't call EmitSignals through the proxy object
  testIface.EmitSignals();

  // allow signal handlers to run
  await new Promise(resolve => { setTimeout(resolve, 0); });

  expect(cb).toHaveBeenCalledTimes(3);
});

test('client continues receive signals from restarted DBus service', async () => {
  const clientBus = dbus.sessionBus();

  const testServiceName = 'local.test.signals';
  let [testBus] = await createTestService(testServiceName);

  const object = await clientBus.getProxyObject(testServiceName, TEST_PATH);
  const test = object.getInterface(TEST_IFACE);
  const cb = jest.fn();

  expect(clientBus._nameOwners[testServiceName]).toEqual(testBus.name);

  test.on('HelloWorld', cb);
  test.on('SignalMultiple', cb);
  test.on('SignalComplicated', cb);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(3);

  await testBus.releaseName(testServiceName);
  testBus.disconnect();

  await waitForMessage(clientBus, { member: 'NameOwnerChanged' });
  expect(clientBus._nameOwners[testServiceName]).toEqual('');

  [testBus] = await createTestService(testServiceName);

  await waitForMessage(clientBus, { member: 'NameOwnerChanged' });
  expect(clientBus._nameOwners[testServiceName]).toEqual(testBus.name);

  await test.EmitSignals();

  expect(cb).toHaveBeenCalledTimes(6);

  clientBus.disconnect();
  testBus.disconnect();
});
