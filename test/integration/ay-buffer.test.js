let dbus = require('../../');

let Variant = dbus.Variant;
let {
  Interface, property, method, signal,
  ACCESS_READ, ACCESS_WRITE, ACCESS_READWRITE
} = dbus.interface;

let bus = dbus.sessionBus();
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
  @method({inSignature: 'ay', outSignature: 'ay'})
  EchoBuffer(what) {
    expect(what).toEqual(expect.any(Buffer));
    return what
  }

  @method({inSignature: 'aay', outSignature: 'aay'})
  EchoAay(what) {
    expect(what).toEqual(expect.any(Array));
    for (let buf of what) {
      expect(buf).toEqual(expect.any(Buffer));
    }
    return what
  }

  @method({inSignature: 'v', outSignature: 'v'})
  EchoAyVariant(what) {
    expect(what.signature).toEqual('ay');
    expect(what.value).toEqual(expect.any(Buffer));
    return what;
  }
}

let testIface = new AyBufferInterface(TEST_IFACE);

test('dbus type ay should be a buffer', async () => {
  let object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  let test = object.getInterface(TEST_IFACE);

  let ayArray = [1, 2, 3];
  let buf = Buffer.from(ayArray);
  let result = await test.EchoBuffer(buf);
  expect(result).toEqual(buf);

  // it should work with arrays to for compatibility with earlier versions
  result = await test.EchoBuffer(ayArray);
  expect(result).toEqual(buf);

  // regression #57
  let ayArray2 = [4, 5, 6];
  let buf2 = Buffer.from(ayArray2);

  let bufArray = [buf, buf2];
  result = await test.EchoAay(bufArray);
  expect(result).toEqual(bufArray);

  // compat with earlier versions
  let aayBufArray = [ayArray, ayArray2];
  result = await test.EchoAay(bufArray);
  expect(result).toEqual(bufArray);

  // make sure it works with variants
  let bufVariant = new Variant('ay', buf);
  result = await test.EchoAyVariant(bufVariant);
  expect(result).toEqual(bufVariant);

  let arrayBufVariant = new Variant('ay', ayArray);
  result = await test.EchoAyVariant(arrayBufVariant);
  expect(result).toEqual(new Variant('ay', buf));
});
