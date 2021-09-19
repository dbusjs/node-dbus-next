// Test the ability to send and recv file descriptors in dbus messages.

const dbus = require('../../');
const fs = require("fs");
const Variant = dbus.Variant;
const DBusError = dbus.DBusError;
const Message = dbus.Message;

const {
    Interface, property,
    method, signal,
    ACCESS_READ, ACCESS_WRITE
} = dbus.interface;

const {
    METHOD_CALL,
    METHOD_RETURN,
    SIGNAL,
    ERROR
} = dbus.MessageType;

const {
    NO_REPLY_EXPECTED
} = dbus.MessageFlag;

const TEST_NAME = 'org.test.filedescriptors';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = dbus.sessionBus({negotiateUnixFd: true});
bus.on('error', (err) => {
    console.log(`got unexpected connection error:\n${err.stack}`);
});

// make sure unix fds are supported by the bus
if (!bus._connection.stream.supportsUnixFd) {
    console.log("UNIX_FD not supported");
    test = test.skip
}

const bus2 = dbus.sessionBus({negotiateUnixFd: true});
bus2.on('error', (err) => {
    console.log(`got unexpected connection error:\n${err.stack}`);
});

function openFd() {
    return new Promise((resolve, reject) => {
        fs.open("/dev/null", "r", (err, fd) => {
            if (err) reject(err);
            else resolve(fd);
        })
    })
}
function closeFd(fd) {
    return new Promise((resolve, reject) => {
        fs.close(fd, (err) => {
            if (err) reject(err);
            else resolve();
        })
    })
}
function fstat(fd) {
    return new Promise((resolve, reject) => {
        fs.fstat(fd, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        })
    })
}
async function compareFd(fd1, fd2) {
    expect(fd1).toBeDefined();
    expect(fd2).toBeDefined();
    const s1 = await fstat(fd1);
    const s2 = await fstat(fd2);
    //console.log(fs.readlinkSync("/proc/self/fd/"+fd1));
    //console.log(fs.readlinkSync("/proc/self/fd/"+fd2));
    expect(s1.ino).toEqual(s2.ino);
    expect(s1.dev).toEqual(s2.dev);
    expect(s1.rdev).toEqual(s2.rdev);
}


class TestInterface extends Interface {

    constructor(name) {
        super(name);
        this.fds = [];
    }

    @method({ outSignature: "h" })
    returnsFd() {
        return this.createFd();
    }

    @method({ inSignature: "h" })
    acceptsFd(fd) {
        this.fds.push(fd);
    }

    @property({ signature: 'h', access: ACCESS_READ })
    get getFdProp() {
        return this.getLastFd();
    }

    @property({ signature: 'h', access: ACCESS_WRITE })
    set setFdProp(fd) {
        this.fds.push(fd);
    }

    @signal({ signature: 'h' })
    signalFd(fd) {
        return fd;
    }

    getLastFd() {
        return this.fds[this.fds.length - 1];
    }

    @method({})
    async emitSignal() {
        const fd = await this.createFd();
        await this.signalFd(fd);
    }

    async createFd() {
        const fd = await openFd();
        this.fds.push(fd);
        return fd;
    }

    async cleanup() {
        while (this.fds.length > 0) {
            const fd = this.fds.pop();
            await closeFd(fd);
        }
    }
}

const testIface = new TestInterface(TEST_IFACE);

beforeAll(async () => {
    await bus2.requestName(TEST_NAME);
    bus2.export(TEST_PATH, testIface);
});

afterEach(async () => {
    await testIface.cleanup();
})

afterAll(() => {
    bus.disconnect();
    bus2.disconnect();
});

test('sending file descriptor', async () => {
    const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
    const test = object.getInterface(TEST_IFACE);
    expect(test).toBeDefined();
    expect(test.returnsFd).toBeDefined();
    const fd = await openFd();
    await test.acceptsFd(fd);

    expect(testIface.getLastFd()).toBeDefined();
    await compareFd(fd, testIface.getLastFd());
    await closeFd(fd);
});


test('receiving file descriptor', async () => {
    const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
    const test = object.getInterface(TEST_IFACE);
    expect(test).toBeDefined();
    expect(test.returnsFd).toBeDefined();
    const fd = await test.returnsFd();
    expect(fd).toBeDefined();

    await compareFd(fd, testIface.getLastFd());
    await closeFd(fd);
});

