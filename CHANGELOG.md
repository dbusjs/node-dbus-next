# Changelog

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
