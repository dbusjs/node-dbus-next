const EventEmitter = require('events');
const {
  isInterfaceNameValid,
  isMemberNameValid
} = require('../validators');

class ProxyListener {
  constructor (signal, iface) {
    this.refcount = 0;
    this.fn = (msg) => {
      const { body, signature, sender } = msg;
      if (iface.$object.bus._nameOwners[iface.$object.name] !== sender) {
        return;
      }
      if (signature !== signal.signature) {
        console.error(`warning: got signature ${signature} for signal ${msg.interface}.${signal.name} (expected ${signal.signature})`);
        return;
      }
      iface.emit.apply(iface, [signal.name].concat(body));
    };
  }
}

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
  constructor (name, object) {
    super();
    this.$name = name;
    this.$object = object;
    this.$properties = [];
    this.$methods = [];
    this.$signals = [];
    this.$listeners = {};

    const getEventDetails = (eventName) => {
      const signal = this.$signals.find((s) => s.name === eventName);
      if (!signal) {
        return [null, null];
      }

      const detailedEvent = JSON.stringify({
        path: this.$object.path,
        interface: this.$name,
        member: eventName
      });

      return [signal, detailedEvent];
    };

    this.on('removeListener', (eventName, listener) => {
      const [signal, detailedEvent] = getEventDetails(eventName);

      if (!signal) {
        return;
      }

      const proxyListener = this._getEventListener(signal);

      if (proxyListener.refcount <= 0) {
        return;
      }

      proxyListener.refcount -= 1;
      if (proxyListener.refcount > 0) {
        return;
      }

      this.$object.bus._removeMatch(this._signalMatchRuleString(eventName))
        .catch(error => {
          this.$object.bus.emit('error', error);
        });
      this.$object.bus._signals.removeListener(detailedEvent, proxyListener.fn);
    });

    this.on('newListener', (eventName, listener) => {
      const [signal, detailedEvent] = getEventDetails(eventName);

      if (!signal) {
        return;
      }

      const proxyListener = this._getEventListener(signal);

      if (proxyListener.refcount > 0) {
        proxyListener.refcount += 1;
        return;
      }

      proxyListener.refcount = 1;

      this.$object.bus._addMatch(this._signalMatchRuleString(eventName))
        .catch(error => {
          this.$object.bus.emit('error', error);
        });
      this.$object.bus._signals.on(detailedEvent, proxyListener.fn);
    });
  }

  _signalMatchRuleString (eventName) {
    return `type='signal',sender=${this.$object.name},interface='${this.$name}',path='${this.$object.path}',member='${eventName}'`;
  }

  _getEventListener (signal) {
    if (this.$listeners[signal.name]) {
      return this.$listeners[signal.name];
    }

    this.$listeners[signal.name] = new ProxyListener(signal, this);
    return this.$listeners[signal.name];
  }

  static _fromXml (object, xml) {
    if (!('$' in xml) || !isInterfaceNameValid(xml.$.name)) {
      return null;
    }

    const name = xml.$.name;
    const iface = new ProxyInterface(name, object);

    if (Array.isArray(xml.property)) {
      for (const p of xml.property) {
        // TODO validation
        if ('$' in p) {
          iface.$properties.push(p.$);
        }
      }
    }

    if (Array.isArray(xml.signal)) {
      for (const s of xml.signal) {
        if (!('$' in s) || !isMemberNameValid(s.$.name)) {
          continue;
        }
        const signal = {
          name: s.$.name,
          signature: ''
        };

        if (Array.isArray(s.arg)) {
          for (const a of s.arg) {
            if ('$' in a && 'type' in a.$) {
              // TODO signature validation
              signal.signature += a.$.type;
            }
          }
        }

        iface.$signals.push(signal);
      }
    }

    if (Array.isArray(xml.method)) {
      for (const m of xml.method) {
        if (!('$' in m) || !isMemberNameValid(m.$.name)) {
          continue;
        }
        const method = {
          name: m.$.name,
          inSignature: '',
          outSignature: ''
        };

        if (Array.isArray(m.arg)) {
          for (const a of m.arg) {
            if (!('$' in a) || typeof a.$.type !== 'string') {
              continue;
            }
            const arg = a.$;
            if (arg.direction === 'in') {
              method.inSignature += arg.type;
            } else if (arg.direction === 'out') {
              method.outSignature += arg.type;
            }
          }
        }

        // TODO signature validation
        iface.$methods.push(method);

        iface[method.name] = function (...args) {
          const objArgs = [
            name,
            method.name,
            method.inSignature,
            method.outSignature
          ].concat(args);
          return object._callMethod.apply(object, objArgs);
        };
      }
    }

    return iface;
  }
}

module.exports = ProxyInterface;