test('get file descriptor property', async () => {
    const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
    const properties = object.getInterface('org.freedesktop.DBus.Properties');
    expect(properties).toBeDefined();
    expect(properties.Get).toBeDefined();
    await testIface.createFd();
    const fdVariant = await properties.Get(TEST_IFACE, "getFdProp");
    expect(fdVariant.signature).toEqual("h");
    expect(fdVariant.value).toBeDefined();

    await compareFd(fdVariant.value, testIface.getLastFd());
    await closeFd(fdVariant.value);
});

test('set file descriptor property', async () => {
    const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
    const properties = object.getInterface('org.freedesktop.DBus.Properties');
    expect(properties).toBeDefined();
    expect(properties.Set).toBeDefined();
    const fd = await openFd();
    await properties.Set(TEST_IFACE, "setFdProp", new Variant("h", fd));

    expect(testIface.getLastFd()).toBeDefined();
    await compareFd(fd, testIface.getLastFd());
    await closeFd(fd);
});

test('signal file descriptor', async () => {
    const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
    const test = object.getInterface(TEST_IFACE);
    expect(test).toBeDefined();

    let fd;
    const onSignal = jest.fn((fd_) => fd = fd_);
    test.on("signalFd", onSignal);

    await test.emitSignal();

    expect(onSignal).toHaveBeenCalled();

    await compareFd(fd, testIface.getLastFd());
    await closeFd(fd);
});


test('low level file descriptor sending', async () => {
    const fd = await openFd();
    const msg = new Message({
        destination: bus.name,
        path: '/org/test/path',
        interface: 'org.test.iface',
        member: 'SomeMember',
        signature: 'h',
        body: [fd],
    });

    const methodReturnHandler = function (sent) {
        if (sent.serial === msg.serial) {
            expect(sent.path).toEqual(msg.path);
            expect(sent.serial).toEqual(msg.serial);
            expect(sent.interface).toEqual(msg.interface);
            expect(sent.member).toEqual(msg.member);
            expect(sent.signature).toEqual("h");
            const sentFd = sent.body[0];
            compareFd(sentFd, fd).then(() => {
                return closeFd(sentFd);
            }).then(() => {
                bus.send(Message.newMethodReturn(sent, 's', ['got it']));
            });

            bus.removeMethodHandler(methodReturnHandler);
            return true;
        }
        return false;
    };
    bus.addMethodHandler(methodReturnHandler);
    expect(bus._methodHandlers.length).toEqual(1);

    let reply = await bus2.call(msg);

    expect(bus._methodHandlers.length).toEqual(0);
    expect(reply.type).toEqual(METHOD_RETURN);
    expect(reply.sender).toEqual(bus.name);
    expect(reply.signature).toEqual('s');
    expect(reply.body).toEqual(['got it']);
    expect(reply.replySerial).toEqual(msg.serial);

    await closeFd(fd);
});


test('low level file descriptor receiving', async () => {
    const fd = await openFd();
    const msg = new Message({
        destination: bus.name,
        path: '/org/test/path',
        interface: 'org.test.iface',
        member: 'SomeMember',
    });

    const methodReturnHandler = function (sent) {
        if (sent.serial === msg.serial) {
            expect(sent.path).toEqual(msg.path);
            expect(sent.serial).toEqual(msg.serial);
            expect(sent.interface).toEqual(msg.interface);
            expect(sent.member).toEqual(msg.member);
            bus.send(Message.newMethodReturn(sent, 'h', [fd]));
            bus.removeMethodHandler(methodReturnHandler);
            return true;
        }
        return false;
    };
    bus.addMethodHandler(methodReturnHandler);
    expect(bus._methodHandlers.length).toEqual(1);

    let reply = await bus2.call(msg);

    expect(bus._methodHandlers.length).toEqual(0);
    expect(reply.type).toEqual(METHOD_RETURN);
    expect(reply.sender).toEqual(bus.name);
    expect(reply.signature).toEqual('h');
    expect(reply.replySerial).toEqual(msg.serial);
    await compareFd(fd, reply.body[0]);

    await closeFd(fd);
    await closeFd(reply.body[0]);
});
