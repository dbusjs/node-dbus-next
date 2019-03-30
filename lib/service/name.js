const ServiceObject = require('./object');
const xml2js = require('xml2js');
const assertObjectPathValid = require('../validators').assertObjectPathValid;

const xmlHeader = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n`

class Name {
  constructor(bus, name, flags) {
    this.bus = bus;
    this.flags = flags || 0;
    this.name = name;
    this._objects = {};
    this._builder = new xml2js.Builder({ headless: true });
  }

  export(path, iface) {
    let obj = this._getObject(path);
    obj.addInterface(iface);
  }

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

  release() {
    let that = this;
    return new Promise((resolve, reject) => {
      let dbusRequest = {
        member: 'ReleaseName',
        signature: 's',
        body: [that.name]
      };
      that.bus._invokeDbus(dbusRequest, function(err) {
        if (err) {
          return reject(err);
        }
        delete that.bus._names[that.name];
        return resolve();
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
