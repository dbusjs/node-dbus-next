const dbus = require('../../');
const Variant = dbus.Variant;

const {
  Interface, property, method, signal,
  ACCESS_READ, ACCESS_WRITE, ACCESS_READWRITE
} = dbus.interface;

const NameExistsError = dbus.NameExistsError;

const TEST_NAME = 'org.test.export';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

let bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});
let bus2 = dbus.sessionBus();
bus2.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

afterAll(() => {
  bus.disconnect();
  bus2.disconnect();
});

const TEST_NAME1 = 'org.test.export_name1';
const TEST_PATH1 = '/org/test/path1';
const TEST_IFACE1 = 'org.test.iface1';

const TEST_NAME2 = 'org.test.export_name2';
const TEST_PATH2 = '/org/test/path2';
const TEST_IFACE2 = 'org.test.iface2';

class ExampleInterfaceOne extends Interface {
  constructor() {
    super(TEST_IFACE1);
  }
}

class ExampleInterfaceTwo extends Interface {
  constructor() {
    super(TEST_IFACE2);
  }
}

let testIface1 = new ExampleInterfaceOne();
let testIface2 = new ExampleInterfaceTwo();

test('export and unexport interfaces and paths', async () => {
  let [name, dbusObject] = await Promise.all([
    bus.requestName(TEST_NAME1),
    bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
  ]);
  name.export(TEST_PATH1, testIface1);

  expect(Object.keys(bus._names).length).toEqual(1);

  // export the name and make sure it's on the bus
  let dbusIface = dbusObject.getInterface('org.freedesktop.DBus');
  let names = await dbusIface.ListNames();
  expect(names).toEqual(expect.arrayContaining([TEST_NAME1]));
  let obj = await bus.getProxyObject(TEST_NAME1, TEST_PATH1);
  let expectedIfaces = [
    testIface1.$name,
    'org.freedesktop.DBus.Properties',
    'org.freedesktop.DBus.Introspectable',
    'org.freedesktop.DBus.Peer',
  ];
  for (let expected of expectedIfaces) {
    expect(obj.interfaces.find((i) => i.$name === expected)).toBeDefined();
  }

  // release the name and make sure it leaves the bus
  await name.release();
  expect(Object.keys(bus._names).length).toEqual(0);
  names = await dbusIface.ListNames();
  expect(names).not.toEqual(expect.arrayContaining([TEST_NAME1]));

  // unexport a path and make sure it's gone
  name = await bus.requestName(TEST_NAME1);
  name.export(TEST_PATH1, testIface1);
  obj = await bus.getProxyObject(TEST_NAME1, TEST_PATH1);
  expect(obj.interfaces.length).toEqual(4);
  name.unexport(TEST_PATH1);
  obj = await bus.getProxyObject(TEST_NAME1, TEST_PATH1);
  expect(obj.interfaces.length).toEqual(0);

  // unexport an interface and make sure it's gone
  name.export(TEST_PATH1, testIface1);
  name.unexport(TEST_PATH1, testIface1);
  obj = await bus.getProxyObject(TEST_NAME1, TEST_PATH1);
  expect(obj.interfaces.length).toEqual(0);

  name.release();
});

test('export two interfaces on different names', async () => {
  let [name1, name2, object ] = await Promise.all([
    bus.requestName(TEST_NAME1),
    bus.requestName(TEST_NAME2),
    bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
  ]);

  name1.export(TEST_PATH1, testIface1);
  name2.export(TEST_PATH2, testIface2);

  expect(Object.keys(bus._names).length).toEqual(2);
  let dbusIface = object.getInterface('org.freedesktop.DBus');
  let names = await dbusIface.ListNames();
  expect(names).toEqual(expect.arrayContaining([TEST_NAME1, TEST_NAME2]));

  await Promise.all([
    name1.release(),
    name2.release()
  ]);
  expect(Object.keys(bus._names).length).toEqual(0);
});

test('export two interfaces on the same name on different paths', async () => {
  let [name, dbusObject ] = await Promise.all([
    bus.requestName(TEST_NAME1),
    bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
  ]);

  name.export(TEST_PATH1, testIface1);
  name.export(TEST_PATH2, testIface2);

  expect(Object.keys(bus._names).length).toEqual(1);
  let dbusIface = dbusObject.getInterface('org.freedesktop.DBus');

  let [ names, obj1, obj2 ] = await Promise.all([
    dbusIface.ListNames(),
    bus.getProxyObject(TEST_NAME1, TEST_PATH1),
    bus.getProxyObject(TEST_NAME1, TEST_PATH2)
  ]);

  expect(names).toEqual(expect.arrayContaining([TEST_NAME1]));
  expect(obj1.getInterface(testIface1.$name)).toBeDefined();
  expect(obj2.getInterface(testIface2.$name)).toBeDefined();

  name.release();
});

test('request a name taken by another bus', async () => {
  let name1 = await bus.requestName(TEST_NAME1);
  name1.export(TEST_PATH1, testIface1);

  let [name2, dbusObject ] = await Promise.all([
    bus2.requestName(TEST_NAME1),
    bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
  ]);
  name2.export(TEST_PATH1, testIface2);

  expect(Object.keys(bus._names).length).toEqual(1);
  expect(Object.keys(bus2._names).length).toEqual(1);

  let dbusIface = dbusObject.getInterface('org.freedesktop.DBus');
  let [ names, obj ] = await Promise.all([
    dbusIface.ListNames(),
    bus.getProxyObject(TEST_NAME1, TEST_PATH1)
  ]);

  expect(names).toEqual(expect.arrayContaining([TEST_NAME1]));
  expect(obj.getInterface(TEST_IFACE1)).toBeDefined();

  // bus2 should have the name in the queue so releasing the name on bus1
  // should give it to bus2
  await name1.release();

  [ names, obj ] = await Promise.all([
    dbusIface.ListNames(),
    bus.getProxyObject(TEST_NAME1, TEST_PATH1)
  ]);
  expect(names).toEqual(expect.arrayContaining([TEST_NAME1]));
  expect(obj.getInterface(TEST_IFACE2)).toBeDefined();

  // passing the flag to not queue should throw an error if the name is taken
  let req = bus.requestName(TEST_NAME1, dbus.DBUS_NAME_FLAG_DO_NOT_QUEUE);
  await expect(req).rejects.toBeInstanceOf(NameExistsError);

  await name2.release();
});
