const dbus = require('../../');
const { ping } = require('../util');

const {
  Interface, method, signal
} = dbus.interface;

const TEST_NAME = 'org.test.disconnect';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

class TestInterface extends Interface {
  @method({ inSignature: 's', outSignature: 's' })
  Echo (what) {
    return what;
  }

  @signal({})
  SomeSignal () {
  }
}

const testIface = new TestInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('what happens when a bus disconnects', async () => {
  // low level: sending a message on a disconnected bus should throw
  let bus2 = dbus.sessionBus();
  await ping(bus2);
  bus2.disconnect();
  await expect(ping(bus2)).rejects.toThrow();

  // high level: calling a method on an object with a disconnected bus should
  // throw
  bus2 = dbus.sessionBus();
  await ping(bus2);
  let obj = await bus2.getProxyObject(TEST_NAME, TEST_PATH);
  let test = obj.getInterface(TEST_IFACE);
  bus2.disconnect();
  await expect(test.Echo('hi')).rejects.toThrow();

  // high level: if you're listening to a signal and the bus disonnects, there
  // shouldn't be a warning
  bus2 = dbus.sessionBus();
  await ping(bus2);
  obj = await bus2.getProxyObject(TEST_NAME, TEST_PATH);
  test = obj.getInterface(TEST_IFACE);
  const fn = () => {};
  test.on('SomeSignal', fn);
  await ping(bus2);
  bus2.disconnect();
  test.removeListener('SomeSignal', fn);
});
