const fs = require('fs');
const os = require('os');

function getDbusAddressFromWindowSelection (callback) {
  // read dbus adress from window selection
  // TODO: implement this somewhere
  const x11 = require('x11');
  if (x11 === null) {
    throw new Error('cannot get session bus address from window selection: dbus-next was installed without x11 support');
  }

  // read machine uuid
  fs.readFile('/var/lib/dbus/machine-id', 'ascii', function (err, uuid) {
    if (err) return callback(err);
    const hostname = os.hostname().split('-')[0];
    x11.createClient(function (err, display) {
      if (err) return callback(err);
      const X = display.client;
      const selectionName = `_DBUS_SESSION_BUS_SELECTION_${
        hostname
      }_${uuid.trim()}`;
      X.InternAtom(false, selectionName, function (err, id) {
        if (err) return callback(err);
        X.GetSelectionOwner(id, function (err, win) {
          if (err) return callback(err);
          X.InternAtom(false, '_DBUS_SESSION_BUS_ADDRESS', function (
            err,
            propId
          ) {
            if (err) return callback(err);
            win = display.screen[0].root;
            X.GetProperty(0, win, propId, 0, 0, 10000000, function (err, val) {
              if (err) return callback(err);
              callback(null, val.data.toString());
            });
          });
        });
      });
    });
  });
}

function getDbusAddressFromFs () {
  const home = process.env.HOME;
  const display = process.env.DISPLAY;
  if (!display) {
    throw new Error('could not get DISPLAY environment variable to get dbus address');
  }

  const reg = /.*:([0-9]+)\.?.*/;
  const match = display.match(reg);

  if (!match || !match[1]) {
    throw new Error('could not parse DISPLAY environment variable to get dbus address');
  }

  const displayNum = match[1];

  const machineId = fs.readFileSync('/var/lib/dbus/machine-id').toString().trim();
  const dbusInfo = fs.readFileSync(`${home}/.dbus/session-bus/${machineId}-${displayNum}`).toString().trim();
  for (let line of dbusInfo.split('\n')) {
    line = line.trim();
    if (line.startsWith('DBUS_SESSION_BUS_ADDRESS=')) {
      let address = line.split('DBUS_SESSION_BUS_ADDRESS=')[1];
      if (!address) {
        throw new Error('DBUS_SESSION_BUS_ADDRESS variable is set incorrectly in dbus info file');
      }

      const removeQuotes = /^['"]?(.*?)['"]?$/;
      address = address.match(removeQuotes)[1];
      return address;
    }
  }

  throw new Error('DBUS_SESSION_BUS_ADDRESS was not set in dbus info file');
}

module.exports = {
  getDbusAddressFromFs: getDbusAddressFromFs,
  getDbusAddressFromWindowSelection: getDbusAddressFromWindowSelection
};
