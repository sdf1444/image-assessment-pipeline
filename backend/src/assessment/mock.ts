import { createHash } from 'node:crypto';

export function assessImage(image: Buffer): { score: number; outcome: string } {
  const digest = createHash('sha256').update(image).digest();
  const score = Math.round((digest.readUInt16BE(0) / 65535) * 10000) / 10000;
  return { score, outcome: score >= 0.5 ? 'review' : 'routine' };
}

export function isSupportedImage(image: Buffer): boolean {
  return image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff);
}
