/**
 * A module for exporting interfaces on a name on the message bus.
 *
 * @module interface
 */
const { parseSignature, collapseSignature } = require('../signature');
const variant = require('../variant');
const Variant = variant.Variant;

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have read access
 * to the property.
 *
 * @static
 */
const ACCESS_READ = 'read';

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have write access
 * to the property.
 *
 * @static
 */
const ACCESS_WRITE = 'write';

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have read and
 * write access to the property.
 *
 * @static
 */
const ACCESS_READWRITE = 'readwrite';
const EventEmitter = require('events');
const {
  assertInterfaceNameValid,
  assertMemberNameValid
} = require('../validators');

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a property.  The property will
 * be gotten and set from the class when users call the standard DBus methods
 * `org.freedesktop.DBus.Properties.Get`,
 * `org.freedesktop.DBus.Properties.Set`, and
 * `org.freedesktop.DBus.Properties.GetAll`. The property getters and setters
 * may throw a {@link DBusError} with an error name and message to return the
 * error to the client.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @example
 * class MyInterface extends Interface {
 *   // uncomment below to use the decorator (jsdoc bug)
 *   //@property({signature: 's'})
 *   get MyProp() {
 *     return this.myProp;
 *   }
 *   set MyProp(value) {
 *     this.myProp = value;
 *   }
 * }
 *
 * @param {object} options - The options for this property.
 * @param {string} options.signature - The DBus type signature for this property.
 * @param {access} [options.access=ACCESS_READWRITE] - The read and write
 * access of the property for clients (effects `Get` and `Set` property methods).
 * @param {string} [options.name] - The name of this property on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
function property (options) {
  options.access = options.access || ACCESS_READWRITE;
  if (!options.signature) {
    throw new Error('missing signature for property');
  }
  options.signatureTree = parseSignature(options.signature);
  return function (target, key, descriptor) {
    const name = options.name || key;
    assertMemberNameValid(name);
    options.name = name;

    let properties = target.$properties;
    if (properties === undefined) {
      properties = {};
      target.$properties = properties;
    }
    properties[key] = options;

    return descriptor;
  };
}

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a method. The method will be
 * called when the client calls it on the bus with the given arguments with
 * types specified by the `inSignature` in the method options.  The method
 * should return a result specified by the `outSignature` which will be
 * returned to the client over the message bus. If multiple output parameters
 * are specified in the `outSignature`, they should be returned within an
 * array.
 *
 * The method may also be `async` or return a `Promise` with the result and the
 * reply will be sent once the promise returns with a response body.
 *
 * The method may throw a {@link DBusError} with an error name and
 * message to return the error to the client.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @example
 * // uncomment the decorators to use them (jsdoc bug)
 *
 * class MyInterface extends Interface {
 *   //@method({inSignature: 's', outSignature: 's'})
 *   async Echo(what) {
 *     return what;
 *   }
 *
 *   //@method({inSignature: 'ss', outSignature: 'vv'})
 *   ReturnsMultiple(what, what2) {
 *     return [
 *       new Variant('s', what),
 *       new Variant('s', what2)
 *     ];
 *   }
 *
 *   //@method({inSignature: '', outSignature: ''})
 *   ThrowsError() {
 *     // the error is returned to the client
 *     throw new DBusError('org.test.iface.Error', 'something went wrong');
 *   }
 * }
 *
 * @param {object} options - The options for this method.
 * @param {string} [options.inSignature=""] - The DBus type signature for the
 * input to this method.
 * @param {string} [options.outSignature=""] - The DBus type signature for the
 * output of this method.
 * @param {string} [options.name] - The name of this method on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
function method (options) {
  // TODO allow overriding of methods?
  // TODO introspect the names of the arguments for the function:
  // https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
  options.disabled = !!options.disabled;
  options.inSignature = options.inSignature || '';
  options.outSignature = options.outSignature || '';
  options.inSignatureTree = parseSignature(options.inSignature);
  options.outSignatureTree = parseSignature(options.outSignature);

  return function (target, key, descriptor) {
    const name = options.name || key;
    assertMemberNameValid(name);
    options.name = name;
    options.fn = descriptor.value;

    let methods = target.$methods;
    if (methods === undefined) {
      methods = {};
      target.$methods = methods;
    }
    methods[key] = options;

    return descriptor;
  };
}

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a signal. To emit the signal on
 * the bus to listeners, just call the decorated method and the signal will be
 * emitted with the returned value with types specified by the `signature` in
 * the signal options. If the signal has multiple output parameters, they
 * should be returned in an array.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @example
 * // uncomment the decorators to use them (jsdoc bug)
 * class MyInterface extends Interface {
 *   //@signal({signature: 's'})
 *   HelloWorld(value) {
 *     return value;
 *   }
 *
 *   //@signal({signature: 'ss'})
 *   SignalMultiple(x) {
 *     return [
 *       'hello',
 *       'world'
 *     ];
 *   }
 * }
 *
 * @param {object} options - The options for this property.
 * @param {string} options.signature - The DBus type signature for this signal.
 * @param {string} [options.name] - The name of this signal on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
