import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthController } from './auth.controller';

describe('luồng lời mời đã gỡ', () => {
  it('AuthController không còn route invites', () => {
    const proto = AuthController.prototype as unknown as Record<string, unknown>;
    expect(proto.createInvite).toBeUndefined();
    expect(proto.acceptInvite).toBeUndefined();
  });
  it('không còn file invite.service / template invite', () => {
    expect(existsSync(join(__dirname, 'invite.service.ts'))).toBe(false);
    expect(existsSync(join(__dirname, '..', 'mail', 'templates', 'invite.ts'))).toBe(false);
  });
  it('schema.prisma không còn InviteToken', () => {
    const schema = readFileSync(
      join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    expect(schema).not.toMatch(/model InviteToken/);
  });
});
