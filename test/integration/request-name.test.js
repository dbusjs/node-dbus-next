let dbus = require('../../');

let {
  Message,
  DBUS_NAME_FLAG_ALLOW_REPLACEMENT,
  DBUS_NAME_FLAG_REPLACE_EXISTING,
  DBUS_NAME_FLAG_DO_NOT_QUEUE,
  DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER,
  DBUS_REQUEST_NAME_REPLY_IN_QUEUE,
  DBUS_REQUEST_NAME_REPLY_EXISTS,
  DBUS_REQUEST_NAME_REPLY_ALREADY_OWNER,
  DBUS_RELEASE_NAME_REPLY_RELEASED,
  DBUS_RELEASE_NAME_REPLY_NON_EXISTENT,
  DBUS_RELEASE_NAME_REPLY_NOT_OWNER,
} = dbus;

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

async function getNameOwner(name) {
  let reply = await bus1.call(new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus',
    member: 'GetNameOwner',
    signature: 's',
    body: [name]
  }));

  return reply.body[0];
}

test('name requests', async () => {
  let testName = 'request.name.test';

  reply = await bus1.requestName(testName);
  expect(reply).toEqual(DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER);
  reply = await bus1.requestName(testName);
  expect(reply).toEqual(DBUS_REQUEST_NAME_REPLY_ALREADY_OWNER);

  reply = await bus2.requestName(testName, DBUS_NAME_FLAG_ALLOW_REPLACEMENT)
  expect(reply).toEqual(DBUS_REQUEST_NAME_REPLY_IN_QUEUE);

  reply = await bus1.releaseName(testName)
  expect(reply).toEqual(DBUS_RELEASE_NAME_REPLY_RELEASED);

  reply = await bus1.releaseName('name.doesnt.exist')
  expect(reply).toEqual(DBUS_RELEASE_NAME_REPLY_NON_EXISTENT);

  reply = await bus1.releaseName(testName)
  expect(reply).toEqual(DBUS_RELEASE_NAME_REPLY_NOT_OWNER);

  new_owner = await getNameOwner(testName)
  expect(new_owner).toEqual(bus2.name);

  reply = await bus1.requestName(testName, DBUS_NAME_FLAG_DO_NOT_QUEUE)
  expect(reply).toEqual(DBUS_REQUEST_NAME_REPLY_EXISTS);

  reply = await bus1.requestName(testName, DBUS_NAME_FLAG_DO_NOT_QUEUE | DBUS_NAME_FLAG_REPLACE_EXISTING)
  expect(reply).toEqual(DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER);
});
