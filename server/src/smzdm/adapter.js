import { config } from '../config.js';
import { mockAdapter } from './mockAdapter.js';
import { realAdapter } from './realAdapter.js';

// 依据 .env 的 SMZDM_ADAPTER 选择适配器
export const smzdm = config.smzdmAdapter === 'real' ? realAdapter : mockAdapter;
