/**
 * @module interface
 */
const ServiceObject = require('./object');
const {Message} = require('../message-type');
const xml2js = require('xml2js');
const {assertObjectPathValid} = require('../validators');

const xmlHeader = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n`

/**
 * @class
 * A class that represents a well-known service name requested for the {@link
 * MessageBus}. The `Name` can be used to export an [`Interface`]{@link
 * module:interface~Interface} at an object path.
 *
 * @example
 * let name = await bus.requestName('org.test.name');
 * // use the Interface class to define your interface and then export it on
 * // the name to make it available to clients
 * name.export('/org/test/path', iface);
 * // remove it from the name with [Name#unexport]{@link module:interface~Name#unexport}.
 * name.unexport('/org/test/path', iface);
 * // release the name if you no longer want to own it
 * await name.release();
 */
class Name {
  /**
   * Create a new `Name`. This is not to be called directly. Use {@link
   * MessageBus#requestName} to request a name on the bus.
   */
  constructor(bus, name, flags) {
    /**
     * The {@link MessageBus} this name belongs to.
     * @memberof Name#
     * @member {MessageBus} bus
     */
    this.bus = bus;
    /**
     * The name flags this `Name` was created with.
     * @memberof Name#
     * @member {NameFlags} flags
     */
    this.flags = flags || 0;
    /**
     * The identifying name of this `Name` as a string.
     * @memberof Name#
     * @member {string} name
     */
    this.name = name;
    this._objects = {};
    this._builder = new xml2js.Builder({ headless: true });
  }

  /**
   * Export an [`Interface`]{@link module:interface~Interface} on the bus. See
   * the documentation for that class for how to define service interfaces.
   *
   * @param path {string} - The object path to export this `Interface` on.
   * @param iface {module:interface~Interface} - The service interface to export.
   */
  export(path, iface) {
    let obj = this._getObject(path);
    obj.addInterface(iface);
  }

  /**
   * Unexport an `Interface` on the name. The interface will no longer be
   * advertised to clients.
   *
   * @param {string} path - The object path on which to unexport.
   * @param {module:interface~Interface} [iface] - The `Interface` to unexport.
   * If not given, this will remove all interfaces on the path.
   */
  unexport(path, iface) {
    iface = iface || null;
    if (iface === null) {
      this._removeObject(path);
    } else {
      let obj = this._getObject(path);
      obj.removeInterface(iface);
      if (!obj.interfaces.length) {
        this._removeObject(path);
      }
    }
  }

  /**
   * Release this name. Requests that the name should no longer be owned by the
   * {@link MessageBus}.
   *
   * @returns {Promise} A Promise that will resolve when the request to release
   * the name is complete.
   */
  release() {
    let that = this;
    return new Promise((resolve, reject) => {
      let msg = new Message({
        path: '/org/freedesktop/DBus',
        destination: 'org.freedesktop.DBus',
        interface: 'org.freedesktop.DBus',
        member: 'ReleaseName',
        signature: 's',
        body: [that.name]
      });
      that.bus._call(msg)
        .then((msg) => {
          delete that.bus._names[that.name];
          return resolve();
        })
        .catch((err) => {
          return reject(err);
        });
    });
  }

  _getObject(path) {
    assertObjectPathValid(path);
    if (!this._objects[path]) {
      this._objects[path] = new ServiceObject(path, this.bus);
    }
    return this._objects[path];
  }

  _removeObject(path) {
    assertObjectPathValid(path);
    if (this._objects[path]) {
      let obj = this._objects[path];
      for (let i of Object.keys(obj.interfaces)) {
        obj.removeInterface(obj.interfaces[i]);
      }
      delete this._objects[path];
    }
  }

  _introspect(path) {
    assertObjectPathValid(path);
    let xml = {
      node: {
        node: []
      }
    };

    if (this._objects[path]) {
      xml.node.interface = this._objects[path].introspect();
    }

    let pathSplit = path.split('/').filter(n => n);

    for (let key of Object.keys(this._objects)) {
      let keySplit = key.split('/').filter(n => n);
      if (keySplit.length <= pathSplit.length) {
        continue;
      }
      if (pathSplit.every((v, i) => v === keySplit[i])) {
        let child = keySplit[pathSplit.length];
        xml.node.node.push({
          $: {
            name: child
          }
        });
      }
    }

    return xmlHeader + this._builder.buildObject(xml);
  }
}

module.exports = Name;
