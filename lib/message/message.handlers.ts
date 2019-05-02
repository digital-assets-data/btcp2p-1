import { MessageParser } from 'crypto-binary';

import { Events } from '../events/events';
import { RejectedEvent, AddressEvent } from '../interfaces/events.interface';
import { PeerAddress } from '../interfaces/peer.interface';

export interface INonce {
  nonce: Buffer;
}

const IPV6_IPV4_PADDING = Buffer.from([0,0,0,0,0,0,0,0,0,0,255,255]);

export class MessageHandlers {
  //https://en.bitcoin.it/wiki/Protocol_specification#Inventory_Vectors
  private invCodes = {
    error: 0,
    tx: 1,
    block: 2,
    blockFiltered: 3,
    blockCompact: 4
  };

  constructor() {}

  handlePing(payload: Buffer, events: Events): Promise<INonce> {
    let nonce: Buffer = this.parseNonce(payload);
    events.firePing(nonce);
    return Promise.resolve(<INonce>{nonce});
  }

  handlePong(payload: Buffer, events: Events): Promise<INonce> {
    let nonce: Buffer = this.parseNonce(payload);
    events.firePong(nonce);
    return Promise.resolve(<INonce>{nonce});
  }

  handleReject(payload: Buffer, events: Events): Promise<RejectedEvent> {
    const p = new MessageParser(payload);
    const messageLen = p.readInt8();
    const message = p.raw(messageLen).toString();
    const ccode = p.readInt8();
    const reasonLen = p.readInt8();
    const reason = p.raw(reasonLen).toString();
    const extraLen = (p.buffer.length -1) - (p.pointer -1);
    const extra = (extraLen > 0) ? p.raw(extraLen).toString() : '';

    let rejected: RejectedEvent = {
      message,
      ccode,
      reason,
      extra
    };
    events.fireReject(rejected);
    return Promise.resolve(rejected);
  }

  handleVersion(payload: Buffer, events: Events): Promise<any> {
    const s = new MessageParser(payload);
    let parsed = {
      version: s.readUInt32LE(0),
      services: parseInt(s.raw(8).slice(0,1).toString('hex'), 16),
      time: s.raw(8),
      addr_recv: s.raw(26).toString('hex'),
      addr_from: s.raw(26).toString('hex'),
      nonce: s.raw(8).toString('hex'),
      client: s.readVarString(),
      height: s.readUInt32LE(),
      relay: Boolean(s.raw(1))
    };
    if (parsed.time !== false && parsed.time.readUInt32LE(4) === 0) {
      parsed.time = new Date(parsed.time.readUInt32LE(0)*1000);
    }
    events.fireVersion(parsed);
    return Promise.resolve(parsed)
  }

  handleInv(payload: Buffer, events: Events): void {
    let count = payload.readUInt8(0);
    payload = payload.slice(1);
    if (count >= 0xfd) {
      count = payload.readUInt16LE(0);
      payload = payload.slice(2);
    }
    while (count--) {
      let type;
      try {
        type = payload.readUInt32LE(0);
      } catch (e) {

      }
      if (type) {
        events.firePeerMessage({command: 'inv', payload: {type: type}});
      }
      switch (type) {
        case this.invCodes.error:
          console.log('error, you can ignore this');
          break;
        case this.invCodes.tx:
          let tx = payload.slice(4, 36).toString('hex');
          events.fireTxNotify({hash: tx});
          break;
        case this.invCodes.block:
          let block = payload.slice(4, 36).reverse().toString('hex');
          events.fireBlockNotify({hash: block});
          break;
        case this.invCodes.blockFiltered:
          let fBlock = payload.slice(4, 36).reverse().toString('hex');
          console.log('filtered block:', fBlock);
          break;
        case this.invCodes.blockCompact:
          let cBlock = payload.slice(4, 36).reverse().toString('hex');
          console.log('compact block:', cBlock);
          break;
      }
      payload = payload.slice(36);
    }
  }

  handleAddr(payload: Buffer, events: Events): Promise<AddressEvent> {
    const addrs: AddressEvent = {
      addresses: this.parseAddrMessage(payload, events)
    };
    events.fireAddr(addrs);
    return Promise.resolve(addrs);
  }

  handleGetHeaders(payload: Buffer, events: Events): Promise<any> {
    events.fireGetHeaders(payload);
    return Promise.resolve(payload);
  }

  handleHeaders(payload: Buffer, events: Events): Promise<any> {
    events.fireHeaders(payload);
    return Promise.resolve(payload);
  }

  private parseNonce(payload: Buffer): Buffer {
    let nonce: Buffer;
    if (payload.length) {
      nonce = new MessageParser(payload).raw(8)
    } else {
      nonce = Buffer.from([]);
    }
    return nonce;
  }

  private getHost(buff: Buffer): {host: string; version: number} {
    if (buff.slice(0,12).toString('hex') === IPV6_IPV4_PADDING.toString('hex')) {
      //IPv4
      return { host: buff.slice(12).join('.'), version: 4 };
    } else {
      //IPv6
      // non-null type guard (!) https://github.com/Microsoft/TypeScript-Handbook/blob/master/pages/Advanced%20Types.md#type-guards-and-type-assertions
      return { host: buff.slice(0,16).toString('hex')
        .match(/(.{1,4})/g)!
        .join(':')
        .replace(/\:(0{1,3})/g, ':')
        .replace(/^(0{1,3})/g, ''),
        version: 6 };
    }
  }

  private getAddr(buff: Buffer, events: Events): PeerAddress {
    let addr: PeerAddress = {
      hostRaw: Buffer.from([]),
      host: '',
      port: 0,
      ipVersion: 0
    };
    let host = {
      host: '',
      version: 0
    }
    let svc: Buffer;
    if (buff.length === 30) {
      addr.timestamp = buff.readUInt32LE(0) * 1000; // to miliseconds
      svc = Buffer.allocUnsafe(8);
      buff.copy(svc, 0, 4, 12);
      addr.services = svc.toString('hex');
      addr.hostRaw = Buffer.allocUnsafe(16);
      buff.copy(addr.hostRaw, 0, 12, 28);
      host = this.getHost(addr.hostRaw);
      addr.host = host.host;
      addr.ipVersion = host.version;
      addr.port = buff.readUInt16BE(28);
    } else {
      events.fireError({message: 'address field length not 30', payload: buff});
    }
    return addr;
  }

  private parseAddrMessage(payload: Buffer, events: Events): PeerAddress[] {
    const s = new MessageParser(payload);
    let addrs: Array<PeerAddress> = [];
    let addrNum = s.readVarInt();
    for (let i = 0; i < addrNum; i++) {
      const addr: PeerAddress = this.getAddr(<Buffer>s.raw(30), events);
      addrs.push(addr);
    }
    return addrs;
  }
}
