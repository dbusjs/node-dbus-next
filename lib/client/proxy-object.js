const xml2js = require('xml2js');
const { parseSignature } = require('../signature');
const ProxyInterface = require('./proxy-interface');
const { Message } = require('../message-type');
const {
  assertBusNameValid,
  assertObjectPathValid,
  isObjectPathValid
} = require('../validators');

/**
 * @class
 * A class that represents a proxy to a DBus object. The `ProxyObject` contains
 * `ProxyInterface`s and a list of `node`s which are object paths of child
 * objects. A `ProxyObject` is created through {@link
 * MessageBus#getProxyObject} for a given well-known name and object path.
 * An interface can be gotten through {@link ProxyObject#getInterface} and can
 * be used to call methods and receive signals for that interface.
 *
 * @example
 * let bus = dbus.sessionBus();
 * let obj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
 * let peer = obj.getInterface('org.freedesktop.DBus.Peer')
 * await peer.Ping();
 */
class ProxyObject {
  /**
   * Create a new `ProxyObject`. This constructor should not be called
   * directly. Use {@link MessageBus#getProxyObject} to get a proxy object.
   */
  constructor (bus, name, path) {
    assertBusNameValid(name);
    assertObjectPathValid(path);
    /**
     * The {@link MessageBus} this name belongs to.
     * @memberof ProxyObject#
     * @member {MessageBus} bus
     */
    this.bus = bus;
    /**
     * The well-known bus name for this proxy object as a string.
     * @memberof ProxyObject#
     * @member {string} name
     */
    this.name = name;
    /**
     * The object path for this `ProxyObject`.
     * @memberof ProxyObject#
     * @member {string} path
     */
    this.path = path;
    /**
     * The object path child nodes for this `ProxyObject` as an array of
     * strings
     * @memberof ProxyObject#
     * @member {string[]} nodes
     */
    this.nodes = [];

    /**
     * A map of interface names to [ProxyInterfaces]{@link ProxyInterface} for
     * this `ProxyObject`.
     * @memberof ProxyObject#
     * @member {Object.<string, ProxyInterface>} interfaces
     */
    this.interfaces = {};
    this._parser = new xml2js.Parser();
  }

  /**
   * Get a {@link ProxyInterface} for the given interface name.
   *
   * @param name {string} - the interface name to get.
   * @returns {ProxyInterface} - the proxy interface with this name exported by
   * the object or `undefined` if the object does not export an interface with
   * that name.
   * @throws {Error} Throws an error if the interface is not found on this object.
   */
  getInterface (name) {
    if (!Object.keys(this.interfaces).includes(name)) {
      throw new Error(`interface not found in proxy object: ${name}`);
    }
    return this.interfaces[name];
  }

  _initXml (xml) {
    const root = xml.node;

    if (Array.isArray(root.node)) {
      for (const n of root.node) {
        if (!('$' in n)) {
          continue;
        }
        const name = n.$.name;
        const path = `${this.path}/${name}`;
        if (isObjectPathValid(path)) {
          this.nodes.push(path);
        }
      }
    }

    if (Array.isArray(root.interface)) {
      for (const i of root.interface) {
        const iface = ProxyInterface._fromXml(this, i);
        if (iface !== null) {
          this.interfaces[iface.$name] = iface;
        }
      }
    }
  }

  _init (xml) {
    return new Promise((resolve, reject) => {
      if (xml) {
        this._parser.parseString(xml, (err, data) => {
          if (err) {
            return reject(err);
          }
          this._initXml(data);

          const nameOwnerMessage = new Message({
            destination: 'org.freedesktop.DBus',
            path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus',
            member: 'GetNameOwner',
            signature: 's',
            body: [this.name]
          });

          this.bus.call(nameOwnerMessage)
            .then((msg) => {
              this.bus._nameOwners[this.name] = msg.body[0];
              resolve(this);
            })
            .catch((err) => {
              if (err.type === 'org.freedesktop.DBus.Error.NameHasNoOwner') { return resolve(this); }
              return reject(err);
            });
        });
      } else {
        const introspectMessage = new Message({
          destination: this.name,
          path: this.path,
          interface: 'org.freedesktop.DBus.Introspectable',
          member: 'Introspect',
          signature: '',
          body: []
        });

        this.bus.call(introspectMessage)
          .then((msg) => {
            const xml = msg.body[0];
            this._parser.parseString(xml, (err, data) => {
              if (err) {
                return reject(err);
              }
              this._initXml(data);
              resolve(this);
            });
          })
          .catch((err) => {
            return reject(err);
          });
      }
    });
  }

  _callMethod (iface, member, inSignature, outSignature, ...args) {
    return new Promise((resolve, reject) => {
      args = args || [];

      const methodCallMessage = new Message({
        destination: this.name,
        interface: iface,
        path: this.path,
        member: member,
        signature: inSignature,
        body: args
      });

      this.bus.call(methodCallMessage)
        .then((msg) => {
          const outSignatureTree = parseSignature(outSignature);
          if (outSignatureTree.length === 0) {
            resolve(null);
            return;
          }
          if (outSignatureTree.length === 1) {
            resolve(msg.body[0]);
          } else {
            resolve(msg.body);
          }
        })
        .catch((err) => {
          return reject(err);
        });
    });
  }
}

module.exports = ProxyObject;
