// Test when services throw errors

const dbus = require('../../');
const Variant = dbus.Variant;
const DBusError = dbus.DBusError;

const {
  Interface, property, method
} = dbus.interface;

const TEST_NAME = 'org.test.service_errors';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

class ErroringInterface extends Interface {
  @property({ signature: 's' })
  get ErrorProperty () {
    throw new Error('something went wrong');
  }

  set ErrorProperty (val) {
    throw new Error('something went wrong');
  }

  @property({ signature: 's' })
  WrongType = 55;

  @method({})
  ErrorMethod () {
    throw new Error('something went wrong');
  }

  @method({})
  WrongReturn () {
    return ['foo', 'bar'];
  }
}

const testIface = new ErroringInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('when services throw errors they should be returned to the client', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  const iface = object.getInterface(TEST_IFACE);

  let req = iface.ErrorMethod();
  await expect(req).rejects.toThrow(DBusError);

  req = iface.WrongReturn();
  await expect(req).rejects.toThrow(DBusError);

  req = properties.GetAll(TEST_IFACE);
  await expect(req).rejects.toThrow(DBusError);

  req = properties.Get(TEST_IFACE, 'ErrorProperty');
  await expect(req).rejects.toThrow(DBusError);

  req = properties.Get(TEST_IFACE, 'WrongType');
  await expect(req).rejects.toThrow(DBusError);

  req = properties.Set(TEST_IFACE, 'ErrorProperty', new Variant('s', 'something'));
  await expect(req).rejects.toThrow(DBusError);
});
