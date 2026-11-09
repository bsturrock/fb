// Plan 13b: vitest's matchers for code that also runs outside vitest (the L3 contract pass in its shard processes,
// tests/l3-shard.ts). Importing `vitest` outside its runner throws, so this is the same chai with @vitest/expect's
// plugins that vitest's own `expect` is built from: the same matchers and the same failure messages.
import * as chai from 'chai';
import { JestAsymmetricMatchers, JestChaiExpect, JestExtend } from '@vitest/expect';

chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(JestAsymmetricMatchers);

export const expect = chai.expect as unknown as typeof import('vitest').expect;
