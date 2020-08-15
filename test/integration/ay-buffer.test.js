const dbus = require('../../');

const Variant = dbus.Variant;
const {
  Interface, method
} = dbus.interface;

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

const TEST_NAME = 'org.test.aybuffer';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

class AyBufferInterface extends Interface {
  @method({ inSignature: 'ay', outSignature: 'ay' })
  EchoBuffer (what) {
    expect(what).toEqual(expect.any(Buffer));
    return what;
  }

  @method({ inSignature: 'aay', outSignature: 'aay' })
  EchoAay (what) {
    expect(what).toEqual(expect.any(Array));
    for (const buf of what) {
      expect(buf).toEqual(expect.any(Buffer));
    }
    return what;
  }

  @method({ inSignature: 'v', outSignature: 'v' })
  EchoAyVariant (what) {
    expect(what.signature).toEqual('ay');
    expect(what.value).toEqual(expect.any(Buffer));
    return what;
  }
}

const testIface = new AyBufferInterface(TEST_IFACE);

test('dbus type ay should be a buffer', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const test = object.getInterface(TEST_IFACE);

  const ayArray = [1, 2, 3];
  const buf = Buffer.from(ayArray);
  let result = await test.EchoBuffer(buf);
  expect(result).toEqual(buf);

  // it should work with arrays to for compatibility with earlier versions
  result = await test.EchoBuffer(ayArray);
  expect(result).toEqual(buf);

  // regression #57
  const ayArray2 = [4, 5, 6];
  const buf2 = Buffer.from(ayArray2);

  const bufArray = [buf, buf2];
  result = await test.EchoAay(bufArray);
  expect(result).toEqual(bufArray);

  // compat with earlier versions
  const aayBufArray = [ayArray, ayArray2];
  result = await test.EchoAay(aayBufArray);
  expect(result).toEqual(bufArray);

  // make sure it works with variants
  const bufVariant = new Variant('ay', buf);
  result = await test.EchoAyVariant(bufVariant);
  expect(result).toEqual(bufVariant);

  const arrayBufVariant = new Variant('ay', ayArray);
  result = await test.EchoAyVariant(arrayBufVariant);
  expect(result).toEqual(new Variant('ay', buf));
});
