const assert = require('assert');
const {parseSignature, collapseSignature} = require('./signature');

/**
 * @class
 * A class to represent DBus variants for both the client and service
 * interfaces. The {@link ProxyInterface} and [`Interface`]{@link
 * module:interface~Interface} methods, signals, and properties will use this
 * type to represent variant types. The user should use this class directly for
 * sending variants to methods if their signature expects the type to be a
 * variant.
 *
 * @example
 * let str = new Variant('s', 'hello');
 * let num = new Variant('d', 53);
 * let map = new Variant('a{ss}', { foo: 'bar' });
 * let list = new Variant('as', [ 'foo', 'bar' ]);
 */
class Variant {
 /**
  * Construct a new `Variant` with the given signature and value.
  * @param {string} signature - a DBus type signature for the `Variant`.
  * @param {any} value - the value of the `Variant` with type specified by the type signature.
  */
  constructor(signature, value) {
    this.signature = signature;
    this.value = value;
  }
}

function valueIsVariant(value) {
  // used for the marshaller variant type
  return Array.isArray(value) && value.length === 2 && Array.isArray(value[0]) && value[0].length > 0 && value[0][0].type;
}

function parse(variant) {
  // parses a single complete variant
  let type = variant[0][0];
  let value = variant[1][0];

  if (!type.child.length) {
    if (valueIsVariant(value)) {
      return new Variant(collapseSignature(value[0][0]), parse(value));
    } else {
      return value;
    }
  }

  if (type.type === 'a') {
    if (type.child[0].type === '{') {
      // this is an array of dictionary entries
      let result = {};
      for (let i = 0; i < value.length; ++i) {
        // dictionary keys must have basic types
        result[value[i][0]] = parse([[type.child[0].child[1]], [value[i][1]]]);
      }
      return result;
    } else {
      // other arrays only have one type
      let result = [];
      for (let i = 0; i < value.length; ++i) {
        result[i] = parse([[type.child[0]], [value[i]]]);
      }
      return result;
    }
  } else if (type.type === '(') {
    // structs have types equal to the number of children
    let result = [];
    for (let i = 0; i < value.length; ++i) {
      result[i] = parse([[type.child[i]], [value[i]]]);
    }
    return result;
  }
}

module.exports = {
  parse: parse,
  Variant: Variant
};
