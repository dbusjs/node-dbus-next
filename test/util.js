const dbus = require('../');
const Message = dbus.Message;

async function ping (bus) {
  return bus.call(new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus.Peer',
    member: 'Ping'
  }));
}

/**
 * Waits for a message that passes a filter on a provided bus.
 */
function waitForMessage(bus, messageFilter) {
  return new Promise((resolve) => {
    bus.on('message', (message) => {
      const isMessageValid = Object.entries(messageFilter).every(
        ([key, value]) => message[key] === value
      );

      if (isMessageValid) {
        resolve();
      }
    });
  });
}

module.exports = {
  ping,
  waitForMessage,
};
