let dbus = require('../');
let Message = dbus.Message;

async function ping(bus) {
  return bus.call(new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus.Peer',
    member: 'Ping'
  }));
}

module.exports = {
  ping: ping
};
