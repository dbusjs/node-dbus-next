
declare module 'dbus-next' {
    import { EventEmitter } from "events";
    
    export type ObjectPath = string;
    export type PropertyAccess = "read" | "write" | "readwrite";


    export namespace interface {
        export const ACCESS_READ = 'read';
        export const ACCESS_WRITE = 'write';
        export const ACCESS_READWRITE = 'readwrite';

        export interface PropertyOptions {
            signature: string;
            access?: PropertyAccess;
            name?: string;
            disabled?: boolean;
        }
        export interface MethodOptions {
            inSignature?: string;
            outSignature?: string;
            name?: string;
            disabled?: boolean;
        }
        export interface SignalOptions {
            signature: string;
            name?: string;
            disabled?: boolean;
        }

        export class Interface extends EventEmitter {
            constructor(name: string);
            static configureMembers(members: { properties?: { [key: string]: PropertyOptions }, methods?: { [key: string]: MethodOptions }, signals?: { [key: string]: SignalOptions } }): void;
        }
        export function property(opts: PropertyOptions): PropertyDecorator;
        export function method(opts: MethodOptions): MethodDecorator;
        export function signal(opts: SignalOptions): MethodDecorator;
    }
    export class Variant<T = any> {
        signature: string;
        value: T;
    }
    export class DBusError extends Error {
        type: string;
        text: string;
        reply?: any;
        constructor(type: string, text: string, reply?: any);
    }
    export interface Message {
        serial: number;
        type: number;
        flags: number;
        body?: any;
        signature?: string;
        [key: string]: any;
    }

    export class MessageBus {
        getProxyObject(name: string, path: string): Promise<ProxyObject>;
        getProxyObject(name: string, path: string, xml: string): Promise<ProxyObject>;
        disconnect(): void;

        export(path: ObjectPath, interface: interface.Interface): void;
        unexport(path: ObjectPath, interface: interface.Interface): void;

        requestName(name: string, flags: number): Promise<number>;
        releaseName(name: string): Promise<number>;

        newSerial(): number;
        addMethodHandler(handler: Function): void;
        removeMethodHandler(handler: Function): void;
        call(msg: Message): Promise<Message | null>;
        send(msg: Message): void;
    }
    export interface ProxyObject {
        bus: MessageBus;
        readonly name: string;
        readonly path: ObjectPath;
        readonly nodes: ObjectPath[];
        readonly interfaces: { [name: string]: ClientInterface };

        getInterface(name: string): ClientInterface;
        getInterface<T extends ClientInterface>(name: string): T;
    }
    export interface ClientInterface extends EventEmitter {
        [name: string]: Function;
    }

    export function systemBus(): MessageBus;
    export function sessionBus(options: any): MessageBus;
}