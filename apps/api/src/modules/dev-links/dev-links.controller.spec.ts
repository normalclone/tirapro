import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DevLinksController } from './dev-links.controller';

const route = (fn: unknown) => [
  Reflect.getMetadata(METHOD_METADATA, fn as object) as RequestMethod,
  Reflect.getMetadata(PATH_METADATA, fn as object) as string,
];

describe('DevLinksController — route REST giữ nguyên sau khi đổi tên module', () => {
  const p = DevLinksController.prototype;
  it.each([
    ['createRepository', RequestMethod.POST, 'dev/repositories'],
    ['listRepositories', RequestMethod.GET, 'dev/repositories'],
    ['removeRepository', RequestMethod.DELETE, 'dev/repositories/:id'],
    ['listIssueDevLinks', RequestMethod.GET, 'issues/:issueId/dev-links'],
    ['webhook', RequestMethod.POST, 'dev/webhook/:repositoryId'],
  ])('%s → %s /%s', (name, method, path) => {
    expect(route(p[name as keyof typeof p])).toEqual([method, path]);
  });
});