function signal (options) {
  // TODO introspect the names of the arguments for the function:
  // https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
  options.signature = options.signature || '';
  options.signatureTree = parseSignature(options.signature);

  return function (target, key, descriptor) {
    const name = options.name || key;
    assertMemberNameValid(name);
    options.name = name;
    options.fn = descriptor.value;

    descriptor.value = function () {
      if (options.disabled) {
        throw new Error('tried to call a disabled signal');
      }
      const result = options.fn.apply(this, arguments);
      this.$emitter.emit('signal', options, result);
    };

    let signals = target.$signals;
    if (signals === undefined) {
      signals = {};
      target.$signals = signals;
    }
    signals[key] = options;

    return descriptor;
  };
}

/**
 * The `Interface` is an abstract class used for defining and exporting an
 * interface on a DBus name. You can override this class to make your own DBus
 * interfaces. Use the decorators within this module to define the
 * [properties]{@link module:interface.property}, [methods]{@link
 * module:interface.method}, and [signals]{@link module:interface.signal} that
 * the interface has. These will be advertised to users in the introspection
 * xml gotten by the `org.freedesktop.DBus.Introspect` method on the name. See
 * the documentation for the decorators for more information. The constructor
 * of the `Interface` should call `super()` with the name of the interface that
 * will be exported.
 *
 * @example
 * class MyInterface extends Interface {
 *    constructor() {
 *      super('org.test.interface_name');
 *    }
 *    // define properties, methods, and signals with decorated functions
 * }
 * let bus = dbus.sessionBus();
 * let name = await bus.requestName('org.test.bus_name');
 * let iface = new MyInterface();
 * name.export('/org/test/path', iface);
 */
class Interface {
  /**
   * Create an interface. This should be called with the name of the interface
   * in the class that extends it.
   */
  constructor (name) {
    assertInterfaceNameValid(name);
    this.$name = name;
    this.$emitter = new EventEmitter();
  }

  /**
   * An alternative to the decorator functions to configure
   * [`Interface`]{@link module:interface~Interface} DBus members when
   * decorators cannot be supported.
   *
   * *Calling this method twice on the same `Interface` or mixing this method
   * with the decorator interface will result in undefined behavior that may be
   * specified at a future time.*
   *
   * @static
   * @example
   * ConfiguredInterface.configureMembers({
   *   properties: {
   *     SomeProperty: {
   *       signature: 's'
   *     }
   *   },
   *   methods: {
   *     Echo: {
   *       inSignature: 'v',
   *       outSignature: 'v'
   *     }
   *   },
   *   signals: {
   *     HelloWorld: {
   *       signature: 'ss'
   *     }
   *   }
   * });
   *
   * @param members {Object} - Member configuration object.
   * @param members.properties {Object} - The class methods to define as
   * properties. The key should be a method defined on the class and the value
   * should be the options for a [property]{@link module:interface.property}
   * decorator.
   * @param members.methods {Object} - The class methods to define as DBus
   * methods. The key should be a method defined on the class and the value
   * should be the options for a [method]{@link module:interface.method}
   * decorator.
   * @param members.signals {Object} - The class methods to define as signals.
   * The key should be a method defined on the class and hte value should be
   * options for a [signal]{@link module:interface.signal} decorator.
   */
  static configureMembers (members) {
    const properties = members.properties || {};
    const methods = members.methods || {};
    const signals = members.signals || {};

    this.prototype.$properties = {};
    this.prototype.$methods = {};
    this.prototype.$signals = {};

    for (const k of Object.keys(properties)) {
      const options = properties[k];
      options.name = options.name || k;
      options.access = options.access || ACCESS_READWRITE;
      if (!options.signature) {
        throw new Error('missing signature for property');
      }
      options.signatureTree = parseSignature(options.signature);
      assertMemberNameValid(options.name);
      this.prototype.$properties[options.name] = options;
    }

    for (const k of Object.keys(methods)) {
      const options = methods[k];
      options.name = options.name || k;
      assertMemberNameValid(options.name);
      options.disabled = !!options.disabled;
      options.inSignature = options.inSignature || '';
      options.outSignature = options.outSignature || '';
      options.inSignatureTree = parseSignature(options.inSignature);
      options.outSignatureTree = parseSignature(options.outSignature);
      options.fn = this.prototype[k];
      this.prototype.$methods[options.name] = options;
    }

    for (const k of Object.keys(signals)) {
      const options = signals[k];
      options.name = options.name || k;
      assertMemberNameValid(options.name);
      options.fn = this.prototype[k];
      options.signature = options.signature || '';
      options.signatureTree = parseSignature(options.signature);
      this.prototype[k] = function () {
        if (options.disabled) {
          throw new Error('tried to call a disabled signal');
        }
        const result = options.fn.apply(this, arguments);
        this.$emitter.emit('signal', options, result);
      };
      this.prototype.$signals[options.name] = options;
    }
  }

