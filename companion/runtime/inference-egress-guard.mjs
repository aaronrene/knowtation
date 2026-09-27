import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const deny = () => {
  throw new Error('PRIVATE_INFERENCE_EGRESS_DENIED');
};

net.Socket.prototype.connect = deny;
net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
dgram.createSocket = deny;
for (const api of [dns, dnsPromises, dns.Resolver.prototype, dnsPromises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(api)) {
    if (/^(lookup|resolve|reverse)/.test(name) && typeof api[name] === 'function') api[name] = deny;
  }
}
globalThis.fetch = deny;
globalThis.WebSocket = class DeniedWebSocket { constructor() { deny(); } };
syncBuiltinESMExports();
