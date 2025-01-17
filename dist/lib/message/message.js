"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto = require("crypto");
var crypto_binary_1 = require("crypto-binary");
var general_util_1 = require("../util/general.util");
var message_handlers_1 = require("./message.handlers");
var readFlowingBytes = function (stream, amount, preRead, callback) {
    var buff = (preRead) ? preRead : Buffer.from([]);
    var readData = function (data) {
        buff = Buffer.concat([buff, data]);
        if (buff.length >= amount) {
            var returnData = buff.slice(0, amount);
            var lopped = (buff.length > amount) ? buff.slice(amount) : null;
            callback(returnData, lopped);
        }
        else {
            stream.once('data', readData);
        }
    };
    readData(Buffer.from([]));
};
// TODO create nonce for sending with ping
var createNonce = function () {
    return crypto.pseudoRandomBytes(8);
};
var IPV6_IPV4_PADDING = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255]);
var Message = /** @class */ (function () {
    /**
     * @param messageOptions: MessageOptions = {
     *  magic: string,
     *  relayTransactions: boolean,
     *  protocolVersion: number,
     * }
     */
    function Message(messageOptions) {
        this.messageOptions = messageOptions;
        this.util = new general_util_1.Utils();
        this.handlers = new message_handlers_1.MessageHandlers(this.util);
        this.magicInt = 0;
        // version message vars
        this.networkServices = Buffer.from('0100000000000000', 'hex'); //NODE_NETWORK services (value 1 packed as uint64)
        this.emptyNetAddress = Buffer.from('010000000000000000000000000000000000ffff000000000000', 'hex');
        this.userAgent = this.util.varStringBuffer('/btcp2p/');
        this.blockStartHeight = Buffer.from('00000000', 'hex'); //block start_height, can be empty
        //If protocol version is new enough, add do not relay transactions flag byte, outlined in BIP37
        //https://github.com/bitcoin/bips/blob/master/bip-0037.mediawiki#extensions-to-existing-messages
        this.relayTransactions = Buffer.from('0x00', 'hex'); // false by default
        this.commands = {
            addr: this.util.commandStringBuffer('addr'),
            alert: this.util.commandStringBuffer('alert'),
            block: this.util.commandStringBuffer('block'),
            blocktxn: this.util.commandStringBuffer('blocktxn'),
            checkorder: this.util.commandStringBuffer('checkorder'),
            feefilter: this.util.commandStringBuffer('feefilter'),
            getaddr: this.util.commandStringBuffer('getaddr'),
            getblocks: this.util.commandStringBuffer('getblocks'),
            getblocktxn: this.util.commandStringBuffer('getblocktxn'),
            getdata: this.util.commandStringBuffer('getdata'),
            getheaders: this.util.commandStringBuffer('getheaders'),
            headers: this.util.commandStringBuffer('headers'),
            inv: this.util.commandStringBuffer('inv'),
            mempool: this.util.commandStringBuffer('mempool'),
            notfound: this.util.commandStringBuffer('notfound'),
            ping: this.util.commandStringBuffer('ping'),
            pong: this.util.commandStringBuffer('pong'),
            reject: this.util.commandStringBuffer('reject'),
            reply: this.util.commandStringBuffer('reply'),
            sendcmpct: this.util.commandStringBuffer('sendcmpct'),
            sendheaders: this.util.commandStringBuffer('sendheaders'),
            submitorder: this.util.commandStringBuffer('submitorder'),
            tx: this.util.commandStringBuffer('tx'),
            verack: this.util.commandStringBuffer('verack'),
            version: this.util.commandStringBuffer('version')
        };
        this.magic = Buffer.from(this.messageOptions.magic, 'hex');
        try {
            this.magicInt = this.magic.readUInt32LE(0);
        }
        catch (e) {
            throw new Error('read peer magic failed in constructor');
        }
        if (this.messageOptions.relayTransactions) {
            this.relayTransactions = Buffer.from('0x01', 'hex');
        }
        else {
            this.relayTransactions = Buffer.from('0x00', 'hex');
        }
    }
    Message.prototype.sendMessage = function (command, payload, socket) {
        var message = Buffer.concat([
            this.magic,
            command,
            this.util.packUInt32LE(payload.length),
            this.util.sha256d(payload).slice(0, 4),
            payload
        ]);
        socket.write(message);
    };
    Message.prototype.sendVersion = function (events, socket) {
        // https://en.bitcoin.it/wiki/Protocol_documentation#version
        var payload = Buffer.concat([
            this.util.packUInt32LE(this.messageOptions.protocolVersion),
            this.networkServices,
            this.util.packInt64LE(Date.now() / 1000 | 0),
            this.emptyNetAddress,
            this.emptyNetAddress,
            createNonce(),
            this.userAgent,
            this.blockStartHeight,
            this.relayTransactions
        ]);
        this.sendMessage(this.commands.version, payload, socket);
        events.fireSentMessage({ command: 'version' });
    };
    Message.prototype.sendPing = function (events, socket) {
        var payload = Buffer.concat([crypto.pseudoRandomBytes(8)]);
        this.sendMessage(this.commands.ping, payload, socket);
        events.fireSentMessage({ command: 'ping' });
    };
    Message.prototype.sendHeaders = function (payload, events, socket) {
        this.sendMessage(this.commands.headers, payload, socket);
        events.fireSentMessage({ command: 'headers', payload: {} });
    };
    Message.prototype.sendGetHeaders = function (payload, events, socket) {
        this.sendMessage(this.commands.getheaders, payload, socket);
        events.fireSentMessage({ command: 'getheaders', payload: {} });
    };
    Message.prototype.sendGetAddr = function (events, socket) {
        this.sendMessage(this.commands.getaddr, Buffer.from([]), socket);
        events.fireSentMessage({ command: 'getaddr', payload: {} });
    };
    Message.prototype.sendGetBlocks = function (events, socket, hash) {
        var hashCount = Buffer.from([0x01]);
        var headerHashes = Buffer.from(this.util.reverseHexBytes(hash), 'hex');
        var stopHash = Buffer.from(this.util.stopHash(32));
        var payload = Buffer.concat([
            this.util.packUInt32LE(this.messageOptions.protocolVersion),
            hashCount,
            headerHashes,
            stopHash
        ]);
        this.sendMessage(this.commands.getblocks, payload, socket);
        events.fireSentMessage({ command: 'getblocks', payload: {} });
    };
    Message.prototype.sendAddr = function (events, socket, ip, port) {
        var count = Buffer.from([0x01]);
        var date = this.util.packUInt32LE(Date.now() / 1000 | 0);
        var host = this.ipTo16ByteBuffer(ip);
        var prt = this.util.packUInt16BE(port);
        var payload = Buffer.concat([
            count, date, this.networkServices, host, prt
        ]);
        this.sendMessage(this.commands.addr, payload, socket);
        events.fireSentMessage({ command: 'getaddr', payload: payload });
    };
    Message.prototype.sendReject = function (msg, ccode, reason, extra, socket) {
        var msgBytes = msg.length;
        var reasonBytes = reason.length;
        var extraBytes = extra.length;
        var len = 1 + msgBytes + 1 + 1 + reasonBytes + extraBytes;
        var message = new crypto_binary_1.MessageBuilder(len);
        message.putInt8(msgBytes);
        message.putString(msg);
        message.putInt8(ccode);
        message.putInt8(reasonBytes);
        message.putString(reason);
        message.putString(extra);
        this.sendMessage(this.commands.reject, message.buffer, socket);
    };
    Message.prototype.setupMessageParser = function (events, socket) {
        var _this = this;
        var beginReadingMessage = function (preRead) {
            readFlowingBytes(socket, 24, preRead, function (header, lopped) {
                var msgMagic;
                try {
                    msgMagic = header.readUInt32LE(0);
                }
                catch (e) {
                    events.fireError({ message: 'read peer magic failed in setupMessageParser' });
                    return;
                }
                if (msgMagic !== _this.magicInt) {
                    events.fireError({ message: 'bad magic' });
                    try {
                        while (header.readUInt32LE(0) !== _this.magicInt && header.length >= 4) {
                            header = header.slice(1);
                        }
                        if (header.readUInt32LE(0) === _this.magicInt) {
                            beginReadingMessage(header);
                        }
                        else {
                            beginReadingMessage(Buffer.from([]));
                        }
                    }
                    catch (e) {
                        // TODO: fix this
                        // related to parsing new segwit transactions?
                        // https://github.com/bitpay/insight/issues/842
                        // add rpcserialversion=0 to wallet .conf file
                    }
                    return;
                }
                var msgCommand = header.slice(4, 16).toString();
                var msgLength = header.readUInt32LE(16);
                var msgChecksum = header.readUInt32LE(20);
                // console.log('--', msgCommand, '--', header);
                readFlowingBytes(socket, msgLength, lopped, function (payload, lopped) {
                    if (_this.util.sha256d(payload).readUInt32LE(0) !== msgChecksum) {
                        events.fireError({ message: 'bad payload - failed checksum' });
                        // beginReadingMessage(null); // TODO do we need this?
                        return;
                    }
                    _this.handleMessage(msgCommand, payload, events, socket);
                    beginReadingMessage(lopped);
                });
            });
        };
        beginReadingMessage(Buffer.from([]));
    };
    Message.prototype.ipTo16ByteBuffer = function (ip) {
        var ipv4Addr = ip.split('.').map(function (segment) {
            return parseInt(segment, 10);
        });
        var ipv6Padded = [
            IPV6_IPV4_PADDING,
            Buffer.from(ipv4Addr)
        ];
        return Buffer.concat(ipv6Padded);
    };
    Message.prototype.handleMessage = function (command, payload, events, socket) {
        var _this = this;
        events.firePeerMessage({ command: command });
        // console.log(payload);
        switch (command) {
            case this.commands.ping.toString():
                this.handlers.handlePing(payload, events)
                    .then(function (ping) {
                    // send pong
                    _this.sendMessage(_this.commands.pong, ping.nonce, socket);
                    events.fireSentMessage({ command: 'pong', payload: {
                            message: 'nonce: ' + ping.nonce.toString('hex')
                        } });
                });
                break;
            case this.commands.pong.toString():
                this.handlers.handlePong(payload, events);
                break;
            case this.commands.inv.toString():
                this.handlers.handleInv(payload, events);
                break;
            case this.commands.addr.toString():
                this.handlers.handleAddr(payload, events);
                break;
            case this.commands.verack.toString():
                events.fireVerack(true);
                break;
            case this.commands.version.toString():
                this.handlers.handleVersion(payload, events)
                    .then(function (version) {
                    // console.log(version);
                    _this.sendMessage(_this.commands.verack, Buffer.from([]), socket);
                    events.fireSentMessage({ command: 'verack' });
                });
                break;
            case this.commands.reject.toString():
                this.handlers.handleReject(payload, events);
                break;
            case this.commands.getheaders.toString():
                this.handlers.handleGetHeaders(payload, events);
                break;
            case this.commands.headers.toString():
                this.handlers.handleHeaders(payload, events);
                break;
            default:
                // nothing
                break;
        }
    };
    return Message;
}());
exports.Message = Message;
