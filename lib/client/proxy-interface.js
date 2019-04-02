let EventEmitter = require('events');
const {
  isInterfaceNameValid,
  isMemberNameValid
} = require('../validators');

/**
 * A class to represent a proxy to an interface exported on the bus to be used
 * by a client. A `ProxyInterface` is gotten by interface name from the {@link
 * ProxyObject} from the {@link MessageBus}. This class is constructed
 * dynamically based on the introspection data on the bus. The advertised
 * methods of the interface are exposed as class methods that take arguments
 * and return a Promsie that resolves to types specified by the type signature
 * of the DBus method. The `ProxyInterface` is an `EventEmitter` that emits
 * events with types that are specified by the type signature of the DBus
 * signal advertised on the bus when that signal is received.
 *
 * If an interface method call returns an error, `ProxyInterface` method call
 * will throw a {@link DBusError}.
 *
 * @example
 * // this demonstrates the use of the standard
 * // `org.freedesktop.DBus.Properties` interface for an interface that exports
 * // some properties.
 * let bus = dbus.sessionBus();
 * let obj = await bus.getProxyObject('org.test.bus_name', '/org/test/path');
 * let properties = obj.getInterface('org.freedesktop.DBus.Properties');
 * // the `Get` method provided by this interface takes two strings and returns
 * // a Variant
 * let someProperty = await properties.Get('org.test.interface_name', 'SomeProperty');
 * // the `PropertiesChanged` signal provided by this interface will emit an
 * // event on the interface with its specified signal arguments.
 * properties.on('PropertiesChanged', (props, invalidated) => {});
 */
class ProxyInterface extends EventEmitter {
  /**
   * Create a new `ProxyInterface`. This constructor should not be called
   * directly. Use {@link ProxyObject#getInterface} to get a proxy interface.
   */
  constructor(name, object) {
    super();
    this.$name = name;
    this.$object = object;
    this.$properties = [];
    this.$methods = [];
    this.$signals = [];
  }

  static _fromXml(object, xml) {
    if (!xml.hasOwnProperty('$') || !isInterfaceNameValid(xml['$'].name)) {
      return null;
    }

    let name = xml['$'].name;
    let iface = new ProxyInterface(name, object)

    if (Array.isArray(xml.property)) {
      for (let p of xml.property) {
        // TODO validation
        if (p.hasOwnProperty('$')) {
          iface.$properties.push(p['$']);
        }
      }
    }

    if (Array.isArray(xml.signal)) {
      for (let s of xml.signal) {
        if (!s.hasOwnProperty('$') || !isMemberNameValid(s['$'].name)) {
          continue;
        }
        let signal = {
          name: s['$'].name,
          signature: ''
        };

        if (Array.isArray(s.arg)) {
          for (let a of s.arg) {
            if (a.hasOwnProperty('$') && a['$'].hasOwnProperty('type')) {
              // TODO signature validation
              signal.signature += a['$'].type;
            }
          }
        }

        iface.$signals.push(signal);
      }
    }

    if (Array.isArray(xml.method)) {
      for (let m of xml.method) {
        if (!m.hasOwnProperty('$') || !isMemberNameValid(m['$'].name)) {
          continue;
        }
        let method = {
          name: m['$'].name,
          inSignature: '',
          outSignature: ''
        };

        if (Array.isArray(m.arg)) {
          for (let a of m.arg) {
            if (!a.hasOwnProperty('$') || typeof a['$'].type !== 'string') {
              continue;
            }
            let arg = a['$'];
            if (arg.direction === 'in') {
              method.inSignature += arg.type;
            } else if (arg.direction === 'out') {
              method.outSignature += arg.type;
            }
          }
        }

        // TODO signature validation
        iface.$methods.push(method);

        iface[method.name] = function(...args) {
          let objArgs = [
            name,
            method.name,
            method.inSignature,
            method.outSignature
          ].concat(args);
          return object._callMethod.apply(object, objArgs);
        }
      }
    }

    return iface;
  }
}

module.exports = ProxyInterface;
