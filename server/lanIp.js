import { networkInterfaces } from 'node:os';

const RANGES = [/^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^10\./];

// The address a phone on the same Wi-Fi can reach. Prefers 192.168.x, then 172.16-31.x, then 10.x
// (VPNs often use 10.x), then any other external IPv4, then localhost.
export function lanIp() {
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  for (const range of RANGES) {
    const hit = addrs.find((a) => range.test(a));
    if (hit) return hit;
  }
  return addrs[0] ?? 'localhost';
}
