import * as migration_20260829_193521_init from './20260829_193521_init';
import * as migration_20260830_150000_trips from './20260830_150000_trips';
import * as migration_20260830_210000_write_token from './20260830_210000_write_token';
import * as migration_20260830_233000_finish_reason from './20260830_233000_finish_reason';
import * as migration_20260902_120000_oidc_sub from './20260902_120000_oidc_sub';
import * as migration_20260902_180000_visitor_role_name from './20260902_180000_visitor_role_name';
import * as migration_20260903_100000_share from './20260903_100000_share';
import * as migration_20260903_120000_crowd_signals from './20260903_120000_crowd_signals';
import * as migration_20260903_140000_chat from './20260903_140000_chat';
import * as migration_20260903_160000_business from './20260903_160000_business';

export const migrations = [
  {
    up: migration_20260829_193521_init.up,
    down: migration_20260829_193521_init.down,
    name: '20260829_193521_init'
  },
  {
    up: migration_20260830_150000_trips.up,
    down: migration_20260830_150000_trips.down,
    name: '20260830_150000_trips'
  },
  {
    up: migration_20260830_210000_write_token.up,
    down: migration_20260830_210000_write_token.down,
    name: '20260830_210000_write_token'
  },
  {
    up: migration_20260830_233000_finish_reason.up,
    down: migration_20260830_233000_finish_reason.down,
    name: '20260830_233000_finish_reason'
  },
  {
    up: migration_20260902_120000_oidc_sub.up,
    down: migration_20260902_120000_oidc_sub.down,
    name: '20260902_120000_oidc_sub'
  },
  {
    up: migration_20260902_180000_visitor_role_name.up,
    down: migration_20260902_180000_visitor_role_name.down,
    name: '20260902_180000_visitor_role_name'
  },
  {
    up: migration_20260903_100000_share.up,
    down: migration_20260903_100000_share.down,
    name: '20260903_100000_share'
  },
  {
    up: migration_20260903_120000_crowd_signals.up,
    down: migration_20260903_120000_crowd_signals.down,
    name: '20260903_120000_crowd_signals'
  },
  {
    up: migration_20260903_140000_chat.up,
    down: migration_20260903_140000_chat.down,
    name: '20260903_140000_chat'
  },
  {
    up: migration_20260903_160000_business.up,
    down: migration_20260903_160000_business.down,
    name: '20260903_160000_business'
  },
];
