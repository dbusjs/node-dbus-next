const ServiceObject = require('./object');
const xml2js = require('xml2js');
const assertObjectPathValid = require('../validators').assertObjectPathValid;

const xmlHeader = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n`

class Name {
  constructor(bus, name, flags) {
    this.bus = bus;
    this.flags = flags || 0;
    this.name = name;
    this.objects = {};
    this.builder = new xml2js.Builder({ headless: true });
  }

  getObject(path) {
    assertObjectPathValid(path);
    if (!this.objects[path]) {
      this.objects[path] = new ServiceObject(path, this.bus);
    }
    return this.objects[path];
  }

  removeObject(path) {
    assertObjectPathValid(path);
    if (this.objects[path]) {
      let obj = this.objects[path];
      for (let i of Object.keys(obj.interfaces)) {
        obj.removeInterface(obj.interfaces[i]);
      }
      delete this.objects[path];
    }
  }

  export(path, iface) {
    let obj = this.getObject(path);
    obj.addInterface(iface);
  }

  unexport(path, iface) {
    iface = iface || null;
    if (iface === null) {
      this.removeObject(path);
    } else {
      let obj = this.getObject(path);
      obj.removeInterface(iface);
      if (!obj.interfaces.length) {
        this.removeObject(path);
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
      that.bus.invokeDbus(dbusRequest, function(err) {
        if (err) {
          return reject(err);
        }
        delete that.bus._names[that.name];
        return resolve();
      });
    });
  }

  introspect(path) {
    assertObjectPathValid(path);
    let xml = {
      node: {
        node: []
      }
    };

    if (this.objects[path]) {
      xml.node.interface = this.objects[path].introspect();
    }

    let pathSplit = path.split('/').filter(n => n);

    for (let key of Object.keys(this.objects)) {
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

    return xmlHeader + this.builder.buildObject(xml);
  }
}

module.exports = Name;
