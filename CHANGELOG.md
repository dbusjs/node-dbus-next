# Changelog

## v0.4.1

This release contains breaking changes to how interfaces are exported on the bus with the public api. See the README and example service for the current way to export interfaces.

* Add continuous integration
* Give DBusError to clients when services throw errors (#11)
* get dbus session bus address from the filesystem when `DBUS_SESSION_BUS_ADDRESS` is not set in the environment (addresses #14)
* Add constants for name request flags
* remove `bus.export()` and `bus.unexport()` (breaking)
* Add `bus.requestName()` to the public api which now returns a promise which resolves to a `Name` object which is now also part of the public api.
* Add `name.release()` to remove a name from the bus

## v0.3.2

* Add bus name validators
* bugfix: allow "-" in bus names
* bugfix: Use Long.js internally to fix issues with sending and receiving negative numbers

## v0.3.1

Export dbus interface and member validators.

## v0.2.1

This version introduces changes for compatibility with node version 6.3.0 and adds the generate-interfaces.js utility.

## v0.2.0

This version contains breaking changes and new features.

* BigInt compatibility mode (breaking) (#7)
* Bump Node engine requirement to 8.2.1 (#7, #6)
* Make emitting of PropertiesChange a static method on Interface (breaking)
* Add `name` option to members to change the name from the JavaScript name (#9)
* Add `disabled` option to members to disable members at runtime (#9)
* Add tests for introspection xml generation

## v0.1.0

* Remove optimist dependency
* Allow throwing DBusError in getter and setter for interfaces
* Use BigInt for 'x' and 't' types
