// Test that methods and properties of type 'x' (long int) work correctly

const JSBI = require('jsbi');

const dbus = require('../../');
dbus.setBigIntCompat(true);

const {
  Interface, method, DBusError
} = dbus.interface;

const {
  _getJSBIConstants
} = require('../../lib/constants');

const TEST_NAME = 'org.test.long_compat';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const TEST_ERROR_PATH = 'org.test.name.error';

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

class LongInterface extends Interface {
  @method({ inSignature: 'x', outSignature: 'x' })
  EchoSigned (what) {
    if (what.prototype !== JSBI.BigInt.prototype) {
      throw new DBusError(TEST_ERROR_PATH, 'interface with long compat expected a JSBI BigInt for type x');
    }
    return what;
  }

  @method({ inSignature: 't', outSignature: 't' })
  EchoUnsigned (what) {
    if (what.prototype !== JSBI.BigInt.prototype) {
      throw new DBusError(TEST_ERROR_PATH, 'interface with long compat expected a JSBI BigInt for type t');
    }
    return what;
  }
}

const testIface = new LongInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('test long type works correctly in compatibility mode', async () => {
  const { MAX_INT64, MIN_INT64, MAX_UINT64, MIN_UINT64 } = _getJSBIConstants();
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const test = object.getInterface(TEST_IFACE);

  // small numbers
  let what = JSBI.BigInt(-30);
  let result = await test.EchoSigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);

  what = JSBI.BigInt(30);
  result = await test.EchoUnsigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);
  result = await test.EchoSigned(what);
  expect(JSBI.equal(result, what)).toEqual(true);

  // int64 max
  what = MAX_INT64;
  result = await test.EchoSigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);

  expect((async () => {
    result = await test.EchoSigned(JSBI.add(what, JSBI.BigInt(1)));
    return result.toString();
  })()).rejects.toThrow();

  // int64 min
  what = MIN_INT64;
  result = await test.EchoSigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);

  await expect((async () => {
    result = await test.EchoSigned(JSBI.subtract(what, JSBI.BigInt(1)));
    return result.toString();
  })()).rejects.toThrow();

  // uint64 max
  what = MAX_UINT64;
  result = await test.EchoUnsigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);

  await expect((async () => {
    result = await test.EchoUnsigned(JSBI.add(what, JSBI.BigInt(1)));
    return result.toString();
  })()).rejects.toThrow();

  // uint64 min
  what = MIN_UINT64;
  result = await test.EchoUnsigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, what)).toEqual(true);

  await expect((async () => {
    result = await test.EchoUnsigned(JSBI.subtract(what, JSBI.BigInt(1)));
    return result.toString();
  })()).rejects.toThrow();

  // int conversion
  what = 500;
  result = await test.EchoUnsigned(what);
  expect(result.prototype).toEqual(JSBI.BigInt.prototype);
  expect(JSBI.equal(result, JSBI.BigInt(what))).toEqual(true);
});
