const { assertInterfaceNameValid } = require('./validators');
/**
 * An error that can be thrown from DBus methods and property getters and
 * setters to return the error to the client.
 *
 * @param {string} type - The type of error. Must be a valid DBus member name.
 * @param {string} text - The error text. Will be seen by the client.
 */
class DBusError extends Error {
  constructor(type, text) {
    assertInterfaceNameValid(type);
    text = text || '';
    super(text);
    this.name = 'DBusError';
    this.type = type;
    this.text = text;
  }
}

/**
 * An error that can be thrown when trying to request a name (such as when
 * exporting an interface) when the name is already taken
 */
class NameExistsError extends Error {
  constructor(message) {
    message = message || 'Requested a name that already exists on the bus';
    super(message);
    this.name = 'NameExistsError';
  }
}

module.exports = {
  DBusError: DBusError,
  NameExistsError: NameExistsError,
};
