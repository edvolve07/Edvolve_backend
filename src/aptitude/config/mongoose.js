import { createRequire } from 'node:module';

const requireFromRoot = createRequire(new URL('../../../package.json', import.meta.url));

export const mongoose = requireFromRoot('mongoose');
export default mongoose;
