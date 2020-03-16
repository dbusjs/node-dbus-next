#!/usr/bin/env node

const fs = require('fs');
const xml2js = require('xml2js');
const Handlebars = require('handlebars');
let parser = new xml2js.Parser();
const program = require('commander');
const dbus = require('../');
const Message = dbus.Message;
const {
    METHOD_RETURN,
    ERROR,
    SIGNAL,
    METHOD_CALL
} = dbus.MessageType;
const {
    isObjectPathValid,
    isMemberNameValid,
    isInterfaceNameValid,
    isBusNameValid
} = dbus.validators;

function exitError(message) {
    program.outputHelp();
    console.error();
    console.error(message);
    process.exit(1);
}

program
    .version('0.1.0')
    .description('Generate an interface from a DBus object')
    .option('--system', 'Use the system bus')
    .option('--session', 'Use the session bus')
    .option('-t, --template [path]', 'Template to use for interface generation')
    .option('--full', 'Do not exclude DBus standard interfaces')
    .option('-p, --prefix', 'Prefix class names with full interface path')
    .option('-o, --output [path]', 'The output file path (default: stdout)')
    .arguments('<destination> <objectPath>')
    .parse(process.argv);



if (program.system && program.session) {
    exitError('Only one of --system or --session may be passed');
}

if (!program.args[0]) {
    exitError('<destination> positional argument is required');
}

if (!program.args[1]) {
    exitError('<objectPath> positional argument is required');
}

const destination = program.args[0];
const objectPath = program.args[1];

if (!isObjectPathValid(objectPath)) {
    exitError(`got invalid object path: ${objectPath}`);
}

if (!isBusNameValid(destination) && !destination.match(/^:\d+/)) {
    exitError(`got invalid destination: ${destination}`);
}

program.template = program.template || __dirname + "/../templates/javascript-class.hbs";

if (!fs.existsSync(program.template)) {
    exitError(`template file '${program.template}' does not exists`);
}

const bus = (program.system ? dbus.systemBus() : dbus.sessionBus());


function getInterfaceDesc(destination, objectPath) {
    const message = new Message({
        type: METHOD_CALL,
        destination: destination,
        path: objectPath,
        interface: "org.freedesktop.DBus.Introspectable",
        member: "Introspect",
        signature: "",
        body: []
    });

    return bus.call(message).then((reply) => reply.body[0]);
}


function collapseSignature(args, dir) {
    let signature = '';
    args = args || [];
    for (arg of args) {
        if (!dir || arg['$'].direction === dir) {
            signature += arg['$'].type;
        }
    }
    return signature;
}

function tsType(type) {
    switch (type) {
        case "b": return "boolean";
        case "y":
        case "n":
        case "q":
        case "i":
        case "u":
        case "h":
        case "d":
            return "number";
        case "x":
        case "t":
            return "DBus.BigInt";
        case "g":
        case "s":
            return "string";
        case "o":
            return "DBus.ObjectPath";
        case "v":
            return "DBus.Variant";
    }
    if (type[0] === "a") {
        if (type[1] === "{") {
            if (type.match(/^a\{\w\w\}$/)) {
                return `{[key: ${tsType(type[2])}]: ${tsType(type[3])}}`
            }
            //TODO: handle more complex types
            return `/* ${type} */ {[key:string]: any}`;
        }
        // array of bytes is a NodeJS.Buffer
        if (type[1] === "y") {
            return "Buffer";
        }
        return new Handlebars.SafeString("Array<" + tsType(type.substr(1)) + ">");
    }
    if (type[0] === "(") {
        //TODO: handle more complex types
        return `/* ${type} */ any[]`;
    }

    return `/* ${type} */ any`;
}

const helpers = {
    ifeq(a, b, options) {
        if (a == b) { return options.fn(this); }
        return options.inverse(this);
    },

    tsType: tsType,
    outType(args) {
        args = (args || []).map(p => p["$"]).filter((p) => p.direction === "out");

        if (args.length === 0) return "void";
        if (args.length === 1) return tsType(args[0].type);
        return "any"
    },

    canRead(access, options) {
        if (access === "read" || access === "readwrite") { return options.fn(this); }
        return options.inverse(this);
    },
    canWrite(access, options) {
        if (access === "write" || access === "readwrite") { return options.fn(this); }
        return options.inverse(this);
    },

    className(ifaceName) {
        if (program.prefix) {
            let name = ifaceName.split('');
            name[0] = name[0].toUpperCase();
            let dots = 0;
            for (let i = 0; i < name.length - dots; ++i) {
                if (name[i + dots] === '.') {
                    name[i] = name[i + dots + 1].toUpperCase();
                    ++dots;
                } else {
                    name[i] = name[i + dots];
                }
            }

            return name.slice(0, -1 * dots).join('');
        } else {
            const path = ifaceName.split(".");
            const name = path[path.length - 1];
            return name.charAt(0).toUpperCase() + name.slice(1);
        }
    },
    accessConst(access) {
        if (access === 'read') {
            return 'ACCESS_READ';
        } else if (access === 'write') {
            return 'ACCESS_WRITE';
        } else if (access === 'readwrite') {
            return 'ACCESS_READWRITE';
        } else {
            throw new Error(`got unknown access: ${access}`);
        }
    },
    inSignature(args) {
        return collapseSignature(args, 'in');
    },
    outSignature(args) {
        return collapseSignature(args, 'out');
    },
    signature(args) {
        return collapseSignature(args);
    },
    countArgs(args, dir) {
        let count = 0;
        for (arg of args) {
            if (!dir || arg['$'].direction === dir) {
                count++;
            }
        }
        return count;
    }
};

Handlebars.registerHelper(helpers);

async function parseXml(data) {
    return new Promise((resolve, reject) => {
        parser.parseString(data, (err, xml) => {
            if (err) {
                reject(err);
            }
            resolve(xml);
        })
    });
}

async function templateXmlData(template, data) {
    let interfaces = [];

    let xml = await parseXml(data);
    if (!xml.node) {
        console.error('xml document did not contain a root node')
        process.exit(1);
    }
    if (!xml.node.interface) {
        console.error('xml document did not contain any interfaces');
        process.exit(1);
    }

    for (let iface of xml.node.interface) {
        if (!iface['$'] || !iface['$'].name) {
            console.log('got an interface without a name')
            process.exit(1);
        }
    }

    for (let iface of xml.node.interface) {
        if (!program.full && iface['$'].name.startsWith('org.freedesktop.DBus.')) {
            // ignore standard interfaces
            continue;
        }
        interfaces.push(iface);
    }

    return template({ interfaces: interfaces, xmlData: data, objectPath, serviceName: destination });
}

async function main() {
    const templateStr = await (fs.promises ? fs.promises.readFile : fs.readFileSync)(program.template, { encoding: "utf8" });

    const template = Handlebars.compile(templateStr);
    const desc = await getInterfaceDesc(destination, objectPath);
    //console.log(desc);
    const result = await templateXmlData(template, desc);

    if (program.output) {
        await (fs.promises ? fs.promises.writeFile : fs.writeFileSync)(program.output, result);
    } else {
        console.log(result);
    }
    return 0;
}

main()
    .then(() => {
        bus.disconnect();
    })
    .catch((err) => {
        console.error(`Error:`, err);
        process.exit(1);
    });