  /**
   * Emit the `PropertiesChanged` signal on an [`Interface`s]{@link
   * module:interface~Interface} associated standard
   * `org.freedesktop.DBus.Properties` interface with a map of new values and
   * invalidated properties. Pass the properties as JavaScript values.
   *
   * @static
   * @example
   * Interface.emitPropertiesChanged({ SomeProperty: 'bar' }, ['InvalidedProperty']);
   *
   * @param {module:interface~Interface} - the `Interface` to emit the `PropertiesChanged` signal on
   * @param {Object} - A map of property names and new property values that are changed.
   * @param {string[]} - A list of invalidated properties.
   */
  static emitPropertiesChanged (iface, changedProperties, invalidatedProperties = []) {
    if (!Array.isArray(invalidatedProperties) ||
        !invalidatedProperties.every((p) => typeof p === 'string')) {
      throw new Error('invalidated properties must be an array of strings');
    }

    // we transform them to variants here based on property signatures so they
    // don't have to
    const properties = iface.$properties || {};
    const changedPropertiesVariants = {};
    for (const p of Object.keys(changedProperties)) {
      if (properties[p] === undefined) {
        throw new Error(`got properties changed with unknown property: ${p}`);
      }
      changedPropertiesVariants[p] = new Variant(properties[p].signature, changedProperties[p]);
    }
    iface.$emitter.emit('properties-changed', changedPropertiesVariants, invalidatedProperties);
  }

  $introspect () {
    // TODO cache xml when the interface is declared
    const xml = {
      $: {
        name: this.$name
      }
    };

    const properties = this.$properties || {};
    for (const p of Object.keys(properties) || []) {
      const property = properties[p];
      if (property.disabled) {
        continue;
      }
      xml.property = xml.property || [];
      xml.property.push({
        $: {
          name: property.name,
          type: property.signature,
          access: property.access
        }
      });
    }

    const methods = this.$methods || {};
    for (const m of Object.keys(methods) || []) {
      const method = methods[m];
      if (method.disabled) {
        continue;
      }

      xml.method = xml.method || [];
      const methodXml = {
        $: {
          name: method.name
        },
        arg: [],
        annotation: []
      };

      for (const signature of method.inSignatureTree) {
        methodXml.arg.push({
          $: {
            direction: 'in',
            type: collapseSignature(signature)
          }
        });
      }

      for (const signature of method.outSignatureTree) {
        methodXml.arg.push({
          $: {
            direction: 'out',
            type: collapseSignature(signature)
          }
        });
      }

      if (method.noReply) {
        methodXml.annotation.push({
          $: {
            name: 'org.freedesktop.DBus.Method.NoReply',
            value: 'true'
          }
        });
      }

      xml.method.push(methodXml);
    }

    const signals = this.$signals || {};
    for (const s of Object.keys(signals) || []) {
      const signal = signals[s];
      if (signal.disabled) {
        continue;
      }
      xml.signal = xml.signal || [];
      const signalXml = {
        $: {
          name: signal.name
        },
        arg: []
      };

      for (const signature of signal.signatureTree) {
        signalXml.arg.push({
          $: {
            type: collapseSignature(signature)
          }
        });
      }

      xml.signal.push(signalXml);
    }

    return xml;
  }
}

module.exports = {
  ACCESS_READ: ACCESS_READ,
  ACCESS_WRITE: ACCESS_WRITE,
  ACCESS_READWRITE: ACCESS_READWRITE,
  property: property,
  method: method,
  signal: signal,
  Interface: Interface
};
