// Test the ability to send and recv file descriptors in dbus messages.

const dbus = require('../../');
const fs = require("fs");
const Variant = dbus.Variant;
const DBusError = dbus.DBusError;

const {
    Interface, property,
    method, signal,
    ACCESS_READ, ACCESS_WRITE
} = dbus.interface;

const TEST_NAME = 'org.test.filedescriptors';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = dbus.sessionBus();
bus.on('error', (err) => {
    console.log(`got unexpected connection error:\n${err.stack}`);
});

// if the test session was launched with dbus-run-session 
// it will be an abstract socket which does not support unix fds
if(!bus._connection.stream.supportsUnixFd) {
    console.log("UNIX_FD not supported");
    test = test.skip
}

const bus2 = dbus.sessionBus();
bus2.on('error', (err) => {
    console.log(`got unexpected connection error:\n${err.stack}`);
});

function openFd() {
    return new Promise((resolve, reject) => {
        fs.open("/dev/null", "r", (err, fd) => {
            if(err) reject(err);
            else resolve(fd);
        })
    })
}
function closeFd(fd) {
    return new Promise((resolve, reject) => {
        fs.close(fd, (err) => {
            if(err) reject(err);
            else resolve();
        })
    })
}
function fstat(fd) {
    return new Promise((resolve, reject) => {
        fs.fstat(fd, (err, res) => {
            if(err) reject(err);
            else resolve(res);
        })
    })
}
async function compareFd(fd1, fd2) {
    if(!fd1 || !fd2) return;
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
    get getFdProp () {
      return this.getLastFd();
    }

    @property({ signature: 'h', access: ACCESS_WRITE })
    set setFdProp (fd) {
      this.fds.push(fd);
    }

    @signal({ signature: 'h' })
    signalFd (fd) {
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
    const onSignal = jest.fn((fd_) => fd=fd_);
    test.on("signalFd", onSignal);

    await test.emitSignal();

    expect(onSignal).toHaveBeenCalled();

    await compareFd(fd, testIface.getLastFd());
    await closeFd(fd);
});
